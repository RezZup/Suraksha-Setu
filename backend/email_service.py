"""
Email Notification Service — Mailtrap SMTP
──────────────────────────────────────────
Sends HTML disaster alert emails to users who are within radius
and have opted into email notifications.

Setup (add to .env):
  MAILTRAP_HOST=live.smtp.mailtrap.io
  MAILTRAP_PORT=587
  MAILTRAP_USERNAME=api
  MAILTRAP_PASSWORD=<your_mailtrap_api_key>
  EMAIL_FROM=alerts@surakshasetu.com
  EMAIL_FROM_NAME=Suraksha Setu
"""
import os
import logging
import smtplib
import asyncio
import math
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)

MAILTRAP_HOST = os.getenv("MAILTRAP_HOST", "live.smtp.mailtrap.io")
MAILTRAP_PORT = int(os.getenv("MAILTRAP_PORT", "587"))
MAILTRAP_USERNAME = os.getenv("MAILTRAP_USERNAME", "")
MAILTRAP_PASSWORD = os.getenv("MAILTRAP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "alerts@surakshasetu.com")
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "Suraksha Setu")
DEFAULT_ALERT_RADIUS_KM = float(os.getenv("DEFAULT_ALERT_RADIUS_KM", "50"))


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class EmailService:
    def __init__(self):
        # EMAIL_ENABLED=false pauses all email sending without removing config
        email_enabled_flag = os.getenv("EMAIL_ENABLED", "false").lower() not in ("false", "0", "no")
        self.enabled = email_enabled_flag and bool(MAILTRAP_USERNAME and MAILTRAP_PASSWORD)
        if self.enabled:
            logger.info("✅ Email service initialized (Mailtrap SMTP: %s:%s)", MAILTRAP_HOST, MAILTRAP_PORT)
        else:
            logger.info("ℹ️  Email service paused — set EMAIL_ENABLED=true + MAILTRAP credentials to activate")

    # ── HTML email builder ────────────────────────────────────────────────────

    def _build_alert_email(self, alert: dict) -> tuple[str, str]:
        severity = alert.get("severity", "unknown").upper()
        title = alert.get("title", "Disaster Alert")
        description = alert.get("description", "")
        loc = alert.get("location", {})
        city = loc.get("city", "")
        state = loc.get("state", "")
        loc_str = f"{city}, {state}".strip(", ") or "India"
        source = alert.get("source", "Suraksha Setu")

        color = {
            "EXTREME": "#dc2626", "CRITICAL": "#dc2626", "RED": "#dc2626",
            "SEVERE": "#ea580c", "HIGH": "#ea580c", "ORANGE": "#ea580c",
            "WARNING": "#ca8a04", "MEDIUM": "#ca8a04", "YELLOW": "#ca8a04",
        }.get(severity, "#16a34a")

        subject = f"⚠️ [{severity}] {title} — Suraksha Setu Alert"

        html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.12)">

    <!-- Header -->
    <div style="background:{color};padding:28px 32px;text-align:center">
      <div style="font-size:40px;margin-bottom:8px">⚠️</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Suraksha Setu Alert</h1>
      <span style="display:inline-block;margin-top:10px;background:rgba(255,255,255,0.22);color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600">{severity}</span>
    </div>

    <!-- Body -->
    <div style="padding:32px">
      <h2 style="margin-top:0;color:#111827;font-size:20px">{title}</h2>

      <div style="background:#f9fafb;border-left:5px solid {color};padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
        <p style="margin:0;color:#374151;line-height:1.7;font-size:15px">{description}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr>
          <td style="padding:10px 0;color:#6b7280;width:130px">📍 Location</td>
          <td style="padding:10px 0;color:#111827;font-weight:600">{loc_str}</td>
        </tr>
        <tr style="border-top:1px solid #f3f4f6">
          <td style="padding:10px 0;color:#6b7280">🛡️ Source</td>
          <td style="padding:10px 0;color:#111827">{source}</td>
        </tr>
      </table>

      <!-- Emergency box -->
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:18px 20px;margin-top:24px">
        <p style="margin:0 0 6px;color:#92400e;font-weight:700;font-size:15px">🆘 Emergency Contacts</p>
        <p style="margin:0;color:#78350f;font-size:14px">
          National Disaster Helpline: <strong>1078</strong> (NDMA) &nbsp;|&nbsp;
          Emergency Services: <strong>112</strong>
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;text-align:center">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6">
        You received this alert because your registered location is within the affected area.<br>
        Manage notification preferences in your <strong>Suraksha Setu</strong> profile.
      </p>
    </div>
  </div>
</body>
</html>"""
        return subject, html

    # ── SMTP send (runs in executor) ──────────────────────────────────────────

    def _send_smtp(self, to_email: str, to_name: str, subject: str, html: str) -> bool:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{EMAIL_FROM_NAME} <{EMAIL_FROM}>"
            msg["To"] = f"{to_name} <{to_email}>" if to_name else to_email
            msg.attach(MIMEText(html, "html", "utf-8"))

            with smtplib.SMTP(MAILTRAP_HOST, MAILTRAP_PORT, timeout=15) as srv:
                srv.ehlo()
                srv.starttls()
                srv.login(MAILTRAP_USERNAME, MAILTRAP_PASSWORD)
                srv.sendmail(EMAIL_FROM, to_email, msg.as_string())

            logger.info("📧 Email sent → %s", to_email)
            return True
        except Exception as exc:
            logger.error("Email send failed → %s: %s", to_email, exc)
            return False

    async def send_alert_email(self, to_email: str, to_name: str, alert: dict) -> bool:
        """Send a single alert email. Non-blocking (thread executor)."""
        if not self.enabled or not to_email:
            return False
        subject, html = self._build_alert_email(alert)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._send_smtp, to_email, to_name, subject, html)

    # ── Proximity broadcast ───────────────────────────────────────────────────

    async def notify_nearby_users(self, alert: dict, db_session) -> int:
        """
        Find all users with email notifications enabled within their alert radius
        and send them an alert email.
        Returns number of emails dispatched.
        """
        if not self.enabled:
            return 0

        alert_loc = alert.get("location", {})
        alert_lat = alert_loc.get("lat") or alert_loc.get("latitude")
        alert_lon = alert_loc.get("lon") or alert_loc.get("longitude")
        if alert_lat is None or alert_lon is None:
            return 0

        from sqlalchemy import select
        from database import User

        result = await db_session.execute(
            select(User).where(
                User.notification_email.isnot(None),
                User.is_active == True,
            )
        )
        users = result.scalars().all()

        tasks = []
        for user in users:
            channels = user.notification_channels or {}
            if not channels.get("email", True):
                continue

            user_loc = user.location or {}
            ulat = user_loc.get("lat") or user_loc.get("latitude")
            ulon = user_loc.get("lon") or user_loc.get("longitude")
            if ulat is None or ulon is None:
                continue

            radius = user.notification_radius_km or DEFAULT_ALERT_RADIUS_KM
            dist = _haversine_km(float(ulat), float(ulon), float(alert_lat), float(alert_lon))
            if dist <= radius:
                name = user.full_name or user.username or ""
                tasks.append(self.send_alert_email(user.notification_email, name, alert))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        sent = sum(1 for r in results if r is True)
        if tasks:
            logger.info("Email proximity notify: %d/%d sent for alert '%s'", sent, len(tasks), alert.get("title"))
        return sent

    # ── Test helper ───────────────────────────────────────────────────────────

    async def send_test_email(self, to_email: str, to_name: str = "") -> bool:
        """Send a test email to verify SMTP credentials."""
        test_alert = {
            "title": "Test Alert — Suraksha Setu",
            "severity": "low",
            "description": "This is a test notification. Your email alerts are configured correctly!",
            "location": {"city": "New Delhi", "state": "Delhi"},
            "source": "Suraksha Setu Test",
        }
        return await self.send_alert_email(to_email, to_name, test_alert)


email_service = EmailService()
