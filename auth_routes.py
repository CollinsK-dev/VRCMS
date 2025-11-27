from flask import Blueprint, request, jsonify
from ..services.db_service import db
from .. import bcrypt
from flask_jwt_extended import create_access_token
from ..services.email_service import send_email
from ..utils.helpers import generate_verification_code
from datetime import datetime, timedelta
import secrets

auth_bp = Blueprint('auth', __name__)

@auth_bp.get('/check-superadmin')
def check_superadmin():
    """Debug endpoint to check superadmin existence"""
    superadmin = db.superadmins.find_one({})
    if superadmin:
        return jsonify({
            'exists': True,
            'email': superadmin.get('email'),
            'username': superadmin.get('username'),
            'hasPassword': bool(superadmin.get('password')),
            'verified': superadmin.get('verified', False)
        })
    return jsonify({'exists': False})

@auth_bp.post('/login')
def login():
    """Handles user login by checking credentials against multiple collections."""
    data = request.get_json()
    email = data.get('email', '').lower() # Convert email to lowercase
    password = data.get('password')

    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400

    # List of collections to check for the user. Check superadmins first so
    # their accounts map to the 'superadmin' role.
    user_collections = {
        'superadmins': 'superadmin',
        'admins': 'admin',
        'auditors': 'auditor',
        'reporters': 'reporter'
    }

    found_user = None
    found_role = None
    found_collection = None

    # First, check whether the email exists in any collection
    for collection_name, role in user_collections.items():
        user_collection = getattr(db, collection_name)
        print(f"Checking collection {collection_name} for email {email}")
        user = user_collection.find_one({'email': email})
        if user:
            found_user = user
            found_role = role
            found_collection = user_collection
            print(f"Found user in {collection_name}. Role={role}, username={user.get('username')}")
            break

    # If email not found in any collection -> explicitly notify
    if not found_user:
        return jsonify({'message': 'Email not registered'}), 404

    # If password matches, proceed
    print(f"Checking password for {email}")
    password_matches = bcrypt.check_password_hash(found_user['password'], password)
    print(f"Password check result: {password_matches}")
    
    if password_matches:
        if not found_user.get('verified', False) and found_role == 'reporter':
            return jsonify({'message': 'Account not verified. Please check your email.'}), 401

        # Include full user object in JWT identity
        identity = {
            '_id': str(found_user['_id']),
            'role': found_role,
            'username': found_user['username'],
            'email': found_user['email']
        }
        access_token = create_access_token(identity=identity)
        return jsonify({
            'access_token': access_token,
            'username': found_user['username'],
            'role': found_role
        }), 200

    # If email exists but password incorrect
    return jsonify({'message': 'Incorrect email or password'}), 401

@auth_bp.post('/register')
def register():
    """Registers a new user, assuming 'reporter' role."""
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    department = data.get('department')

    if not all([username, email, password, department]):
        return jsonify({'message': 'Missing required fields'}), 400

    # Check all user collections for existing email or username
    for collection_name in ['admins', 'auditors', 'reporters']:
        if getattr(db, collection_name).find_one({'email': email}):
            return jsonify({'message': 'Email already registered'}), 409
        if getattr(db, collection_name).find_one({'username': username}):
            return jsonify({'message': 'Username already taken'}), 409

    verification_code = generate_verification_code()
    new_user = {
        'username': username,
        'email': email,
        'password': bcrypt.generate_password_hash(password).decode('utf-8'),
        'department': department,
        'verified': False,
        'verification_code': verification_code,
        'verification_expires': datetime.now() + timedelta(hours=24),
        'created_at': datetime.now()
    }
    db.reporters.insert_one(new_user)

    try:
        send_email(
            email,
            "Verify Your VRCMS Account",
            f"Hello {username},\n\nThank you for registering. Your verification code is: {verification_code}\n"
            f"This code will expire in 24 hours.\n\nThe VRCMS Team"
        )
    except Exception as e:
        print(f"Error sending verification email: {e}")
        # Continue even if email fails, user can request a resend.

    return jsonify({'message': 'Registration successful. Please check your email to verify your account.'}), 201

@auth_bp.post('/verify')
def verify_account():
    """Verifies a user account with a code."""
    data = request.get_json()
    email = data.get('email')
    code = data.get('code')

    if not email or not code:
        return jsonify({'message': 'Email and verification code are required'}), 400

    user = db.reporters.find_one({'email': email})

    if not user:
        return jsonify({'message': 'User not found'}), 404
    if user.get('verified'):
        return jsonify({'message': 'Account already verified'}), 200
    if user.get('verification_code') != code or user.get('verification_expires') < datetime.now():
        return jsonify({'message': 'Invalid or expired verification code'}), 400

    db.reporters.update_one({'_id': user['_id']}, {'$set': {'verified': True}, '$unset': {'verification_code': "", 'verification_expires': ""}})
    return jsonify({'message': 'Account verified successfully'}), 200

@auth_bp.post('/forgot-password')
def forgot_password():
    """Handles forgot password requests by sending a verification code to user's email."""
    data = request.get_json()
    email = data.get('email', '').lower()

    if not email:
        return jsonify({'message': 'Email is required'}), 400

    # Check all collections for the user (include superadmins)
    user_collections = {
        'superadmins': 'superadmin',
        'admins': 'admin',
        'auditors': 'auditor',
        'reporters': 'reporter'
    }

    for collection_name, role in user_collections.items():
        user_collection = getattr(db, collection_name)
        user = user_collection.find_one({'email': email})
        if user:
            # Generate verification code and expiry
            reset_code = generate_verification_code()
            reset_expiry = datetime.now() + timedelta(minutes=15)

            # Update user with reset code
            user_collection.update_one(
                {'_id': user['_id']},
                {'$set': {
                    'reset_code': reset_code,
                    'reset_expiry': reset_expiry,
                    'reset_collection': collection_name  # Store which collection the user is from
                }}
            )

            # Send reset email
            email_template = f"""
            <h2>Password Reset Request</h2>
            <p>Hello {user['username']},</p>
            <p>We received a request to reset your password. Your verification code is:</p>
            <h3 style="font-size: 24px; text-align: center; padding: 10px; background-color: #f0f0f0; margin: 20px 0;">{reset_code}</h3>
            <p>This code will expire in 15 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
            """
            
            try:
                send_email(email, "Password Reset Verification Code", email_template)
                return jsonify({'message': 'Verification code sent to your email'}), 200
            except Exception as e:
                return jsonify({'message': 'Failed to send verification code'}), 500

    return jsonify({'message': 'If the email exists in our system, you will receive a verification code'}), 200

@auth_bp.post('/verify-reset-code')
def verify_reset_code():
    """Verifies the reset code provided by the user."""
    data = request.get_json()
    email = data.get('email', '').lower()
    code = data.get('code')

    if not email or not code:
        return jsonify({'message': 'Email and verification code are required'}), 400

    # Check all collections (include superadmins)
    user_collections = ['superadmins', 'admins', 'auditors', 'reporters']
    
    for collection_name in user_collections:
        collection = getattr(db, collection_name)
        user = collection.find_one({
            'email': email,
            'reset_code': code,
            'reset_expiry': {'$gt': datetime.now()}
        })
        
        if user:
            # Generate a temporary token for the reset password page
            temp_token = secrets.token_urlsafe(32)
            collection.update_one(
                {'_id': user['_id']},
                {'$set': {'temp_reset_token': temp_token}}
            )
            return jsonify({
                'message': 'Verification successful',
                'token': temp_token
            }), 200

    return jsonify({'message': 'Invalid or expired verification code'}), 400

@auth_bp.post('/reset-password')
def reset_password():
    """Handles password reset after code verification."""
    data = request.get_json()
    token = data.get('token')
    password = data.get('password')

    if not token or not password:
        return jsonify({'message': 'Token and new password are required'}), 400

    # Check all collections (include superadmins)
    user_collections = ['superadmins', 'admins', 'auditors', 'reporters']
    
    for collection_name in user_collections:
        collection = getattr(db, collection_name)
        user = collection.find_one({'temp_reset_token': token})
        
        if user:
            # Hash new password and update user
            hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
            collection.update_one(
                {'_id': user['_id']},
                {
                    '$set': {'password': hashed_password},
                    '$unset': {
                        'reset_code': "",
                        'reset_expiry': "",
                        'temp_reset_token': "",
                        'reset_collection': ""
                    }
                }
            )
            return jsonify({'message': 'Password reset successful'}), 200

    return jsonify({'message': 'Invalid reset token'}), 400