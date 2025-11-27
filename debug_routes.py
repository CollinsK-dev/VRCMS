from flask import Blueprint, request, jsonify
import json
from flask import current_app
from datetime import datetime

debug_bp = Blueprint('debug', __name__)


@debug_bp.post('/echo')
def echo():
    """Dev-only endpoint: echoes back parsed body and headers.

    Useful to validate what Flask actually receives without JWT or role checks.
    """
    # Try robust parsing: prefer JSON, fall back to raw body or form data
    parsed = None
    try:
        if request.is_json:
            parsed = request.get_json(silent=True) or {}
        else:
            raw = request.get_data(as_text=True)
            if raw:
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = request.form.to_dict() or {}
            else:
                parsed = request.form.to_dict() or {}
    except Exception as e:
        return jsonify({'message': 'Error parsing body', 'error': str(e)}), 400

    try:
        headers = dict(request.headers)
    except Exception:
        headers = {}

    return jsonify({'method': request.method, 'parsed_body': parsed, 'headers': headers}), 200


@debug_bp.get('/ingest/status')
def ingest_status():
    """Return scheduler and last-run status for the email ingest job.

    Useful for verifying the background job is active and when it last ran.
    """
    try:
        sched = getattr(current_app, 'email_ingest_scheduler', None)
        status = {
            'scheduler_present': bool(sched),
            'last_started': getattr(current_app, 'email_ingest_last_started', None).isoformat() if getattr(current_app, 'email_ingest_last_started', None) else None,
            'last_finished': getattr(current_app, 'email_ingest_last_finished', None).isoformat() if getattr(current_app, 'email_ingest_last_finished', None) else None,
            'last_insert_count': getattr(current_app, 'email_ingest_last_insert_count', None) if getattr(current_app, 'email_ingest_last_insert_count', None) is not None else None,
        }
        # If scheduler available, include next run time for the job id 'email_ingest'
        if sched:
            try:
                job = sched.get_job('email_ingest')
                status['next_run_time'] = job.next_run_time.isoformat() if job and getattr(job, 'next_run_time', None) else None
            except Exception:
                status['next_run_time'] = None

        return jsonify({'ingest_status': status}), 200
    except Exception as e:
        return jsonify({'message': 'Failed to retrieve ingest status', 'error': str(e)}), 500


@debug_bp.post('/ingest/trigger')
def ingest_trigger():
    """Trigger an immediate ingest run (synchronous) and return inserted count.

    This calls the same `fetch_unseen_feedbacks` function the scheduler uses.
    Use with care: it will run in the request thread and may block while talking to IMAP.
    """
    try:
        from ..services.email_ingest import fetch_unseen_feedbacks
        include_seen = str(request.args.get('include_seen') or '').lower() in ('1', 'true')
        # record manual start
        current_app.email_ingest_last_started = datetime.utcnow()
        inserted = fetch_unseen_feedbacks(include_seen=include_seen)
        current_app.email_ingest_last_finished = datetime.utcnow()
        current_app.email_ingest_last_insert_count = len(inserted) if inserted is not None else 0
        return jsonify({'inserted': current_app.email_ingest_last_insert_count}), 200
    except Exception as e:
        return jsonify({'message': 'Ingest trigger failed', 'error': str(e)}), 500


@debug_bp.get('/feedback/<rid>')
def debug_feedback(rid):
    """Dev-only: return stored feedbacks for a report without requiring auth.

    This mirrors `/api/admin/reports/<rid>/feedback` but is unrestricted so
    you can call it from the browser to inspect server behavior and error
    details during development.
    """
    try:
        from bson.objectid import ObjectId
        try:
            oid = ObjectId(rid)
        except Exception:
            return jsonify({'message': 'Invalid report id', 'provided': rid}), 400

        # Import db service from package context
        from ..services.db_service import db
        docs = list(db.report_feedbacks.find({'report_id': oid}).sort('feedback_at', -1))
        out = []
        # Recursive serializer to convert ObjectId and datetimes to JSON-friendly types
        from datetime import datetime as _dt
        from bson.objectid import ObjectId as _OID

        def _serialize(value):
            if isinstance(value, dict):
                return {k: _serialize(v) for k, v in value.items()}
            if isinstance(value, list):
                return [_serialize(v) for v in value]
            if isinstance(value, _OID):
                return str(value)
            if isinstance(value, _dt):
                return value.isoformat()
            return value

        for d in docs:
            out.append(_serialize(d))
        return jsonify({'feedback': out}), 200
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        return jsonify({'message': 'Debug fetch failed', 'error': str(e), 'traceback': tb}), 500
