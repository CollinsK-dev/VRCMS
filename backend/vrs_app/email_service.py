import os
from flask_mail import Message
import email.utils
import socket
from .. import mail
from datetime import datetime

def send_email(to, subject, template, extra_headers=None, track_replies: bool = False):
    """
    Sends an email using Flask-Mail.

    Returns the Message-ID used for the outgoing message (so we can track replies).
    extra_headers: optional dict of additional headers to set on the message.
    """
    #  Use a tuple for the sender to set a display name 
    sender_email = os.environ.get('MAIL_USERNAME')
    if not sender_email:
        raise ValueError("MAIL_USERNAME environment variable not set.")

    msg = Message(
        subject,
        recipients=[to],
        html=template,
        sender=('VRCMS', sender_email)
    )

    generated_id = None
    headers = {}
    if extra_headers and isinstance(extra_headers, dict):
        headers.update(extra_headers)

    # Only generate and attach a Message-ID when the caller explicitly requests reply-tracking (assignments / reassignments).
    # Other system emails don't need a recorded message id and shouldn't be used for reply-correlation.
    if track_replies:
        # Use MAIL_DOMAIN if available so the message-id looks reasonable; fall back to the local hostname.
        domain = os.environ.get('MAIL_DOMAIN')
        if not domain:
            try:
                domain = socket.getfqdn()
            except Exception:
                domain = 'localhost'

        generated_id = email.utils.make_msgid(domain=domain)

        # Ensure Message-ID is set so replies include In-Reply-To referencing it
        if 'Message-ID' not in {k.title(): v for k, v in headers.items()}:
            headers['Message-ID'] = generated_id

    # Flask-Mail uses Message.headers property
    try:
        msg.headers = headers
    except Exception:
        # Some Flask-Mail versions may require update via msg.extra_headers
        try:
            msg.extra_headers = headers
        except Exception:
            # last resort: ignore headers (still send the mail)
            pass

    try:
        mail.send(msg)
    except Exception as e:
        # Log the error so administrators can diagnose SMTP/config issues.
        try:
            print(f"Error sending email to {to}: {e}")
        except Exception:
            pass
#If tracking replies, return the generated Message-ID even if sending failed so the caller can still record the mapping for debugging or retry purposes.
        return headers.get('Message-ID') if track_replies else None

    # Return the message-id only when generated/attached
    return headers.get('Message-ID') if track_replies else None