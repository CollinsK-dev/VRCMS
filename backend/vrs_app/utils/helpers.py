import random
import string
from flask import current_app
from flask_jwt_extended import create_access_token
from datetime import datetime, timedelta, timezone
from bson.objectid import ObjectId
from ..services.db_service import db
from ..config import Config

def generate_verification_code(length=6):
    """Generate a random verification code."""
    return ''.join(random.choices(string.digits, k=length))

def create_jwt(user):
    """Creates a JWT for a given user using Flask-JWT-Extended.

    Accepts either a user id (string/ObjectId) or a user dict. When a user
    dict is provided, we embed a richer identity (id, role, username) into
    the token so downstream authorization checks don't need an extra DB
    lookup.
    """
    # Use Flask-JWT-Extended's create_access_token which handles serialization
    expires = timedelta(seconds=Config.JWT_ACCESS_TOKEN_EXPIRES or 86400)

    # If caller passed a dict (user document), embed useful fields into the
    # token identity. Otherwise treat 'user' as an id and store only the id.
    identity = None
    try:
        # If it's a mapping-like object, attempt to construct identity dict
        if isinstance(user, dict):
            identity = {
                '_id': str(user.get('_id')),
                'role': user.get('role'),
                'username': user.get('username')
            }
        else:
            identity = str(user)
    except Exception:
        identity = str(user)

    token = create_access_token(
        identity=identity,
        expires_delta=expires
    )
    
    try:
        print(f"Created access token for identity: {identity}")
        print('Token expiry (seconds):', Config.JWT_ACCESS_TOKEN_EXPIRES)
    except Exception as e:
        print('Error logging token details:', str(e))
    return token
