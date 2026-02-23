import os
import imaplib
import email
from email.header import decode_header
import re
from datetime import datetime

from ..services.db_service import db
import email.utils


def _extract_reply_text(body: str) -> str:
    """Attempt to extract the top-most reply text from an email body.

    Heuristics used:
    - Strip lines that start with '>' (quoted lines).
    - Stop at common reply separators like 'On <date> wrote:', 'From:', '-----Original Message-----',
      lines of dashes, or 'Sent from my'.
    - Remove consecutive blank lines at start/end.
    """
    if not body:
        return ''

    # Normalize line endings and split
    lines = body.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    out_lines = []
    stop_patterns = [
        re.compile(r'^On .*wrote:$', re.IGNORECASE),
        re.compile(r'^From:\s+.*', re.IGNORECASE),
        re.compile(r'^-----Original Message-----', re.IGNORECASE),
        re.compile(r'^-{2,}$'),
        re.compile(r'^__+'),
        re.compile(r'^>+'),
        re.compile(r'^Sent from my', re.IGNORECASE),
        re.compile(r'^Forwarded message', re.IGNORECASE),
        re.compile(r'^Subject:\s', re.IGNORECASE),
    ]

    for ln in lines:
        s = ln.strip()
        if not s:
            # keep blank lines inside, but don't stop on first blank
            out_lines.append('')
            continue

        # If line looks like a quoted-line or reply header, stop parsing further
        if any(p.match(s) for p in stop_patterns):
            break

        # Skip quoted lines starting with >
        if s.startswith('>'):
            continue

        out_lines.append(ln)

    # Trim leading/trailing blank lines
    while out_lines and out_lines[0].strip() == '':
        out_lines.pop(0)
    while out_lines and out_lines[-1].strip() == '':
        out_lines.pop()

    text = '\n'.join(out_lines).strip()
    # Limit to reasonable size
    return text[:5000]


def _get_vrs_rid_from_msg(msg):
    """Return the first VRS-RID value found in message headers (case-insensitive) or None."""
    try:
        for k, v in msg.items():
            if k and k.lower() == 'vrs-rid' and v:
                m = REPORT_ID_RE.search(v)
                if m:
                    return m.group(0)
    except Exception:
        pass
    return None

IMAP_HOST = os.getenv('EMAIL_IMAP_HOST')
IMAP_USER = os.getenv('EMAIL_IMAP_USER')
IMAP_PASS = os.getenv('EMAIL_IMAP_PASS')
IMAP_MAILBOX = os.getenv('EMAIL_IMAP_MAILBOX', 'INBOX')

REPORT_ID_RE = re.compile(r"[a-fA-F0-9]{24}")


def fetch_unseen_feedbacks(include_seen: bool = False):
    """Connects to IMAP and fetches emails, parsing feedback entries.

    By default this fetches only UNSEEN messages. Set include_seen=True to
    scan all messages. The function deduplicates by Message-ID to avoid
    inserting the same email multiple times.

    Returns a list of inserted feedback docs (as dicts).
    """
    if not IMAP_HOST or not IMAP_USER or not IMAP_PASS:
        raise RuntimeError('IMAP credentials not configured (EMAIL_IMAP_HOST/USER/PASS)')

    inserted = []
    try:
        # prevent indefinite blocking on slow IMAP servers
        import socket
        socket.setdefaulttimeout(int(os.getenv('EMAIL_IMAP_SOCKET_TIMEOUT', '30')))

        mail = imaplib.IMAP4_SSL(IMAP_HOST)
        mail.login(IMAP_USER, IMAP_PASS)
        mail.select(IMAP_MAILBOX)

# Only ingest messages that are addressed to the application's dedicated mailbox.
# This prevents accidentally ingesting items from a personal mailbox if the IMAP credentials point to one.
        app_address = (os.getenv('APP_MAIL_ADDRESS') or os.getenv('MAIL_USERNAME') or os.getenv('EMAIL_IMAP_USER') or '').lower()

        # Build a targeted candidate message set to avoid scanning the entire mailbox
        candidate_nums = set()

        # 1) Search for messages that reference Message-IDs we sent (In-Reply-To / References)
        try:
            for sm in db.sent_messages.find({}, {'message_id': 1}).sort([('_id', -1)]).limit(200):
                sent_mid = sm.get('message_id')
                if not sent_mid:
                    continue
                try:
                    st, dat = mail.search(None, 'HEADER', 'In-Reply-To', sent_mid)
                    if st == 'OK' and dat and dat[0]:
                        for n in dat[0].split():
                            candidate_nums.add(n)
                except Exception:
                    pass
                try:
                    st, dat = mail.search(None, 'HEADER', 'References', sent_mid)
                    if st == 'OK' and dat and dat[0]:
                        for n in dat[0].split():
                            candidate_nums.add(n)
                except Exception:
                    pass
        except Exception:
            pass

        # 2) Also search for messages whose subject contains a 24-hex report id token
        try:
            for r in db.reports.find({}, {'_id': 1}).sort([('_id', -1)]).limit(200):
                rid = str(r.get('_id'))
                if not rid:
                    continue
                try:
                    st, dat = mail.search(None, 'SUBJECT', rid)
                    if st == 'OK' and dat and dat[0]:
                        for n in dat[0].split():
                            candidate_nums.add(n)
                except Exception:
                    pass
        except Exception:
            pass

        # 3) If nothing targeted was found, fall back to UNSEEN (or ALL if include_seen)
        if not candidate_nums:
            search_term = 'ALL' if include_seen else 'UNSEEN'
            status, messages = mail.search(None, search_term)
            if status != 'OK':
                try:
                    mail.logout()
                except Exception:
                    pass
                return inserted
            for num in messages[0].split():
                candidate_nums.add(num)

        # iterate candidates (sorted numeric)
        for num in sorted(candidate_nums, key=lambda x: int(x)):
            try:
# Fetch only headers first to avoid downloading large bodies
# Also request the custom VRS-RID header so we can detect report ids from headers without fetching the full body.
                hdr_fetch = 'BODY.PEEK[HEADER.FIELDS (TO CC SUBJECT MESSAGE-ID IN-REPLY-TO REFERENCES DATE FROM VRS-RID)]'
                typ, data = mail.fetch(num, f'({hdr_fetch})')
                if typ != 'OK' or not data or not data[0]:
                    # if header fetch fails, skip
                    try:
                        mail.store(num, '+FLAGS', '\\Seen')
                    except Exception:
                        pass
                    continue

                hdr_bytes = data[0][1]
                # Some servers return the header block as bytes directly; ensure bytes
                if isinstance(hdr_bytes, str):
                    hdr_bytes = hdr_bytes.encode('utf-8', errors='ignore')

                hdr_msg = email.message_from_bytes(hdr_bytes)

                # recipients check
                if app_address:
                    to_hdr = (hdr_msg.get('To') or '') + ' ' + (hdr_msg.get('Cc') or '')
                    if app_address not in to_hdr.lower():
                        # Not addressed to the app mailbox; mark seen and skip
                        try:
                            mail.store(num, '+FLAGS', '\\Seen')
                        except Exception:
                            pass
                        continue

                # dedupe based on incoming Message-ID in headers
                incoming_msg_id = hdr_msg.get('Message-ID')
                if incoming_msg_id:
                    incoming_msg_id = incoming_msg_id.strip()
                    if db.report_feedbacks.find_one({'message_id': incoming_msg_id}):
                        try:
                            mail.store(num, '+FLAGS', '\\Seen')
                        except Exception:
                            pass
                        continue

# Determine whether this message is relevant. We only consider messages that either include a VRS-RID header or contain a
# 24-hex report id token in the subject (we will later also search the body).
# Do NOT accept replies purely because they reference our Message-ID unless a report id or VRS-RID is present.
                matched = False

                # Check for explicit VRS-RID header (preferred)
                hdr_vrs = _get_vrs_rid_from_msg(hdr_msg)
                if hdr_vrs:
                    matched = True

                # Fallback: try report_id in subject
                raw_subj = hdr_msg.get('Subject', '')
                try:
                    subj_part, enc = decode_header(raw_subj)[0]
                    if isinstance(subj_part, bytes):
                        subj = subj_part.decode(enc or 'utf-8', errors='ignore')
                    else:
                        subj = subj_part
                except Exception:
                    subj = raw_subj
                rid_match = REPORT_ID_RE.search(subj)
                if rid_match:
                    matched = True

                if not matched:
                    # No VRS-RID header and no report_id token in subject -> skip
                    try:
                        mail.store(num, '+FLAGS', '\\Seen')
                    except Exception:
                        pass
                    continue

                # Now fetch the full message body because this looks relevant
                typ2, data2 = mail.fetch(num, '(RFC822)')
                if typ2 != 'OK' or not data2 or not data2[0]:
                    try:
                        mail.store(num, '+FLAGS', '\\Seen')
                    except Exception:
                        pass
                    continue

                full_msg = email.message_from_bytes(data2[0][1])

                # Extract report_id from header (VRS-RID) or subject/body
                raw_subj2 = full_msg.get('Subject', subj)
                try:
                    subj2_part, enc2 = decode_header(raw_subj2)[0]
                    if isinstance(subj2_part, bytes):
                        subj2 = subj2_part.decode(enc2 or 'utf-8', errors='ignore')
                    else:
                        subj2 = subj2_part
                except Exception:
                    subj2 = raw_subj2

                # Prefer VRS-RID header if present on the full message
                full_hdr_vrd = _get_vrs_rid_from_msg(full_msg)
                rid_match2 = None
                if full_hdr_vrd:
                    rid_match2 = REPORT_ID_RE.search(full_hdr_vrd)
                else:
                    rid_match2 = REPORT_ID_RE.search(subj2)

                # Extract body text (plain)
                body = ''
                if full_msg.is_multipart():
                    for part in full_msg.walk():
                        ctype = part.get_content_type()
                        cdisp = part.get('Content-Disposition', '')
                        if ctype == 'text/plain' and 'attachment' not in cdisp:
                            try:
                                body = part.get_payload(decode=True).decode(part.get_content_charset() or 'utf-8', errors='ignore')
                                break
                            except Exception:
                                continue
                else:
                    try:
                        body = full_msg.get_payload(decode=True).decode(full_msg.get_content_charset() or 'utf-8', errors='ignore')
                    except Exception:
                        body = str(full_msg.get_payload())

                if not rid_match2:
                    rid_match2 = REPORT_ID_RE.search(body)

                report_id = rid_match2.group(0) if rid_match2 else (hdr_vrs if hdr_vrs else None)
                # If report_id looks like a Mongo ObjectId, store as ObjectId so
                # other code (which queries by ObjectId) can find the document.
                try:
                    from bson.objectid import ObjectId
                    try:
                        report_obj_id = ObjectId(report_id) if report_id else None
                    except Exception:
                        report_obj_id = None
                except Exception:
                    report_obj_id = None

                # Sender
                from_hdr = full_msg.get('From', hdr_msg.get('From', ''))
                m = re.search(r'<([^>]+)>', from_hdr)
                sender_email = (m.group(1).strip() if m else from_hdr).strip()

                # Use sender name if available
                name_match = re.match(r'"?([^"<]+)"?\s*<', from_hdr)
                assignee_name = name_match.group(1).strip() if name_match else sender_email

                # Extract reply-only text (exclude quoted original messages)
                reply_text = _extract_reply_text(body)
                feedback_text = (reply_text or body or '').strip()[:5000]
                # If the extracted feedback text is empty or only whitespace, it's
                # likely not an assignee's resolution/feedback. Skip inserting these so
                # the `report_feedbacks` collection only contains meaningful
                # feedback entries.
                if not feedback_text:
                    try:
                        mail.store(num, '+FLAGS', '\\Seen')
                    except Exception:
                        pass
                    continue
                feedback_at = None
                date_hdr = full_msg.get('Date') or hdr_msg.get('Date')
                try:
                    feedback_at = email.utils.parsedate_to_datetime(date_hdr) if date_hdr else datetime.utcnow()
                except Exception:
                    feedback_at = datetime.utcnow()

                # If we couldn't find a report_id, mark seen and skip
                if not report_id:
                    try:
                        mail.store(num, '+FLAGS', '\\Seen')
                    except Exception:
                        pass
                    continue

                # Validate the report exists
                report_doc = None
                if report_obj_id is not None:
                    try:
                        report_doc = db.reports.find_one({'_id': report_obj_id})
                    except Exception:
                        report_doc = None
                if not report_doc:
                    # Unknown report_id -> skip
                    try:
                        mail.store(num, '+FLAGS', '\\Seen')
                    except Exception:
                        pass
                    continue

                # If the report is already resolved, do not ingest further feedbacks for it.
                # Resolved reports have status 'Resolved' (case-insensitive).
                try:
                    status = (report_doc.get('status') or '') if isinstance(report_doc, dict) else ''
                    if isinstance(status, str) and status.strip().lower() == 'resolved':
                        try:
                            mail.store(num, '+FLAGS', '\\Seen')
                        except Exception:
                            pass
                        continue
                except Exception:
                    # If we cannot determine status for any reason, proceed with caution
                    pass

                # Validate sender is the current assignee for this report.
                # Look up the latest assignment (if any) in report_assignments.
                try:
                    assigns = list(db.report_assignments.find({'report_id': report_obj_id}))
                except Exception:
                    assigns = []
                latest_assign = None
                if assigns:
                    # sort by assigned_at if present, otherwise by ObjectId
                    def _akey(x):
                        return x.get('assigned_at') or x.get('_id')
                    assigns_sorted = sorted(assigns, key=_akey)
                    latest_assign = assigns_sorted[-1]

                # Determine expected assignee email from latest assignment or report doc
                expected_assignee = None
                if latest_assign:
                    expected_assignee = (latest_assign.get('assignee_email') or '').lower()
                if not expected_assignee:
                    expected_assignee = (report_doc.get('assignee_email') or '').lower() if report_doc else None

                if expected_assignee:
                    if not sender_email or sender_email.lower() != expected_assignee:
                        # Not from the assigned user -> skip
                        try:
                            mail.store(num, '+FLAGS', '\\Seen')
                        except Exception:
                            pass
                        continue

                # Store feedback from ingest 
                doc = {
                    'report_id': report_obj_id if report_obj_id is not None else report_id,
                    'assignee_name': assignee_name,
                    'assignee_email': sender_email,
                    'feedback_text': feedback_text,
                    'feedback_at': feedback_at
                }
                if incoming_msg_id:
                    doc['message_id'] = incoming_msg_id

                try:
                    db.report_feedbacks.insert_one(doc)
                    inserted.append(doc)
                except Exception:
                    pass

                # Mark the message as seen
                try:
                    mail.store(num, '+FLAGS', '\\Seen')
                except Exception:
                    pass

            except Exception:
                continue

        try:
            mail.logout()
        except Exception:
            pass

    except Exception as ex:
        # Bubble up so caller/scheduler can log
        raise

    return inserted
