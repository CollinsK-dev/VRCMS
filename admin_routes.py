from flask import Blueprint, request, jsonify
from ..services.db_service import db
from flask_jwt_extended import jwt_required
from ..utils.decorators import role_required
from datetime import datetime
import re
from bson.objectid import ObjectId
from .. import bcrypt
from ..services.email_service import send_email 
from ..services.email_ingest import fetch_unseen_feedbacks
admin_bp = Blueprint('admin', __name__)


@admin_bp.get('/users')
@jwt_required()
@role_required(['superadmin'])
def list_users(user):
    """List users across collections. Optional query param `role` to filter."""
    role = (request.args.get('role') or '').strip().lower()
    try:
        cols = []
        if role:
            # map role to collection name
            mapping = {
                'superadmin': 'superadmins',
                'admin': 'admins',
                'auditor': 'auditors',
                'reporter': 'reporters'
            }
            col = mapping.get(role)
            if not col:
                return jsonify({'message': 'Invalid role filter'}), 400
            cols = [col]
        else:
            cols = ['superadmins', 'admins', 'auditors', 'reporters']

        out = []
        for c in cols:
            for d in list(getattr(db, c).find({})):
                out.append({
                    'id': str(d.get('_id')),
                    'username': d.get('username'),
                    'email': d.get('email'),
                    'role': d.get('role') or ( 'reporter' if c == 'reporters' else c[:-1])
                })

        return jsonify({'users': out}), 200
    except Exception as e:
        print('Error listing users:', e)
        return jsonify({'message': 'Failed to list users', 'error': str(e)}), 500


@admin_bp.post('/users')
@jwt_required()
@role_required(['superadmin'])
def create_user(user):
    """Create a user of type superadmin/admin/auditor/reporter.

    Body: { role, username, email, password }
    """
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({'message': 'Invalid JSON format in request body'}), 400

    if not data:
        return jsonify({'message': 'Request body cannot be empty'}), 422

    role = (data.get('role') or '').strip().lower()
    username = data.get('username')
    email = (data.get('email') or '').lower()
    password = data.get('password')

    if not all([role, username, email, password]):
        return jsonify({'message': 'Missing required fields: role, username, email, password'}), 422

    # Use existing helper for admin/auditor which enforces cross-collection uniqueness
    if role in ('admin', 'auditor'):
        resp = _create_user(role, data)
        if not isinstance(resp, tuple):
            return resp
        new_user, pwd = resp
        # Send account-creation email from the superadmin flow (superadmin triggers /users)
        try:
            subj = f"Welcome to VRCMS - {role.capitalize()} Account Created."
            body = (
                f"Dear {new_user['username']},\n\n"
                f"An {role} account has been created for you on the VRCMS.\n"
                f"Your username is: {new_user['username']}\n"
                f"Please log in to get started.\n\nThe VRCMS Team"
            )
            send_email(new_user['email'], subj, body)
        except Exception as e:
            print(f"Error sending {role} registration email: {e}")

        return jsonify({'message': f'{role.capitalize()} {new_user.get("username")} created'}), 201

    try:
        # Check duplicates
        for col in ['superadmins', 'admins', 'auditors', 'reporters']:
            if getattr(db, col).find_one({'$or': [{'email': email}, {'username': username}] } ):
                return jsonify({'message': 'Email or username already registered across the system'}), 409

        now = datetime.now()
        if role == 'superadmin':
            doc = {
                'username': username,
                'email': email,
                'password': bcrypt.generate_password_hash(password).decode('utf-8'),
                'role': 'superadmin',
                'created_at': now
            }
            db.superadmins.insert_one(doc)
            return jsonify({'message': f'Superadmin {username} created'}), 201

        if role == 'reporter':
            # Allow superadmin to optionally set a department for reporters
            department = (data.get('department') or '').strip() or None
            doc = {
                'username': username,
                'email': email,
                'password': bcrypt.generate_password_hash(password).decode('utf-8'),
                'role': 'reporter',
                'department': department,
                'verified': True,
                'created_at': now
            }
            db.reporters.insert_one(doc)
            return jsonify({'message': f'Reporter {username} created'}), 201

        return jsonify({'message': 'Unsupported role'}), 400
    except Exception as e:
        print('Error creating user:', e)
        return jsonify({'message': 'Failed to create user', 'error': str(e)}), 500


@admin_bp.delete('/users/<user_id>')
@jwt_required()
@role_required(['superadmin'])
def delete_user(user, user_id):
    """Delete a user by id. Searches all user collections and deletes the first match."""
    try:
        # check each collection
        for col in ['superadmins', 'admins', 'auditors', 'reporters']:
            try:
                from bson.objectid import ObjectId
                oid = ObjectId(user_id)
            except Exception:
                oid = None

            q = {'_id': oid} if oid else {'_id': user_id}
            res = getattr(db, col).delete_one(q)
            if res.deleted_count > 0:
                return jsonify({'message': 'User deleted'}), 200

        return jsonify({'message': 'User not found'}), 404
    except Exception as e:
        print('Error deleting user:', e)
        return jsonify({'message': 'Failed to delete user', 'error': str(e)}), 500



def _create_user(role, data):
    """Helper function to create an Admin or Auditor user.

    Returns (new_user, password) on success or a Flask response on error.
    """
    username = data.get('username')
    email = data.get('email', '').lower()  # Convert email to lowercase
    password = data.get('password')

    # Missing fields causes 422 if client payload is malformed
    if not all([username, email, password]):
        return jsonify({'message': 'Missing required fields: username, email, and password'}), 422

    # Assuming department is the same as the role for Admin/Auditor for simplicity
    department = role

    # Users may exist in superadmins as well; include it when checking for duplicates
    user_collections = ['superadmins', 'admins', 'auditors', 'reporters']

    # Check all user collections for existing email or username
    for collection_name in user_collections:
        if email and getattr(db, collection_name).find_one({'email': email.lower()}):
            return jsonify({'message': 'Email already registered across the system'}), 409
        if getattr(db, collection_name).find_one({'username': username}):
            return jsonify({'message': 'Username already taken across the system'}), 409

    # Insert into the appropriate collection (admins or auditors)
    target_collection = getattr(db, role + "s")
    new_user = {
        'username': username,
        'email': email,  # Already lowercased
        'password': bcrypt.generate_password_hash(password).decode('utf-8'),
        'role': role,  # Ensure role is stored for JWT decoding
        'department': department,
        'verified': True,  # System-created users are verified by default
        'created_at': datetime.now()
    }
    target_collection.insert_one(new_user)

    return new_user, password

# --- Admin/Auditor Registration Endpoints  ---

@admin_bp.post('/register-admin')
@jwt_required()
@role_required(['admin', 'superadmin'])
def register_admin(user):
    # HARDENED JSON PARSING: Prevents 422 crash if JSON body is invalid
    try:
        json_data = request.get_json(force=True)
    except Exception:
        return jsonify({'message': 'Invalid JSON format in request body'}), 400
    
    if not json_data:
        return jsonify({'message': 'Request body cannot be empty'}), 422
        
    response = _create_user('admin', json_data) 
    
    if not isinstance(response, tuple):
        return response 
    else:
        new_user, password = response 
        return jsonify({'message': f"Admin user {new_user['username']} registered successfully"}), 201

@admin_bp.post('/register-auditor')
@jwt_required()
@role_required(['admin', 'superadmin'])
def register_auditor(user):
   
    try:
        json_data = request.get_json(force=True)
    except Exception:
        return jsonify({'message': 'Invalid JSON format in request body'}), 400
    
    if not json_data:
        return jsonify({'message': 'Request body cannot be empty'}), 422
        
    response = _create_user('auditor', json_data) 
    
    if not isinstance(response, tuple):
        return response 
    else:
        new_user, password = response 
        return jsonify({'message': f"Auditor user {new_user['username']} registered successfully"}), 201

@admin_bp.get('/assignments')
@jwt_required()
@role_required(['admin','superadmin'])
def get_assignments(user):
    """Get all report assignments."""
    try:
        # Fetch all assignments and group them by report_id
        all_assignments = list(db.report_assignments.find({}))
        assignments_by_report = {}
        for a in all_assignments:
            rid = a.get('report_id')
            # Normalize to string for grouping
            rid_str = str(rid) if rid is not None else 'unknown'
            assignments_by_report.setdefault(rid_str, []).append(a)

        results = []
        for rid_str, assigns in assignments_by_report.items():
            # Sort assignments by assigned_at if present, otherwise by _id (ObjectId creation time)
            def sort_key(x):
                return x.get('assigned_at') or x.get('_id')

            assigns_sorted = sorted(assigns, key=sort_key)
            latest = assigns_sorted[-1]

            # Try to fetch report to supplement fields (title, created_at, severity)
            report_doc = None
            try:
                report_doc = db.reports.find_one({'_id': ObjectId(rid_str)})
            except Exception:
                report_doc = None

            # Determine title and severity (severity replaces status in the UI)
            title = latest.get('title') or (report_doc.get('title') if report_doc else 'Untitled')
            severity = latest.get('severity') or (report_doc.get('severity') if report_doc else 'Unknown')

            # Format dates: prefer assigned_at, otherwise fallback to report created_at
            assigned_at = latest.get('assigned_at')
            if isinstance(assigned_at, datetime):
                assigned_at_iso = assigned_at.isoformat()
            else:
                assigned_at_iso = assigned_at if isinstance(assigned_at, str) else None

            created_at = None
            if report_doc:
                c = report_doc.get('created_at')
                created_at = c.isoformat() if isinstance(c, datetime) else (c if isinstance(c, str) else None)

            display_date = assigned_at_iso or created_at or None

            assignee_name = latest.get('assignee_name') or latest.get('assignee_username') or 'Unknown Assignee'
            assignee_email = latest.get('assignee_email') or None
            reporter_email = None
            reporter_username = None
            reporter_name = None
            # If we found the report_doc, try to add reporter info
            if report_doc:
                # Prefer reporter info stored on the report document first
                reporter_username = report_doc.get('reporter_username')
                rep_id = report_doc.get('reporter_id')
                if rep_id:
                    try:
                        reporter = db.reporters.find_one({'_id': rep_id})
                        if reporter:
                            # Populate fields from the reporters collection if available
                            reporter_email = reporter.get('email') or reporter_email
                            reporter_username = reporter_username or reporter.get('username')
                            # Some reporter documents may include a full name field
                            reporter_name = reporter.get('name') or reporter.get('full_name') or None
                    except Exception:
                        # If lookup fails, leave whatever we have
                        pass

            # Compute assignment_count and reassignment flag.
            # Support two storage patterns:
            # - multiple documents per report (older format)
            # - single document per report with `reassignment_history` array (current format)
            total_assignments = 0
            had_reassignment = False
            for doc in assigns_sorted:
                rh = doc.get('reassignment_history') or []
                if isinstance(rh, list) and len(rh) > 0:
                    # each entry in reassignment_history represents one previous assignment
                    total_assignments += 1 + len(rh)
                    had_reassignment = True
                else:
                    total_assignments += 1
                # Also consider explicit is_reassignment flags on documents
                if doc.get('is_reassignment'):
                    had_reassignment = True

            item = {
                'report_id': rid_str,
                'title': title,
                'reporter_email': reporter_email,
                'reporter_username': reporter_username,
                'reporter_name': reporter_name,
                'severity': severity,
                'display_date': display_date,
                'assignee_name': assignee_name,
                'assignee_email': assignee_email,
                'is_reassignment': had_reassignment,
                'assignment_count': total_assignments,
                'has_history': total_assignments > 1
            }
            results.append(item)

        print(f"Found {len(results)} assigned reports (latest assignment shown)")
        return jsonify(results), 200

    except Exception as e:
        print(f"Error fetching assignments: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': 'Error fetching assignments'}), 500


@admin_bp.get('/assignments/<report_id>/history')
@jwt_required()
@role_required(['admin','superadmin'])
def get_assignment_history(user, report_id):
    """Return the assignment history for a specific report (sorted oldest->newest)."""
    try:
        # Build a query that matches either ObjectId or string-stored report_id
        q = {'$or': []}
        try:
            oid = ObjectId(report_id)
            q['$or'].append({'report_id': oid})
        except Exception:
            # not a valid ObjectId, still include string match
            pass
        q['$or'].append({'report_id': report_id})

        # Fetch matching assignment documents (there may be one doc per report
        # which contains a `reassignment_history` array, or older style multiple
        # documents per report). We'll build a unified history list and sort it
        # oldest -> newest by assigned_at.
        docs = list(db.report_assignments.find(q))

        history_entries = []
        for d in docs:
            # First, include any reassignment_history entries (these are previous
            # assignees stored when a reassignment occurred). Expect list ordered
            # oldest -> newest (push appends), but we'll still normalize dates.
            rh = d.get('reassignment_history') or []
            if isinstance(rh, list):
                for prev in rh:
                    assigned_at = prev.get('assigned_at')
                    if isinstance(assigned_at, datetime):
                        assigned_at_iso = assigned_at.isoformat()
                    else:
                        assigned_at_iso = assigned_at if isinstance(assigned_at, str) else None

                    history_entries.append({
                        'assignee_name': prev.get('assignee_name') or prev.get('assignee_username') or 'Unknown',
                        'assignee_username': prev.get('assignee_username'),
                        'assignee_email': prev.get('assignee_email'),
                        'assigned_at': assigned_at_iso,
                        'notes': prev.get('notes') or prev.get('details') or None
                    })

            # Then include the current assignment stored on the document
            assigned_at = d.get('assigned_at')
            if isinstance(assigned_at, datetime):
                assigned_at_iso = assigned_at.isoformat()
            else:
                assigned_at_iso = assigned_at if isinstance(assigned_at, str) else None

            history_entries.append({
                'assignee_name': d.get('assignee_name') or d.get('assignee_username') or 'Unknown',
                'assignee_username': d.get('assignee_username'),
                'assignee_email': d.get('assignee_email'),
                'assigned_at': assigned_at_iso,
                'notes': d.get('notes') or d.get('details') or None
            })

        # Normalize and sort entries by assigned_at (entries without dates go last)
        def _parse_key(e):
            v = e.get('assigned_at')
            if v is None:
                return datetime.max
            try:
                # if already ISO string, parse; if it's a datetime, keep it
                if isinstance(v, datetime):
                    return v
                return datetime.fromisoformat(v)
            except Exception:
                return datetime.max

        history_entries_sorted = sorted(history_entries, key=_parse_key)

        return jsonify({'assignments': history_entries_sorted}), 200

    except Exception as e:
        print(f"Error fetching assignment history for {report_id}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': 'Error fetching assignment history'}), 500

@admin_bp.get('/reports')
@jwt_required()
@role_required(['admin','superadmin'])
def all_reports(user):
    """Fetches all reports with filtering options for Admin."""
    reporter_username = request.args.get('reporter')
    date_from_str = request.args.get('date_from')
    date_to_str = request.args.get('date_to')

    q = {}
    if reporter_username:
        reporter_user = db.reporters.find_one({'username': reporter_username})
        if reporter_user:
            q['reporter_id'] = ObjectId(reporter_user['_id']) if isinstance(reporter_user['_id'], str) else reporter_user['_id']

    # --- Robust Date Parsing (Prevents 422 on bad date queries) ---
    try:
        if date_from_str:
            q['created_at'] = {'$gte': datetime.fromisoformat(date_from_str)}
        
        if date_to_str:
            # Ensure we append the time component for end-of-day
            date_to_complete = date_to_str + 'T23:59:59'
            q.setdefault('created_at', {})['$lte'] = datetime.fromisoformat(date_to_complete)

    except ValueError:
        # This catches the crash and returns a proper error message (400 instead of 422)
        return jsonify({'message': 'Invalid date format provided for filtering. Dates must be in ISO 8601 format (e.g., YYYY-MM-DD).'}), 400
    # --------------------------------------------------------------------

    pipeline = [
        {'$match': q},
        # Sort newest first so dashboards show recently submitted reports at the top
        {'$sort': {'created_at': -1}},
        # Lookup reporter information from reporters collection
        {'$lookup': {
            'from': 'reporters',
            'localField': 'reporter_id',
            'foreignField': '_id',
            'as': 'reporter_info'
        }},
        {'$unwind': {'path': '$reporter_info', 'preserveNullAndEmptyArrays': True}},
        # Lookup the most recent assignment from the `report_assignments` collection
        {'$lookup': {
            'from': 'report_assignments',
            'let': {'rid': '$_id'},
            'pipeline': [
                {'$match': {'$expr': {'$eq': ['$report_id', '$$rid']}}},
                {'$sort': {'assigned_at': -1}},
                {'$limit': 1},
                {'$project': {
                    '_id': 0,
                      'assignee_name': 1,
                      'assignee_email': 1,
                      'assignee_username': 1,
                      'assigned_at': 1,
                      'title': 1,
                      'details': 1,
                      'severity': 1
                }}
            ],
            'as': 'latest_assignment'
        }},
        {'$unwind': {'path': '$latest_assignment', 'preserveNullAndEmptyArrays': True}},
        # Lookup latest compliance check for quick badge rendering
        {'$lookup': {
            'from': 'compliance_reports',
            'let': {'rid': '$_id'},
            'pipeline': [
                {'$match': {'$expr': {'$eq': ['$report_id', '$$rid']}}},
                {'$sort': {'created_at': -1}},
                {'$limit': 1},
                {'$project': {'_id': 0, 'overall': 1, 'created_at': 1}}
            ],
            'as': 'latest_compliance'
        }},
        {'$project': {
            '_id': 0,
            # Prefer report details from report_assignments (latest) if present, otherwise fallback to reports collection
            'title': {'$ifNull': ['$latest_assignment.title', '$title']},
            'details': {'$ifNull': ['$latest_assignment.details', '$details']},
            'status': 1,
            'severity': {'$ifNull': ['$latest_assignment.severity', '$severity']},
            'created_at': 1,
            'report_id': {'$toString': '$_id'},
            'reporter_id': {'$toString': '$reporter_id'},
            'assignee_name': {'$ifNull': ['$latest_assignment.assignee_name', None]},
            'assignee_username': {'$ifNull': ['$latest_assignment.assignee_username', None]},
            'assignee_email': {'$ifNull': ['$latest_assignment.assignee_email', None]},
            'assigned_at': '$latest_assignment.assigned_at',
            'reporter_username': {'$ifNull': ['$reporter_info.username', 'Unknown Reporter']},
            'reporter_email': '$reporter_info.email'
            , 'latest_compliance_status': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.overall', 0]}, None]},
            'latest_compliance_at': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.created_at', 0]}, None]}
        }}
    ]
    items = list(db.reports.aggregate(pipeline))
    return jsonify({'items': items}), 200


@admin_bp.get('/reports/stats')
@jwt_required()
@role_required(['admin','superadmin'])
def report_stats(user):
    """Return aggregated report statistics that classify reports as resolved, pending, or open.

    Classification rules:
    - resolved: reports.status == 'Resolved'
    - pending: latest assignment exists and has an assignee_name, and report is not resolved
    - open: no latest assignment or assignment has no assignee_name (initial submission)
    """
    try:
        reports_cursor = db.reports.find({}, {'severity':1, 'status':1})
        total_reports = 0
        resolved_reports = 0
        pending_reports = 0
        open_reports = 0

        severities = ['critical','high','medium','low']
        severity_snapshot = {s: {'total':0, 'resolved':0, 'pending':0, 'open':0} for s in severities}

        for r in reports_cursor:
            total_reports += 1
            sev = (r.get('severity') or '').lower()
            if sev not in severity_snapshot:
                sev = 'low'

            status = r.get('status')
            if status == 'Resolved' or (isinstance(status, str) and status.lower() == 'resolved'):
                resolved_reports += 1
                severity_snapshot[sev]['total'] += 1
                severity_snapshot[sev]['resolved'] += 1
                continue

            # determine latest assignment
            assignment_cursor = db.report_assignments.find({'report_id': r.get('_id')}).sort('assigned_at', -1).limit(1)
            assignment = None
            try:
                assignment = next(assignment_cursor, None)
            except Exception:
                assignment = None

            if not assignment or not assignment.get('assignee_name'):
                open_reports += 1
                severity_snapshot[sev]['total'] += 1
                severity_snapshot[sev]['open'] += 1
            else:
                pending_reports += 1
                severity_snapshot[sev]['total'] += 1
                severity_snapshot[sev]['pending'] += 1

        resp = {
            'total_reports': total_reports,
            'resolved_reports': resolved_reports,
            'pending_reports': pending_reports,
            'open_reports': open_reports,
            'severity_snapshot': severity_snapshot
        }
        return jsonify(resp), 200
    except Exception as e:
        print(f"Error computing report stats: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': 'Failed to compute report statistics', 'error': str(e)}), 500

@admin_bp.get('/reports/<report_id>')
@jwt_required()
@role_required(['admin', 'auditor', 'superadmin'])
def get_report_by_id(user, report_id):
    """Fetches a single report by its ID."""
    import sys
    print("\n=== Report ID Validation Debug ===", file=sys.stderr)
    print(f"1. Raw input type: {type(report_id)}", file=sys.stderr)
    print(f"2. Raw input value: {repr(report_id)}", file=sys.stderr)
    print(f"3. Raw input hex dump: {' '.join(hex(ord(c))[2:] for c in str(report_id))}", file=sys.stderr)

    # Store original for error reporting
    raw_id = report_id

    # Phase 1: Basic string normalization
    if isinstance(report_id, str):
        report_id = report_id.strip()
        print(f"4. After whitespace strip: {repr(report_id)}", file=sys.stderr)

        # Check for and remove any quote wrapping
        if (report_id.startswith('"') and report_id.endswith('"')) or \
           (report_id.startswith("'") and report_id.endswith("'")):
            report_id = report_id[1:-1].strip()
            print(f"5. After quote removal: {repr(report_id)}", file=sys.stderr)

    # Phase 2: Extract hex string if embedded
    if isinstance(report_id, str):
        m = re.search(r"([a-fA-F0-9]{24})", report_id)
        if m:
            report_id = m.group(1)
            print(f"6. Found 24-char hex substring: {report_id}", file=sys.stderr)
        else:
            # Look for partial matches to help diagnose issues
            hex_chars = re.findall(r"[a-fA-F0-9]+", report_id)
            if hex_chars:
                print(f"6a. Found hex substrings: {hex_chars}", file=sys.stderr)
                print(f"6b. Lengths: {[len(x) for x in hex_chars]}", file=sys.stderr)

    # Phase 3: Final validation
    if not isinstance(report_id, str):
        print(f"7. FAIL: Not a string type: {type(report_id)}", file=sys.stderr)
        return jsonify({
            'message': 'Invalid report ID format: not a string',
            'error_details': {
                'provided': repr(raw_id),
                'type': str(type(report_id))
            }
        }), 400

    if not re.fullmatch(r"[a-fA-F0-9]{24}", report_id):
        print(f"7. FAIL: Not a 24-char hex string: {repr(report_id)}", file=sys.stderr)
        print(f"8. String length: {len(report_id)}", file=sys.stderr)
        print(f"9. Non-hex chars: {re.findall(r'[^a-fA-F0-9]', report_id)}", file=sys.stderr)
        return jsonify({
            'message': 'Invalid report ID format: must be 24 hex characters',
            'error_details': {
                'provided': repr(raw_id),
                'cleaned': report_id,
                'length': len(report_id),
                'non_hex_chars': re.findall(r'[^a-fA-F0-9]', report_id)
            }
        }), 400

    print(f"7. PASS: Valid 24-char hex string: {report_id}", file=sys.stderr)
    print("=======================\n", file=sys.stderr)

    # Helper function to serialize MongoDB documents for JSON
    def serialize_doc(value):
        if isinstance(value, dict):
            return {k: serialize_doc(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [serialize_doc(item) for item in value]
        elif isinstance(value, ObjectId):
            return str(value)
        elif isinstance(value, datetime):
            return value.isoformat()
        else:
            return value

    try:
        # Convert string ID to MongoDB ObjectId
        oid = ObjectId(report_id)
        print(f"8. Successfully created ObjectId: {oid}", file=sys.stderr)

        report = db.reports.find_one({'_id': oid})
        if not report:
            return jsonify({'message': 'Report not found'}), 404

        # Add reporter info to improve display
        reporter_id = report.get('reporter_id')
        if reporter_id:
            reporter = db.reporters.find_one({'_id': reporter_id})
            if reporter:
                report['reporter_username'] = reporter.get('username', 'Unknown')
                report['reporter_email'] = reporter.get('email')

        # Serialize report document
        report = serialize_doc(report)
        print(f"9. Serialized report document", file=sys.stderr)

        # Get and serialize assignments
        assignments = list(db.report_assignments.find({'report_id': oid}).sort('assigned_at', 1))
        assignments = [serialize_doc(doc) for doc in assignments]
        print(f"10. Serialized {len(assignments)} assignment records", file=sys.stderr)

        # Build and return response
        response = {
            'report': report,
            'assignments': assignments
        }
        print("11. Built final response object", file=sys.stderr)
        return jsonify(response), 200

    except Exception as e:
        print(f"Error in get_report_by_id: {str(e)}", file=sys.stderr)
        return jsonify({
            'message': 'Error processing report',
            'error_details': {
                'error_type': str(type(e).__name__),
                'error_message': str(e),
                'provided_id': report_id
            }
        }), 500
        return jsonify(response), 200
    except Exception as e:
        # Log server-side error and return a helpful message for the frontend
        error_msg = str(e)
        print(f"Error in get_report_by_id: {error_msg}")
        if 'ObjectId' in error_msg:
            return jsonify({'message': 'Invalid report ID format', 'error': 'The provided report ID is not valid'}), 400
        return jsonify({'message': 'Failed to fetch report details. Please try again or contact support if the issue persists.', 'error': error_msg}), 500

@admin_bp.patch('/reports/<rid>')
@jwt_required()
@role_required(['admin','superadmin'])
def update_status(user, rid): 
    """Allows Admin to update report status."""
    data = request.get_json() or {}
    status = data.get('status')
    if status not in ['Open','In Progress','Resolved']:
        return jsonify({'message': 'Invalid status'}), 400
   
    update_doc = {'status': status}
    if status == 'Resolved':
        # record resolved timestamp for UI and auditing (use local system time)
        update_doc['resolved_at'] = datetime.now()

    result = db.reports.update_one({'_id': ObjectId(rid)}, {'$set': update_doc})

    if status == 'Resolved' and result.modified_count > 0:
        report = db.reports.find_one({'_id': ObjectId(rid)})
        reporter_email = report.get('reporter_email') 
        report_title = report.get('title')
        if reporter_email and report_title:
            try:
                send_email(
                    reporter_email,
                    f"Your Report has been Resolved: '{report_title}'",
                    f"Hello,\n\nYour vulnerability report titled '{report_title}' has been marked as 'Resolved'.\n\n"
                    f"Thank you for your contribution to security.\n\nThe VRCMS Team"
                )
            except Exception as e:
                print(f"Error sending resolution notification email: {e}")

    return jsonify({'message': 'Updated'}), 200


@admin_bp.delete('/reports/<rid>')
@jwt_required()
@role_required(['superadmin'])
def delete_report(user, rid):
    """Allow superadmin to permanently delete a report and its assignment records."""
    try:
        from bson.objectid import ObjectId
        try:
            oid = ObjectId(rid)
        except Exception:
            return jsonify({'message': 'Invalid report id'}), 400

        res = db.reports.delete_one({'_id': oid})
        # Also remove any assignment documents tied to this report
        db.report_assignments.delete_many({'report_id': oid})
        if res.deleted_count == 0:
            return jsonify({'message': 'Report not found'}), 404
        return jsonify({'message': 'Report deleted'}), 200
    except Exception as e:
        print('Error deleting report:', e)
        return jsonify({'message': 'Error deleting report'}), 500

@admin_bp.patch('/reports/<rid>/assign')
@jwt_required()
@role_required(['admin','superadmin'])
def assign_report(user, rid):
    """Assigns or reassigns a report to an ad-hoc developer (name and email)."""
    data = request.get_json() or {}
    assignee_name = data.get('assignee_name')
    assignee_email = data.get('assignee_email')

    if not all([assignee_name, assignee_email]):
        return jsonify({'message': 'Missing assignee name or email'}), 400

    report = db.reports.find_one({'_id': ObjectId(rid)})
    if not report:
        return jsonify({'message': 'Report not found'}), 404

    # Check for existing assignment record for this report
    existing_assignment = db.report_assignments.find_one({'report_id': ObjectId(rid)})

    # Allow the client to explicitly indicate whether this action is an
    # 'assignment' or a 'reassignment' via the request body (type='assignment'|'reassignment').
    # If not supplied, fall back to server-side detection: a reassignment only
    # applies when an existing assignment record already has an assignee name.
    type_hint = (data.get('type') or '').lower()

    now = datetime.now()
    if type_hint in ('assignment', 'reassignment'):
        is_reassignment = (type_hint == 'reassignment')
    else:
        # Treat as reassignment only when there is an existing assignment
        # that already had an assignee (i.e. somebody was previously assigned).
        is_reassignment = bool(existing_assignment and existing_assignment.get('assignee_name'))

    # 1. Update only the report's status; assignment details live in report_assignments.
    db.reports.update_one(
        {'_id': ObjectId(rid)},
        {'$set': {
            'status': 'In Progress'
        }}
    )

    # 2. Create or update assignment record
    if not existing_assignment:
        assignment_record = {
            'report_id': ObjectId(rid),
            # include report details so assignments hold the canonical copy of details
            'title': report.get('title'),
            'details': report.get('details'),
            'severity': report.get('severity'),
            'assignee_name': assignee_name,
            # keep assignee_username for UI compatibility
            'assignee_username': assignee_name,
            'assignee_email': assignee_email,
            # record assigner identity (id, role, name, email)
            'assigned_by_id': user.get('_id'),
            'assigned_by_role': user.get('role'),
            'assigned_by_name': user.get('username') or None,
            'assigned_by_email': user.get('email') or None,
            'assigned_at': now,
            'is_reassignment': False,
            'reassignment_history': [],
            'created_at': now
        }
        db.report_assignments.insert_one(assignment_record)
    else:
        # Prepare a history entry representing the previous assignee (if any)
        prev_entry = {
            'assignee_name': existing_assignment.get('assignee_name'),
            'assignee_username': existing_assignment.get('assignee_username'),
            'assignee_email': existing_assignment.get('assignee_email'),
            'assigned_at': existing_assignment.get('assigned_at'),
            'assigned_by_id': existing_assignment.get('assigned_by_id'),
            'assigned_by_role': existing_assignment.get('assigned_by_role'),
            'assigned_by_name': existing_assignment.get('assigned_by_name'),
            'assigned_by_email': existing_assignment.get('assigned_by_email')
        }
        # Append to reassignment_history and set new current assignee fields
        db.report_assignments.update_one(
            {'report_id': ObjectId(rid)},
            {
                '$push': {'reassignment_history': prev_entry},
                '$set': {
                    'assignee_name': assignee_name,
                    'assignee_username': assignee_name,
                    'assignee_email': assignee_email,
                    'assigned_by_id': user.get('_id'),
                    'assigned_by_role': user.get('role'),
                    'assigned_by_name': user.get('username') or None,
                    'assigned_by_email': user.get('email') or None,
                    'assigned_at': now,
                    'is_reassignment': True
                }
            }
        )

    # 3. Send notification email to the reporter
    reporter_email = report.get('reporter_email')
    report_title = report.get('title')
    
    # Send email to both reporter and assignee
    if report_title:
        # Email to reporter
        if reporter_email:
            action_text = "reassigned to" if is_reassignment else "assigned to"
            # Include the report id token in the subject so replies include the report id
            rid_token = str(rid)
            reporter_subject = f"Update on Your Report: '{report_title}' [VRS-{rid_token}]"
            reporter_body = (f"Hello,\n\nYour vulnerability report titled '{report_title}' has been {action_text} "
                    f"{assignee_name} ({assignee_email}) and its status is now 'In Progress'.\n\n"
                    f"Thank you for your submission.\n\nThe VRCMS Team")
            try:
                send_email(reporter_email, reporter_subject, reporter_body)
            except Exception as e:
                print(f"Error sending reporter notification email: {e}")

        # Email to assignee
        # Include the report id token in the subject so replies will reference it (helps ingest)
        rid_token = str(rid)
        assignee_subject = f"New Vulnerability Report Assignment: '{report_title}' [VRS-{rid_token}]"
        assignee_body = (f"Hello {assignee_name},\n\n"
                f"You have been {'reassigned' if is_reassignment else 'assigned'} to a vulnerability report titled '{report_title}'.\n\n"
                f"Please review and address this report at your earliest convenience and reply under this same email the resolution steps you undertook.\n\n"
                f"The VRCMS Team")
        try:
            # send_email now returns a Message-ID which we record so that
            # replies referencing this ID can be correlated to this report.
            # Include a VRS-RID header so replies (when preserved) will carry the
            # explicit report identifier. We also include the report id token in
            # the subject above to maximize the chance the id is present in
            # replies (clients often keep subject but drop custom headers).
            extra_headers = {'VRS-RID': str(rid)}
            msg_id = send_email(assignee_email, assignee_subject, assignee_body, extra_headers=extra_headers, track_replies=True)
            try:
                # store sent message mapping for ingestion correlation
                # Only insert mapping if we have a message id; include subject for debug
                record_type = (type_hint if type_hint in ('assignment','reassignment') else ('reassignment' if is_reassignment else 'assignment'))
                if msg_id:
                    db.sent_messages.insert_one({
                        'report_id': ObjectId(rid) if not isinstance(rid, ObjectId) else rid,
                        'recipient': assignee_email,
                        'message_id': msg_id,
                        'subject': assignee_subject,
                        'type': record_type,
                        'sent_at': now
                    })
                else:
                    # Insert a diagnostic record so the ingestion code can still operate
                    db.sent_messages.insert_one({
                        'report_id': ObjectId(rid) if not isinstance(rid, ObjectId) else rid,
                        'recipient': assignee_email,
                        'message_id': None,
                        'subject': assignee_subject,
                        'type': record_type,
                        'sent_at': now,
                        'send_error_recorded': True
                    })
            except Exception as _e:
                print('Failed to record sent message mapping:', _e)
        except Exception as e:
            print(f"Error sending assignee notification email: {e}")

    message = f'Report reassigned to {assignee_name}.' if is_reassignment else f'Report assigned to {assignee_name}.'
    return jsonify({'message': f'{message} Reporter has been notified.'}), 200

@admin_bp.post('/reports/<rid>/feedback')
@jwt_required()
@role_required(['admin','superadmin'])
def record_assignee_feedback(user, rid):
    """Record feedback submitted by the assignee (typically captured by admin from assignee email).

    Body: { assignee_name, assignee_email, feedback_text, feedback_at (ISO optional) }
    """
    data = request.get_json() or {}
    assignee_name = data.get('assignee_name')
    assignee_email = data.get('assignee_email')
    feedback_text = data.get('feedback_text')
    feedback_at_str = data.get('feedback_at')

    if not all([assignee_name, assignee_email, feedback_text]):
        return jsonify({'message': 'Missing feedback fields'}), 400

    try:
        from bson.objectid import ObjectId
        oid = ObjectId(rid)
    except Exception:
        return jsonify({'message': 'Invalid report id'}), 400

    now = datetime.now()
    try:
        feedback_at = datetime.fromisoformat(feedback_at_str) if feedback_at_str else now
    except Exception:
        feedback_at = now

    # Store feedback without recording who inserted it (remove recorded_by fields per UX request)
    fb_doc = {
        'report_id': oid,
        'assignee_name': assignee_name,
        'assignee_email': assignee_email,
        'feedback_text': feedback_text,
        'feedback_at': feedback_at
    }
    try:
        db.report_feedbacks.insert_one(fb_doc)
        # Notify all admins of the feedback
        admins = list(db.admins.find({}))
        for admin in admins:
            admin_email = admin.get('email')
            if not admin_email:
                continue
            subject = f'Assignee Feedback for Report {rid}'
            template = f"""
            <h3>Assignee Feedback Received</h3>
            <p>Report ID: {rid}</p>
            <p>Assignee: {assignee_name} &lt;{assignee_email}&gt;</p>
            <p>Feedback time: {feedback_at.strftime('%Y-%m-%d %H:%M:%S')}</p>
            <pre>{feedback_text}</pre>
            """
            try:
                send_email(admin_email, subject, template)
            except Exception as e:
                print(f"Failed to notify admin {admin_email}: {e}")

        return jsonify({'message': 'Feedback recorded and admins notified'}), 201
    except Exception as e:
        print('Error recording feedback:', e)
        return jsonify({'message': 'Failed to record feedback', 'error': str(e)}), 500


@admin_bp.get('/reports/<rid>/feedback')
@jwt_required()
@role_required(['admin','auditor','superadmin'])
def get_report_feedback(user, rid):
    try:
        from bson.objectid import ObjectId
        oid = ObjectId(rid)
    except Exception:
        return jsonify({'message': 'Invalid report id'}), 400
    docs = list(db.report_feedbacks.find({'report_id': oid}).sort('feedback_at', -1))
    out = []
    # Serializer: convert ObjectId and datetime to JSON-friendly types
    from datetime import datetime as _dt
    from bson.objectid import ObjectId as _OID

    def _serialize(v):
        if isinstance(v, dict):
            return {k: _serialize(val) for k, val in v.items()}
        if isinstance(v, list):
            return [_serialize(i) for i in v]
        if isinstance(v, _OID):
            return str(v)
        if isinstance(v, _dt):
            return v.isoformat()
        return v

    for d in docs:
        out.append(_serialize(d))
    return jsonify({'feedback': out}), 200


@admin_bp.get('/feedbacks')
@jwt_required()
@role_required(['admin','auditor','superadmin'])
def get_all_feedbacks(user):
    """Return feedbacks previously ingested and stored in the `report_feedbacks` collection.
    This endpoint no longer queries IMAP directly. Use `/admin/ingest-feedbacks` (POST)
    to trigger an IMAP sync if you need to populate the collection from the mailbox.
    Query params:
      - full=1 to include feedback_text; default is to omit large text for list views.
      - limit=N to limit number of returned items (default 500)
    """
    try:
        full_fetch = str(request.args.get('full') or '').lower() in ('1', 'true')
        try:
            limit = int(request.args.get('limit') or 500)
        except Exception:
            limit = 500

        # Query the stored feedbacks, newest first
        docs = list(db.report_feedbacks.find({}).sort('feedback_at', -1).limit(limit))
        out = []
        for d in docs:
            out_doc = {
                '_id': str(d.get('_id')),
                'report_id': str(d.get('report_id')) if d.get('report_id') is not None else None,
                'assignee_name': d.get('assignee_name'),
                'assignee_email': d.get('assignee_email'),
                'feedback_at': d.get('feedback_at').isoformat() if getattr(d.get('feedback_at'), 'isoformat', None) else None,
                'message_id': d.get('message_id')
            }
            if full_fetch:
                out_doc['feedback_text'] = d.get('feedback_text')
            else:
                out_doc['feedback_text'] = None
            out.append(out_doc)

        return jsonify({'feedbacks': out}), 200
    except Exception as e:
        print('Error fetching stored feedbacks:', e)
        return jsonify({'message': 'Failed to fetch stored feedbacks', 'error': str(e)}), 500


@admin_bp.post('/ingest-feedbacks')
@jwt_required()
@role_required(['admin','superadmin'])
def ingest_feedbacks(user):
    """Manually trigger an IMAP ingestion of unseen assignee feedback emails.

    This endpoint connects to the configured IMAP server, fetches unseen messages,
    parses report IDs from subject or body, and inserts matching feedbacks into
    the `report_feedbacks` collection. Returns the number of inserted feedbacks.
    """
    try:
        inserted = fetch_unseen_feedbacks()
        # Do not return full email bodies in the admin response for brevity
        return jsonify({'inserted': len(inserted)}), 200
    except RuntimeError as re:
        return jsonify({'message': str(re)}), 500
    except Exception as e:
        print('Error ingesting feedbacks:', e)
        return jsonify({'message': 'Failed to ingest feedbacks', 'error': str(e)}), 500


@admin_bp.post('/reports/<rid>/resolve')
@jwt_required()
@role_required(['admin','superadmin'])
def mark_report_resolved(user, rid):
    """Admin marks a report as resolved and records the steps taken.

    Body: { resolve_steps }
    """
    data = request.get_json() or {}
    resolve_steps = data.get('resolve_steps')
    # Optional: assignee selected from dropdown (name/email)
    assignee_name = data.get('assignee_name')
    assignee_email = data.get('assignee_email')

    if not resolve_steps:
        return jsonify({'message': 'Missing resolve_steps'}), 400

    try:
        from bson.objectid import ObjectId
        oid = ObjectId(rid)
    except Exception:
        return jsonify({'message': 'Invalid report id'}), 400

    now = datetime.now()
    try:
        # Update report status; store resolve_steps and optionally the assignee this resolution pertains to
        report_update = {
            'status': 'Resolved',
            'resolved_at': now,
            'resolved_by': user.get('_id'),
            'resolved_by_email': user.get('email'),
            'resolved_by_role': user.get('role'),
            'resolve_steps': resolve_steps
        }
        if assignee_name:
            report_update['resolved_by_assignee_name'] = assignee_name
        if assignee_email:
            report_update['resolved_by_assignee_email'] = assignee_email
        db.reports.update_one({'_id': oid}, {'$set': report_update})

        # Store a resolution record
        # Store a resolution record including the recorder's email and role
        res_doc = {
            'report_id': oid,
            'resolved_by': user.get('_id'),
            'resolved_by_username': user.get('username'),
            'resolved_by_email': user.get('email'),
            'resolved_by_role': user.get('role'),
            'resolved_at': now,
            'resolve_steps': resolve_steps,
            'assignee_name': assignee_name,
            'assignee_email': assignee_email
        }
        # Try to enrich the assignee full name by looking up known user collections
        try:
            if assignee_email:
                full_name = None
                # Search common user collections for a matching email to get full name
                for col in ('reporters', 'admins', 'auditors', 'superadmins'):
                    try:
                        candidate = db[col].find_one({'email': assignee_email})
                        if candidate:
                            # prefer explicit name/full_name fields, fall back to username
                            full_name = candidate.get('name') or candidate.get('full_name') or candidate.get('username')
                            break
                    except Exception:
                        continue
                if full_name:
                    res_doc['assignee_full_name'] = full_name
        except Exception:
            pass

        db.report_resolutions.insert_one(res_doc)

        # Remove any stored assignee feedbacks for this report so they are
        # not reused after resolution. This prevents admins from accidentally
        # re-using feedback entries that have already been actioned.
        try:
            # Delete feedbacks stored either as an ObjectId or as a string
            str_oid = str(oid)
            del_query = {'report_id': {'$in': [oid, str_oid]}}
            del_res = db.report_feedbacks.delete_many(del_query)
            print(f"Removed {getattr(del_res, 'deleted_count', 'unknown')} feedback(s) for resolved report {rid}")
        except Exception as _e:
            print(f"Failed to remove feedbacks for report {rid}: {_e}")
        # Notify admins of resolution
        admins = list(db.admins.find({}))
        for admin in admins:
            admin_email = admin.get('email')
            if not admin_email:
                continue
            # Use report title in the notification subject/template if available
            try:
                report_doc = db.reports.find_one({'_id': oid})
            except Exception:
                report_doc = None
            report_title = (report_doc.get('title') if report_doc else None) or str(rid)

            subject = f"Report '{report_title}' marked Resolved"
            # Include assignee info and an 'Actions taken' label before the steps
            assignee_line = ''
            if assignee_name or assignee_email:
                assignee_display = (res_doc.get('assignee_full_name') or assignee_name) or ''
                assignee_line = f"<p>Assignee: {assignee_display} {('&lt;' + assignee_email + '&gt;') if assignee_email else ''}</p>\n"

            template = f"""
            <h3>Report Resolved</h3>
            <p>Report: {report_title}</p>
            <p>Resolved by: {user.get('username')}</p>
            {assignee_line}
            <h4>Actions taken:</h4>
            <pre>{resolve_steps}</pre>
            """
            try:
                send_email(admin_email, subject, template)
            except Exception as e:
                print(f"Failed to notify admin {admin_email}: {e}")

        return jsonify({'message': 'Report marked as resolved and admins notified'}), 200
    except Exception as e:
        print('Error marking report resolved:', e)
        return jsonify({'message': 'Failed to mark resolved', 'error': str(e)}), 500


@admin_bp.get('/reports/<rid>/resolution')
@jwt_required()
@role_required(['admin','auditor'])
def get_report_resolution(user, rid):
    """Return the latest resolution steps recorded for a report (if any)."""
    try:
        from bson.objectid import ObjectId
        oid = ObjectId(rid)
    except Exception:
        return jsonify({'message': 'Invalid report id'}), 400

    try:
        doc = db.report_resolutions.find_one({'report_id': oid}, sort=[('resolved_at', -1)])
        if not doc:
            return jsonify({'resolution': None}), 200
        # Convert fields for JSON
        out = {
            '_id': str(doc.get('_id')),
            'report_id': str(doc.get('report_id')),
            'resolved_by': str(doc.get('resolved_by')) if doc.get('resolved_by') else None,
            'resolved_by_username': doc.get('resolved_by_username'),
            'resolved_by_email': doc.get('resolved_by_email'),
            'resolved_by_role': doc.get('resolved_by_role'),
            'resolved_at': doc.get('resolved_at').isoformat() if getattr(doc.get('resolved_at'), 'isoformat', None) else None,
            'resolve_steps': doc.get('resolve_steps'),
            'assignee_name': doc.get('assignee_name'),
            'assignee_email': doc.get('assignee_email')
        }
        return jsonify({'resolution': out}), 200
    except Exception as e:
        print('Error fetching resolution for report', rid, e)
        return jsonify({'message': 'Failed to fetch resolution', 'error': str(e)}), 500

@admin_bp.get('/reports/feed')
@jwt_required()
@role_required(['auditor','admin'])
def auditor_feed(user):
    """Simple feed for auditors/admins (can be replaced by /reports)."""
    items = []
    for r in db.reports.find({}).sort('_id', -1): 
        r['_id'] = str(r['_id'])
        items.append(r)
    return jsonify({'items': items}), 200