from flask import Flask, jsonify, request
from .config import Config
from .services.db_service import mongo
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from flask_mail import Mail
from flask_jwt_extended import JWTManager
from datetime import datetime, timedelta, timezone
import os
from bson.objectid import ObjectId
import json

# Custom JSON encoder to handle MongoDB ObjectIds
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        return json.JSONEncoder.default(self, o)

# Initialize extensions outside the create_app function
bcrypt = Bcrypt()
mail = Mail()
jwt = JWTManager()

# This is a simplified in-memory blocklist for demonstration.
BLOCKLIST = set()

@jwt.token_in_blocklist_loader
def check_if_token_in_blocklist(jwt_header, jwt_payload: dict):
    """
    Callback function to check if a JWT has been revoked.
    This is called every time a protected endpoint is accessed.
    """
    jti = jwt_payload["jti"]
    return jti in BLOCKLIST

@jwt.user_identity_loader
def user_identity_lookup(user):
    """
    Callback to serialize the user identity into the JWT.
    This is called when creating a token.
    """
    # Always store a string subject in the token (PyJWT requires 'sub' to be a string).
    # If a dict is passed (from login flow), extract the string user id.
    try:
        if isinstance(user, dict):
            # Prefer '_id' field when present; otherwise fall back to string conversion
            uid = user.get('_id') or user.get('id')
            return str(uid) if uid is not None else str(user)
        return str(user)
    except Exception:
        return str(user)


@jwt.user_lookup_loader
def user_lookup_loader(jwt_header, jwt_data):
    """Given the decoded JWT data, return the corresponding user object.

    This populates `current_user` for use in decorators. We search across
    the `admins`, `auditors` and `reporters` collections for the stored
    subject id.
    """
    from .services.db_service import db
    from bson.objectid import ObjectId

    sub = jwt_data.get('sub')
    if not sub:
        return None

    # Try treating sub as an ObjectId first, then as a string id field.
    candidates = []
    try:
        oid = ObjectId(sub)
        candidates.append({'_id': oid})
    except Exception:
        candidates.append({'_id': sub})

    for q in candidates:
        # Check superadmins first, then other collections
        collections = {
            'superadmins': 'superadmin',  # Note: no 's' removal for superadmin role
            'admins': 'admin',
            'auditors': 'auditor',
            'reporters': 'reporter'
        }
        for coll_name, role in collections.items():
            user = db[coll_name].find_one(q)
            if user:
                # Normalize _id to string for downstream code
                user['_id'] = str(user['_id'])
                # Set role for authorization checks
                user['role'] = role
                # Debug logging to help trace 403 role checks during development
                try:
                    print(f"[JWT LOOKUP] sub={sub} matched in collection={coll_name} role={role} user_id={user.get('_id')}")
                except Exception:
                    pass
                return user
    return None

def create_app():
    """Application factory function."""
    app = Flask(
        __name__,
        static_folder='../../frontend', # Serve static files from the frontend directory
        static_url_path='/' # Serve static files from the root URL
    )
    app.config.from_object(Config)
    # Enable blocklisting
    app.config["JWT_BLOCKLIST_ENABLED"] = True
    app.config["JWT_BLOCKLIST_TOKEN_CHECKS"] = ["access"]
    jwt.init_app(app)
    app.json_encoder = CustomJSONEncoder

    # Initialize other extensions with the app
    mongo.init_app(app)
    bcrypt.init_app(app)
    mail.init_app(app)

    # Define the list of allowed origins for CORS.
    # Using a list of specific origins is more secure than a wildcard,
    # especially when `supports_credentials` is True.
    allowed_origins = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5000",
        "http://127.0.0.1:5000"
    ]

    # --- Blueprint Registration ---
    from .routes.auth_routes import auth_bp
    from .routes.report_routes import report_bp
    from .routes.auditor_routes import audit_bp
    from .routes.admin_routes import admin_bp
    from .routes.debug_routes import debug_bp

    # Apply CORS globally to handle preflight requests
    CORS(app, origins=allowed_origins, supports_credentials=True)

    # Register blueprints without trailing slashes on the url_prefix to
    # avoid Flask issuing redirects (which break CORS preflight requests).
    app.register_blueprint(auth_bp, url_prefix='/api/auth', strict_slashes=False)
    app.register_blueprint(report_bp, url_prefix='/api/reports', strict_slashes=False)
    app.register_blueprint(audit_bp, url_prefix='/api/audit', strict_slashes=False)
    app.register_blueprint(admin_bp, url_prefix='/api/admin', strict_slashes=False)
    app.register_blueprint(debug_bp, url_prefix='/api/debug', strict_slashes=False)

    # Development-only request logger to help debug empty/malformed bodies
    @app.before_request
    def log_incoming_request():
        try:
            # Only log POST/PUT/PATCH requests to reduce noise
            if request.method in ('POST', 'PUT', 'PATCH'):
                raw = request.get_data()
                try:
                    readable = raw.decode('utf-8')
                except Exception:
                    readable = str(raw)[:200]
                print(f"[REQ DEBUG] {request.method} {request.path} headers={dict(request.headers)} body={readable}")
        except Exception:
            pass

    # Add root route to redirect to login page
    @app.route('/')
    def root():
        return app.send_static_file('login.html')

    # Add error handlers
    @app.errorhandler(500)
    def handle_500(error):
        print('Server error:', str(error))
        return jsonify({'message': 'Internal server error', 'error': str(error)}), 500

    @app.errorhandler(404)
    def handle_404(error):
        return jsonify({'message': 'Resource not found', 'error': str(error)}), 404

    # --- Background email ingest scheduler ---
    # Enable by setting EMAIL_INGEST_ENABLED=1 in the environment.
    try:
        if str(os.getenv('EMAIL_INGEST_ENABLED') or '').lower() in ('1', 'true'):
            try:
                from apscheduler.schedulers.background import BackgroundScheduler
                from .services.email_ingest import fetch_unseen_feedbacks

# Prefer a seconds-based interval if explicitly provided for testing.
# Otherwise fall back to minutes (production default).
# Default to a 5-second interval for rapid refresh in testing when the environment variable is not provided. 
# Use EMAIL_INGEST_INTERVAL_SEC to override. 
                try:
                    ingest_interval_sec = int(os.getenv('EMAIL_INGEST_INTERVAL_SEC', '5') or '5')
                except Exception:
                    ingest_interval_sec = 5
                ingest_interval_min = int(os.getenv('EMAIL_INGEST_INTERVAL_MIN', '5'))
# For this configuration, always include seen messages so replies already marked as Seen are considered by the ingest job.
# If you want to opt out, set EMAIL_INGEST_INCLUDE_SEEN=0 in the env and restart the app.
                include_seen = False

                def _run_ingest():
                    try:
                        with app.app_context():
                            # record start time for observability
                            try:
                                app.email_ingest_last_started = datetime.utcnow()
                            except Exception:
                                pass
                            inserted = fetch_unseen_feedbacks(include_seen=include_seen)
                            try:
                                app.email_ingest_last_finished = datetime.utcnow()
                                app.email_ingest_last_insert_count = len(inserted) if inserted is not None else 0
                            except Exception:
                                pass
                            if inserted:
                                print(f"Email ingest: inserted {len(inserted)} feedback(s)")
                    except Exception as e:
                        print('Email ingest job error:', e)

                scheduler = BackgroundScheduler()
                if ingest_interval_sec and ingest_interval_sec > 0:
                    scheduler.add_job(_run_ingest, 'interval', seconds=ingest_interval_sec, id='email_ingest')
                    print(f"Email ingest scheduler configured to run every {ingest_interval_sec} second(s)")
                else:
                    scheduler.add_job(_run_ingest, 'interval', minutes=ingest_interval_min, id='email_ingest')
                    print(f"Email ingest scheduler configured to run every {ingest_interval_min} minute(s)")
                scheduler.start()
                # Attach to app for lifecycle access
                app.email_ingest_scheduler = scheduler
                # Log the effective configured interval (seconds preferred for testing)
                if ingest_interval_sec and ingest_interval_sec > 0:
                    print(f"Email ingest scheduler started: interval={ingest_interval_sec}s include_seen={include_seen}")
                else:
                    print(f"Email ingest scheduler started: interval={ingest_interval_min}min include_seen={include_seen}")
            except ImportError:
                print('APScheduler not installed; email ingest scheduler disabled. Install "apscheduler" to enable it.')
    except Exception:
        pass

    return app