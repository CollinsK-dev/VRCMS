from flask import Blueprint, jsonify, request, send_file
from ..services.db_service import db
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..utils.decorators import role_required
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from datetime import datetime, timedelta
import io
from bson import ObjectId
import traceback

audit_bp = Blueprint('audit', __name__)


# --- Compliance endpoints (standards + checks) ---
@audit_bp.get('/compliance/standards')
@jwt_required()
@role_required(['auditor'])
def list_compliance_standards(user):
    """Return the list of compliance standards available for checks."""
    try:
        standards = list(db.compliance_standards.find({}, {'_id': 1, 'control_id': 1, 'name': 1, 'description': 1}))
        # Normalize ObjectIds to strings
        for s in standards:
            s['_id'] = str(s['_id'])
        return jsonify({'standards': standards}), 200
    except Exception as e:
        print(f"Error fetching compliance standards: {e}")
        return jsonify({'message': 'Failed to fetch standards', 'error': str(e)}), 500


@audit_bp.get('/report/<report_id>/compliance')
@jwt_required()
@role_required(['auditor'])
def get_report_compliance(user, report_id):
    """List compliance checks already performed for a report."""
    try:
        # Return the latest compliance report document(s) for the given report_id.
        # Accept both ObjectId and string report ids
        try:
            rid = ObjectId(report_id)
            q = {'report_id': rid}
        except Exception:
            rid = report_id
            q = {'report_id': report_id}

        # We store compliance results as a single document per report in the
        # `compliance_reports` collection (fields: report_id, standards, overall, auditor_id, created_at).
        docs = list(db.compliance_reports.find(q).sort('created_at', -1))
        out = []
        for d in docs:
            d['_id'] = str(d.get('_id'))
            try:
                d['report_id'] = str(d.get('report_id'))
            except Exception:
                pass
            if isinstance(d.get('created_at'), datetime):
                d['created_at'] = d['created_at'].isoformat()
            out.append(d)
        return jsonify({'checks': out}), 200
    except Exception as e:
        print(f"Error fetching compliance checks for report {report_id}: {e}")
        return jsonify({'message': 'Failed to fetch compliance checks', 'error': str(e)}), 500



@audit_bp.get('/report/<report_id>/compliance/check')
@jwt_required()
@role_required(['auditor'])
def auto_check_report_compliance(user, report_id):
    """Automated keyword-based compliance checks have been disabled.

    This endpoint is retained for compatibility but will return a 410 response
    indicating the automated keyword check feature has been removed. Auditors
    should mark applicable standards manually in the Compliance modal.
    """
    return jsonify({'message': 'Automated keyword-based compliance checks are disabled. Please mark standards manually.'}), 410


@audit_bp.get('/reports')
@jwt_required()
@role_required(['auditor'])
def list_submitted_reports(user):
    """Return a list of submitted reports for auditors to review.

    Includes a lookup for the latest compliance status so the UI can show a badge.
    """
    try:
        # Only include resolved reports — auditors should check compliance on resolved items
        pipeline = [
            {'$match': {'status': {'$in': ['Resolved', 'resolved']}}},
            {'$sort': {'created_at': -1}},
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
                'severity': 1,
                'status': 1,
                'created_at': 1,
                'report_id': {'$toString': '$_id'},
                'reporter_username': 1,
                'latest_compliance_status': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.overall', 0]}, None]},
                'latest_compliance_at': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.created_at', 0]}, None]},
                '_id': 0
            }}
        ]

        items = list(db.reports.aggregate(pipeline))
        # Convert datetime to isoformat strings where present
        for it in items:
            lac = it.get('latest_compliance_at')
            if hasattr(lac, 'isoformat'):
                it['latest_compliance_at'] = lac.isoformat()

        return jsonify({'items': items}), 200
    except Exception as e:
        print(f"Error listing submitted reports for audits: {e}")
        return jsonify({'message': 'Failed to list reports', 'error': str(e)}), 500


@audit_bp.get('/reports/checked')
@jwt_required()
@role_required(['auditor'])
def list_checked_reports(user):
    """Return reports that have an associated compliance_reports entry (i.e. were cross-checked)."""
    try:
        # Reuse the same aggregation used for submitted reports, then filter those
        pipeline = [
            {'$match': {'status': {'$in': ['Resolved', 'resolved']}}},
            {'$sort': {'created_at': -1}},
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
                'severity': 1,
                'status': 1,
                'created_at': 1,
                'report_id': {'$toString': '$_id'},
                'reporter_username': 1,
                'latest_compliance_status': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.overall', 0]}, None]},
                'latest_compliance_at': {'$ifNull': [{'$arrayElemAt': ['$latest_compliance.created_at', 0]}, None]},
                '_id': 0
            }}
        ]

        items = list(db.reports.aggregate(pipeline))
        # Filter to only those with a non-empty latest_compliance (i.e. checked)
        checked = [it for it in items if it.get('latest_compliance_status')]
        for it in checked:
            lac = it.get('latest_compliance_at')
            if hasattr(lac, 'isoformat'):
                it['latest_compliance_at'] = lac.isoformat()

        return jsonify({'items': checked}), 200
    except Exception as e:
        print(f"Error listing checked reports for audits: {e}")
        return jsonify({'message': 'Failed to list checked reports', 'error': str(e)}), 500


@audit_bp.post('/report/<report_id>/compliance')
@jwt_required()
# Only auditors may submit compliance checks.
@role_required(['auditor'])
def submit_report_compliance(user, report_id):
    """Submit compliance check results for a report.

    Expected JSON: { standards: [{standard_id, result("compliant"|"non-compliant"), notes?}], overall: "compliant"|"non-compliant" }
    """
    try:
        payload = request.get_json(force=True)
    except Exception:
        return jsonify({'message': 'Invalid JSON payload'}), 400

    standards = payload.get('standards')
    overall = payload.get('overall')
    if not isinstance(standards, list) or not overall:
        return jsonify({'message': 'Invalid payload: standards (list) and overall status required'}), 422

    # Resolve report id and ensure the report exists and is resolved
    try:
        rid = ObjectId(report_id)
    except Exception:
        rid = report_id

    # Verify report exists
    try:
        report_query = {'_id': rid} if isinstance(rid, ObjectId) else {'_id': report_id}
        report_doc = db.reports.find_one(report_query)
    except Exception:
        report_doc = None

    if not report_doc:
        return jsonify({'message': 'Report not found'}), 404

    # Enforce that compliance checks are performed against resolved reports (checks the resolution)
    status = report_doc.get('status')
    if not (isinstance(status, str) and status.lower() == 'resolved'):
        return jsonify({'message': 'Compliance checks are only allowed for resolved reports'}), 400

    # Validate standards entries and enrich with standard titles when possible
    now = datetime.now()
    validated_standards = []
    for s in standards:
        sid = s.get('standard_id')
        result_val = s.get('result')
        notes = s.get('notes')
        if not sid or result_val not in ('compliant', 'non-compliant'):
            return jsonify({'message': 'Each standard entry requires standard_id and result (compliant|non-compliant)'}), 422

        # Attempt to resolve standard title/control id from the compliance_standards collection
        std_title = None
        std_control = None
        try:
            try:
                std_oid = ObjectId(sid)
            except Exception:
                std_oid = None

            if std_oid:
                std_doc = db.compliance_standards.find_one({'_id': std_oid})
            else:
                std_doc = db.compliance_standards.find_one({'_id': sid})

            if std_doc:
                std_title = std_doc.get('name') or std_doc.get('title')
                std_control = std_doc.get('control_id')
        except Exception:
            std_doc = None

        # Append standard with explicit ordering: standard_id, title, control_id, result, notes
        validated_standards.append({
            'standard_id': sid,
            'title': std_title,
            'control_id': std_control,
            'result': result_val,
            'notes': notes
        })

    try:
        # Recalculate overall server-side: compliant only if all standards are compliant
        overall_calc = 'compliant' if all(s.get('result') == 'compliant' for s in validated_standards) else 'non-compliant'

        # Build enriched compliance document that includes a brief report summary
        report_summary = {
            'report_id': str(report_doc.get('_id')),
            'title': report_doc.get('title'),
            'severity': report_doc.get('severity'),
            'status': report_doc.get('status'),
            'reporter_username': report_doc.get('reporter_username') or report_doc.get('reporter') or report_doc.get('reporter_name'),
            'created_at': report_doc.get('created_at')
        }

        # Ensure we have an auditor_email; fall back to DB lookup if missing in the JWT/user object
        auditor_email = user.get('email')
        if not auditor_email:
            try:
                # try to find the auditor record by id in known collections
                aid = str(user.get('_id'))
                audit_rec = None
                for coll in ('auditors', 'admins', 'superadmins'):
                    try:
                        audit_rec = db[coll].find_one({'_id': ObjectId(aid)})
                        if audit_rec:
                            break
                    except Exception:
                        # try string id match
                        try:
                            audit_rec = db[coll].find_one({'_id': aid})
                            if audit_rec:
                                break
                        except Exception:
                            continue
                if audit_rec:
                    auditor_email = audit_rec.get('email')
            except Exception:
                auditor_email = None

        # Build comp_doc with requested field order:
        # auditor_id, auditor_username, auditor_email, report_id, report_summary (title,...), overall, created_at, standards (last)
        comp_doc = {
            'auditor_id': str(user.get('_id')),
            'auditor_username': user.get('username'),
            'auditor_email': auditor_email,
            'report_id': rid,
            'report_summary': {
                'title': report_summary.get('title'),
                'severity': report_summary.get('severity'),
                'status': report_summary.get('status'),
                'created_at': report_summary.get('created_at')
            },
            'overall': overall_calc,
            'created_at': now
        }

        # attach standards as the last field to enforce ordering
        comp_doc['standards'] = validated_standards

        # Persist the enriched document with ordered fields. Use replace_one with upsert to ensure order when creating or replacing.
        try:
            db.compliance_reports.replace_one({'report_id': rid}, comp_doc, upsert=True)
        except Exception:
            # fallback to update_one
            db.compliance_reports.update_one({'report_id': rid}, {'$set': comp_doc}, upsert=True)

        # Optionally remove legacy per-standard records to avoid duplication
        try:
            db.compliance_checks.delete_many({'report_id': rid})
        except Exception:
            # Non-fatal if legacy collection doesn't exist or deletion fails
            pass

        # Update report with latest_compliance_status for quick display in listings
        update = {'latest_compliance_status': overall, 'latest_compliance_at': now}
        try:
            db.reports.update_one({'_id': report_doc['_id']}, {'$set': update})
        except Exception:
            # Fallback: try matching by string id
            try:
                db.reports.update_one({'_id': report_id}, {'$set': update})
            except Exception:
                pass

        return jsonify({'message': 'Compliance results recorded'}), 201
    except Exception as e:
        print(f"Error saving compliance checks for report {report_id}: {e}")
        return jsonify({'message': 'Failed to record compliance results', 'error': str(e)}), 500


@audit_bp.get('/stats')
@jwt_required()
@role_required(['auditor', 'admin'])
def get_audit_stats(user):
    """
    Provides statistics for the auditor dashboard including severity breakdowns.
    """
    # New classification logic using report_assignments:
    # - total: all submitted reports
    # - resolved: reports where reports.status == 'Resolved'
    # - pending: reports that have a current assignee (latest assignment has assignee_name) and are not resolved
    # - open: reports with no assignment or with an assignment that has no assignee (initial submission)

    try:
        reports_cursor = db.reports.find({}, {'severity':1, 'status':1})
        total_reports = 0
        resolved_reports = 0
        pending_reports = 0
        open_reports = 0

        # Initialize severity snapshot
        severities = ['critical','high','medium','low']
        severity_snapshot = {s: {'total':0, 'resolved':0, 'pending':0, 'open':0} for s in severities}

        for r in reports_cursor:
            total_reports += 1
            sev = (r.get('severity') or '').lower()
            if sev not in severity_snapshot:
                # normalize unknown severities into 'low' bucket
                sev = 'low'

            status = r.get('status')
            if status == 'Resolved' or (isinstance(status, str) and status.lower() == 'resolved'):
                resolved_reports += 1
                severity_snapshot[sev]['total'] += 1
                severity_snapshot[sev]['resolved'] += 1
                continue

            # Not resolved: determine assignment state
            # Get the latest assignment (if any)
            assignment_cursor = db.report_assignments.find({'report_id': r.get('_id')}).sort('assigned_at', -1).limit(1)
            assignment = None
            try:
                assignment = next(assignment_cursor, None)
            except Exception:
                assignment = None

            if not assignment or not assignment.get('assignee_name'):
                # no assignee -> open
                open_reports += 1
                severity_snapshot[sev]['total'] += 1
                severity_snapshot[sev]['open'] += 1
            else:
                # assigned (or reassigned) and not resolved -> pending
                pending_reports += 1
                severity_snapshot[sev]['total'] += 1
                severity_snapshot[sev]['pending'] += 1

        stats = {
            'total_reports': total_reports,
            'resolved_reports': resolved_reports,
            'pending_reports': pending_reports,
            'open_reports': open_reports,
            'severity_snapshot': severity_snapshot
        }
        return jsonify(stats), 200
    except Exception as e:
        print(f"Error computing audit stats: {e}")
        return jsonify({'message': 'Failed to compute statistics', 'error': str(e)}), 500


@audit_bp.get('/reports/timeseries')
@jwt_required()
@role_required(['auditor'])
def get_reports_timeseries(user):
    """Return daily counts by severity between start and end (YYYY-MM-DD).

    Response: { items: [ {date: 'YYYY-MM-DD', critical: N, high: N, medium: N, low: N}, ... ] }
    """
    try:
        start_str = request.args.get('start')
        end_str = request.args.get('end')

        # Default to last 30 days (inclusive)
        today = datetime.utcnow().date()
        if not end_str:
            end_date = today
        else:
            try:
                end_date = datetime.fromisoformat(end_str).date()
            except Exception:
                return jsonify({'message': 'Invalid end date format. Use YYYY-MM-DD.'}), 400

        if not start_str:
            start_date = end_date - timedelta(days=29)
        else:
            try:
                start_date = datetime.fromisoformat(start_str).date()
            except Exception:
                return jsonify({'message': 'Invalid start date format. Use YYYY-MM-DD.'}), 400

        # Build inclusive datetimes for match
        start_dt = datetime.combine(start_date, datetime.min.time())
        end_dt = datetime.combine(end_date, datetime.max.time())

        pipeline = [
            {'$match': {'created_at': {'$gte': start_dt, '$lte': end_dt}}},
            {'$project': {
                'severity': {'$toLower': {'$ifNull': ['$severity', 'low']}},
                'date': {'$dateToString': {'format': '%Y-%m-%d', 'date': '$created_at'}}
            }},
            {'$group': {'_id': {'date': '$date', 'severity': '$severity'}, 'count': {'$sum': 1}}},
            {'$sort': {'_id.date': 1}}
        ]

        agg = list(db.reports.aggregate(pipeline))

        # Build a map date -> {critical, high, medium, low}
        day_map = {}
        # Pre-seed the full date range with zeros
        cur = start_date
        while cur <= end_date:
            day_map[cur.strftime('%Y-%m-%d')] = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}
            cur = cur + timedelta(days=1)

        for e in agg:
            did = e.get('_id') or {}
            date = did.get('date')
            sev = (did.get('severity') or 'low').lower()
            cnt = int(e.get('count') or 0)
            if date not in day_map:
                day_map[date] = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}
            if sev not in day_map[date]:
                # normalize unexpected severities into 'low'
                sev = 'low'
            day_map[date][sev] = day_map[date].get(sev, 0) + cnt

        # Build ordered items list
        items = []
        cur = start_date
        while cur <= end_date:
            key = cur.strftime('%Y-%m-%d')
            vals = day_map.get(key, {'critical': 0, 'high': 0, 'medium': 0, 'low': 0})
            items.append({'date': key, 'critical': vals.get('critical', 0), 'high': vals.get('high', 0), 'medium': vals.get('medium', 0), 'low': vals.get('low', 0)})
            cur = cur + timedelta(days=1)

        return jsonify({'items': items}), 200
    except Exception as e:
        print(f"Error computing reports timeseries: {e}")
        return jsonify({'message': 'Failed to compute timeseries', 'error': str(e)}), 500

@audit_bp.post('/record')
@jwt_required()
@role_required(['auditor'])
def record_audit(user):
    # The 'Record Audit' feature has been removed from the UI and is deprecated
    # server-side. Return 410 Gone to indicate the endpoint is no longer available.
    return jsonify({'message': 'Record Audit functionality has been removed.'}), 410

@audit_bp.get('/my-audits')
@jwt_required()
@role_required(['auditor'])
def get_my_audits(user):
    """Retrieve audit history for the current auditor."""
    try:
        audits = list(db.audits.find({'auditor_id': str(user['_id'])}).sort('timestamp', -1))

        # Convert ObjectId to string for JSON serialization
        for audit in audits:
            audit['_id'] = str(audit['_id'])
            # Some audit records may not have a timestamp if older migrations
            # or manual inserts occurred; guard accordingly.
            ts = audit.get('timestamp')
            audit['timestamp'] = ts.isoformat() if hasattr(ts, 'isoformat') else str(ts)

        return jsonify(audits), 200
    except Exception as e:
        print(f"Error retrieving audits for user {user.get('username')}: {e}")
        return jsonify({'message': 'Failed to retrieve audit history', 'error': str(e)}), 500

@audit_bp.post('/generate-report')
@jwt_required()
@role_required(['auditor', 'admin'])
def generate_compliance_report(user):
    """Generate a PDF compliance report for a given date range.

    This function validates input, collects relevant reports and compliance
    data, then builds and returns a PDF. Any unexpected error during the
    process is logged with a traceback and a generic 500 response is
    returned to the client.
    """
    data = request.get_json() or {}
    start_date_str = data.get('start_date')
    end_date_str = data.get('end_date')

    if not start_date_str or not end_date_str:
        return jsonify({'message': 'Missing start_date or end_date'}), 400

    try:
        start_date = datetime.fromisoformat(start_date_str)
        end_date = datetime.fromisoformat(end_date_str + 'T23:59:59.999999')
    except ValueError:
        return jsonify({'message': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    try:
        # Fetch reports within the date range. Ensure the created_at filter
        # includes the existence check so we only retrieve reports whose
        # created_at falls inside the requested interval.
        reports = list(db.reports.find({
            'created_at': {'$gte': start_date, '$lte': end_date, '$exists': True}
        }).sort('created_at', 1))

        # Create a buffer to hold the PDF
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []

        # Title
        story.append(Paragraph("Vulnerability Compliance Report", styles['h1']))
        story.append(Paragraph(f"From: {start_date.strftime('%Y-%m-%d')} To: {end_date.strftime('%Y-%m-%d')}", styles['h2']))
        story.append(Spacer(1, 0.2 * 20))

        def _format_date_safe(val):
            """Return a YYYY-MM-DD string for datetimes or ISO strings; fall back
            to today's date string if the value is missing or unparsable."""
            if hasattr(val, 'strftime'):
                try:
                    return val.strftime('%Y-%m-%d')
                except Exception:
                    pass
            if isinstance(val, str):
                try:
                    return datetime.fromisoformat(val).strftime('%Y-%m-%d')
                except Exception:
                    # Fallback: return first 10 chars (likely YYYY-MM-DD)
                    return val[:10]
            return datetime.now().strftime('%Y-%m-%d')

        if not reports:
            story.append(Paragraph("No reports found for the selected date range.", styles['Normal']))
        else:
            # (rest of PDF building logic unchanged)
            total_reports = len(reports)
            resolved_reports = 0
            pending_reports = 0
            open_reports = 0

            severity_counts = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}

            for r in reports:
                status = r.get('status')
                sev = (r.get('severity') or '').lower()
                if sev not in severity_counts:
                    sev = 'low'
                severity_counts[sev] = severity_counts.get(sev, 0) + 1

                if isinstance(status, str) and status.lower() == 'resolved':
                    resolved_reports += 1
                else:
                    try:
                        assignment = db.report_assignments.find({'report_id': r.get('_id')}).sort('assigned_at', -1).limit(1)
                        assignment = list(assignment)
                        if assignment and assignment[0].get('assignee_name'):
                            pending_reports += 1
                        else:
                            open_reports += 1
                    except Exception:
                        open_reports += 1

            summary_data = [
                ['Metric', 'Count'],
                ['Total Reports', total_reports],
                ['Resolved Reports', resolved_reports],
                ['Open Reports', open_reports]
            ]
            summary_table = Table(summary_data, colWidths=[doc.width/2.0]*2)
            summary_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.grey),
                ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('BOTTOMPADDING', (0,0), (-1,0), 12),
                ('BACKGROUND', (0,1), (-1,-1), colors.beige),
                ('GRID', (0,0), (-1,-1), 1, colors.black)
            ]))
            story.append(Paragraph("Report Summary:", styles['h3']))
            story.append(summary_table)
            story.append(Spacer(1, 0.2 * 20))

            try:
                standards = list(db.compliance_standards.find({}, {'_id':1, 'control_id':1, 'name':1, 'description':1}).sort('control_id',1))
            except Exception:
                standards = []

            story.append(Paragraph("Resolved Reports (Checked):", styles['h3']))
            resolved_list = []
            for r in reports:
                if not (r.get('status') == 'Resolved' or (isinstance(r.get('status'), str) and r.get('status').lower() == 'resolved')):
                    continue
                # Try to find a matching compliance document for this report. Historically the
                # `report_id` field may have been stored either as an ObjectId or as a string.
                # To robustly match both cases, query using $or against both forms.
                try:
                    comp = db.compliance_reports.find_one({
                        '$or': [
                            {'report_id': r.get('_id')},
                            {'report_id': str(r.get('_id'))}
                        ]
                    })
                except Exception:
                    comp = None

                if comp and isinstance(comp.get('standards'), list) and len(comp.get('standards')) > 0:
                    resolved_list.append((r, comp))

            if not resolved_list:
                story.append(Paragraph("No resolved and checked reports in the selected time range.", styles['Normal']))
            else:
                for r, comp in resolved_list:
                    story.append(Spacer(1, 0.1 * 20))
                    title = r.get('title', 'Untitled')
                    story.append(Paragraph(f"{title}", styles['h4']))

                    try:
                        res = db.report_resolutions.find_one({'report_id': r.get('_id')}, sort=[('resolved_at', -1)])
                    except Exception:
                        res = None

                    if res and res.get('resolve_steps'):
                        story.append(Paragraph("Resolution Steps:", styles['h5']))
                        # Use Preformatted to preserve line breaks as submitted by auditors
                        pre = Preformatted(res.get('resolve_steps') or '', styles['Normal'])
                        story.append(pre)
                    else:
                        story.append(Paragraph("Resolution Steps: Not recorded.", styles['Normal']))

                    comp_rows = [['Standard', 'Description', 'Result']]
                    std_map = { str(s.get('_id')): s for s in standards }
                    for entry in comp.get('standards'):
                        sid = str(entry.get('standard_id') or entry.get('standard_id'))
                        sdoc = std_map.get(sid)
                        if not sdoc:
                            try:
                                try:
                                    sdoc = db.compliance_standards.find_one({'_id': ObjectId(sid)})
                                except Exception:
                                    sdoc = db.compliance_standards.find_one({'_id': sid})
                            except Exception:
                                sdoc = None

                        if sdoc and sdoc.get('name'):
                            sname = sdoc.get('name')
                        elif sdoc and sdoc.get('control_id'):
                            sname = sdoc.get('control_id')
                        else:
                            sname = sid

                        sdesc_text = ''
                        if sdoc and sdoc.get('description'):
                            sdesc_text = sdoc.get('description')
                        else:
                            sdesc_text = entry.get('title') or entry.get('description') or ''

                        result = 'Compliant' if entry.get('result') == 'compliant' else 'Non-compliant'
                        # Ensure the standard name is wrapped to avoid overflowing into the description column
                        sname_para = Paragraph(sname or '', styles['Normal'])
                        desc_para = Paragraph(sdesc_text or '', styles['Normal'])
                        comp_rows.append([sname_para, desc_para, result])

                    comp_table = Table(comp_rows, colWidths=[doc.width*0.30, doc.width*0.50, doc.width*0.20])
                    comp_table.setStyle(TableStyle([
                        ('BACKGROUND', (0,0), (-1,0), colors.grey),
                        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
                        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
                        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                        ('BOTTOMPADDING', (0,0), (-1,0), 8),
                        ('GRID', (0,0), (-1,-1), 0.5, colors.black),
                        ('VALIGN', (0,0), (-1,-1), 'TOP')
                    ]))
                    story.append(comp_table)
                    # Add auditor attribution below the compliance table (name on one line, email on the next)
                    try:
                        auditor_name = comp.get('auditor_username') or comp.get('auditor_id') or 'Unknown'
                        auditor_email = comp.get('auditor_email') or ''
                        story.append(Spacer(1, 0.05 * 20))
                        # Header line
                        story.append(Paragraph("As Audited by:", styles['Normal']))
                        # Auditor name
                        story.append(Paragraph(str(auditor_name), styles['Normal']))
                        # Auditor email on the next line (if available)
                        if auditor_email:
                            # keep email visually distinct (smaller font using a simple font tag)
                            try:
                                story.append(Paragraph(f"<font size=9>{auditor_email}</font>", styles['Normal']))
                            except Exception:
                                story.append(Paragraph(str(auditor_email), styles['Normal']))
                    except Exception:
                        # Non-fatal: continue if auditor info missing
                        pass

            story.append(Spacer(1, 0.3 * 20))

            story.append(Paragraph("Unresolved Reports:", styles['h3']))
            unresolved = [r for r in reports if r.get('status') != 'Resolved']
            if not unresolved:
                story.append(Paragraph("No unresolved reports in the selected time range.", styles['Normal']))
            else:
                ur_data = [['Title', 'Severity', 'Status', 'Created At']]
                for r in unresolved:
                    ur_data.append([
                        r.get('title', 'N/A'),
                        r.get('severity', 'N/A'),
                        r.get('status', 'N/A'),
                        _format_date_safe(r.get('created_at'))
                    ])
                ur_table = Table(ur_data, colWidths=[doc.width*0.4, doc.width*0.2, doc.width*0.2, doc.width*0.2])
                ur_table.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,0), colors.darkblue),
                    ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
                    ('ALIGN', (0,0), (-1,-1), 'LEFT'),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('BOTTOMPADDING', (0,0), (-1,0), 12),
                    ('BACKGROUND', (0,1), (-1,-1), colors.white),
                    ('GRID', (0,0), (-1,-1), 1, colors.black),
                    ('FONTSIZE', (0,0), (-1,-1), 9),
                ]))
                story.append(ur_table)

        doc.build(story)
        buffer.seek(0)

        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'Compliance_Report_{start_date_str}_to_{end_date_str}.pdf'
        )
    except Exception as e:
        # Print full traceback to server logs for easier debugging
        tb = traceback.format_exc()
        traceback.print_exc()
        print(f"Error generating compliance report: {e}")

        # Also write the traceback to a timestamped file under backend/logs
        try:
            import os
            log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), '..', 'logs')
            # Normalize the path and ensure directory exists
            log_dir = os.path.abspath(log_dir)
            os.makedirs(log_dir, exist_ok=True)
            fname = datetime.now().strftime('generate_report_error_%Y%m%dT%H%M%S.log')
            path = os.path.join(log_dir, fname)
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(tb)
            print(f"Wrote traceback to {path}")
        except Exception as ex:
            print(f"Failed to write traceback to file: {ex}")

        return jsonify({'message': 'Internal server error while generating report', 'error': str(e)}), 500
