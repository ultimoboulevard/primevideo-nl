"""Email sender for Prime Video NL weekly digest."""
from __future__ import annotations

import email.mime.multipart
import email.mime.text
import logging
import smtplib

from config import SMTP_HOST, SMTP_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_RECIPIENT

log = logging.getLogger(__name__)


def send_digest(html: str, subject: str | None = None) -> bool:
    """Send the digest HTML via Gmail SMTP."""
    if not EMAIL_USER or not EMAIL_PASS:
        log.error("EMAIL_USER / EMAIL_PASS not set — skipping send")
        return False

    if subject is None:
        from datetime import datetime
        subject = f"🎬 Prime Video NL — What's New ({datetime.utcnow().strftime('%b %d, %Y')})"

    msg = email.mime.multipart.MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = EMAIL_USER
    msg["To"] = EMAIL_RECIPIENT

    # Plain text fallback
    plain = "Your weekly Prime Video NL digest is ready. View this email in HTML."
    msg.attach(email.mime.text.MIMEText(plain, "plain"))
    msg.attach(email.mime.text.MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASS)
            server.sendmail(EMAIL_USER, EMAIL_RECIPIENT, msg.as_string())
        log.info("Digest sent to %s", EMAIL_RECIPIENT)
        return True
    except Exception as e:
        log.error("Failed to send digest: %s", e)
        return False
