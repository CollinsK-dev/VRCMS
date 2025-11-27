from flask import Blueprint, request, jsonify
from bson.objectid import ObjectId, InvalidId
from datetime import datetime, timezone
from ..services.db_service import db
from flask_jwt_extended import jwt_required
from ..utils.decorators import role_required
from ..services.email_service import send_email

report_bp = Blueprint('reports', __name__)

@report_bp.post('')
@jwt_required()
@role_required(['reporter', 'admin'])
def submit_report(user): # Reverted to original state
    data = request.get_json() or {}
    if not data.get('title') or not data.get('details'):
        return jsonify({'message': 'Missing fields'}), 400
    
    user_id = user.get('_id')
    doc = {
        'title': data['title'],
        'severity': data.get('severity', 'low'),
        'details': data['details'],
        'status': 'Open',
        'reporter_id': ObjectId(user_id),
        'reporter_username': user.get('username'),
        'reporter_email': user.get('email'),
        'created_at': datetime.now()
    }
    res = db.reports.insert_one(doc)
    doc['_id'] = str(res.inserted_id)
    #  Convert ObjectId to string for JSON serialization
    doc['reporter_id'] = str(doc['reporter_id'])
    # --- Ensure report details are stored in the report_assignments collection as the source-of-truth for report details ---
    try:
        assignment_record = {
            'report_id': res.inserted_id,
            'title': data['title'],
            'details': data['details'],
            'severity': data.get('severity', 'low'),
            'assignee_name': None,
            'assignee_email': None,
            'assignee_username': None,
            'assigned_by_id': None,
            'assigned_by_role': None,
            'assigned_at': None,
            'is_submission': True,
            'created_at': doc['created_at']
        }
        db.report_assignments.insert_one(assignment_record)
    except Exception:
        # Non-fatal: if the assignments collection is not available or insertion fails,
        # continue returning the submitted report (admin endpoints will handle missing
        # assignment records gracefully).
        pass
    # Send a confirmation email to the reporter (non-blocking)
    try:
        subj = "VRCMS - Report Received"
        body = (
            f"Dear {doc.get('reporter_username')},\n\n"
            f"Thank you for your contribution to security. We have received your report titled \"{doc.get('title')}\" and our team will review it shortly.\n\n"
            "Best regards,\nThe VRCMS Team"
        )
        # Fire-and-forget: log failures but don't fail the API call
        send_email(doc.get('reporter_email'), subj, body)
    except Exception as e:
        try:
            print(f"Error sending report confirmation email to {doc.get('reporter_email')}: {e}")
        except Exception:
            pass
    return jsonify({'message': 'Submitted', 'item': doc}), 201

@report_bp.get('/my-reports')
@jwt_required()
@role_required(['reporter'])
def get_my_reports(user):
    """Fetches reports submitted by the currently logged-in reporter.""" # Reverted to original state
    pipeline = [
        {'$match': {'reporter_id': ObjectId(user['_id'])}},
        {'$sort': {'created_at': -1}},
            # Lookup the most recent compliance report document for each report
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
            'title': 1,
            'details': 1,
            'severity': 1,
            'status': 1,
            'created_at': 1,
            'report_id': {'$toString': '$_id'},
            'reporter_id': {'$toString': '$reporter_id'},
            'latest_compliance_status': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.overall', 0]}, None]},
            'latest_compliance_at': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.created_at', 0]}, None]},
            '_id': 0
        }}
    ]
    items = list(db.reports.aggregate(pipeline))
    return jsonify({'items': items}), 200

@report_bp.get('/<report_id>')
@jwt_required()
@role_required(['reporter'])
def get_single_report(user, report_id): # Reverted to original state
    """Fetches a single report if the user is the one who submitted it.""" 
    try:
        oid = ObjectId(report_id)
    except InvalidId:
        return jsonify({'message': 'Invalid report ID format'}), 400
    
    report = db.reports.find_one({'_id': oid, 'reporter_id': ObjectId(user['_id'])})

    if not report:
        return jsonify({'message': 'Report not found or you do not have permission to view it'}), 404

    # Attach latest compliance status if available
    try:
        latest = db.compliance_reports.find_one({'report_id': oid}, sort=[('created_at', -1)])
        if latest:
            report['latest_compliance_status'] = latest.get('overall')
            lac = latest.get('created_at')
            report['latest_compliance_at'] = lac.isoformat() if hasattr(lac, 'isoformat') else str(lac)
    except Exception:
        pass

    report['_id'] = str(report['_id'])
    return jsonify(report), 200
