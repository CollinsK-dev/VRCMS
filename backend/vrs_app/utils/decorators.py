from functools import wraps
from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, current_user

def role_required(required_roles):
    """
    A decorator to protect endpoints based on user roles embedded in the JWT.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            # Ensure the JWT is present and valid
            verify_jwt_in_request()
            
            # Use the 'current_user' proxy which is populated by the user_lookup_loader
            # Debug: log current_user contents to help diagnose role mismatches
            try:
                print('[ROLE CHECK] current_user:', current_user)
            except Exception:
                pass
            user_role = current_user.get('role') if current_user else None
            if user_role not in required_roles:
                print(f"[ROLE CHECK] Access denied. user_role={user_role} required={required_roles}")
                return jsonify({'message': f'Access denied: Requires one of these roles: {required_roles}'}), 403
            
            # Pass the loaded user object to the decorated function
            return fn(user=current_user, *args, **kwargs)
        return wrapper
    return decorator
