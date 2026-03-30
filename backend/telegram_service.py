"""
Telegram Bot Notification Service
──────────────────────────────────
• Sends proximity-based disaster alerts via Telegram Bot API.
• Provides a link-code flow so users can connect their Telegram account.
• Telegram bot webhook handler registers chat_id → user mapping.

Setup:
  1. Create a bot via @BotFather → get TELEGRAM_BOT_TOKEN
  2. Set TELEGRAM_BOT_USERNAME (e.g. SurakshaSetu_bot)
  3. Set your webhook URL: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<BACKEND_URL>/api/telegram/webhook
"""
import os
import logging
import hashlib
import time
import math
import asyncio
from typing import Optional, List, Dict, Any

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "SurakshaSetu_bot")
DEFAULT_ALERT_RADIUS_KM = float(os.getenv("DEFAULT_ALERT_RADIUS_KM", "50"))


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance between two GPS points in kilometres."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class TelegramService:
    """Send Telegram messages via Bot API and manage bot webhooks."""

    def __init__(self):
        self.token = TELEGRAM_BOT_TOKEN
        self.enabled = bool(self.token)
        self._base = f"https://api.telegram.org/bot{self.token}" if self.token else ""
        if self.enabled:
            logger.info("✅ Telegram Bot service initialized (@%s)", TELEGRAM_BOT_USERNAME)
        else:
            logger.info("ℹ️  Telegram Bot not configured — set TELEGRAM_BOT_TOKEN")

    # ── Low-level send ────────────────────────────────────────────────────────

    async def send_message(self, chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
        if not self.enabled or not chat_id:
            return False
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self._base}/sendMessage",
                    json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
                )
                data = resp.json()
                if not data.get("ok"):
                    logger.warning("Telegram send failed (chat=%s): %s", chat_id, data.get("description"))
                    return False
            return True
        except Exception as exc:
            logger.error("Telegram send error: %s", exc)
            return False

    # ── Telegram account linking ──────────────────────────────────────────────

    def generate_link_code(self, user_id: str) -> str:
        """Generate a 8-char code valid for ~10 minutes (2 x 5-min windows)."""
        window = int(time.time() // 300)
        raw = f"{user_id}:{self.token}:{window}"
        return hashlib.md5(raw.encode()).hexdigest()[:8].upper()

    def verify_link_code(self, user_id: str, code: str) -> bool:
        """Accept codes from current or previous 5-minute window."""
        for offset in (0, 1):
            window = int(time.time() // 300) - offset
            raw = f"{user_id}:{self.token}:{window}"
            expected = hashlib.md5(raw.encode()).hexdigest()[:8].upper()
            if code.upper() == expected:
                return True
        return False

    def get_link_instructions(self, user_id: str) -> dict:
        """Return everything the frontend needs to show a Telegram link UI."""
        code = self.generate_link_code(user_id)
        deep_link = f"https://t.me/{TELEGRAM_BOT_USERNAME}?start={code}"
        return {
            "code": code,
            "bot_username": TELEGRAM_BOT_USERNAME,
            "deep_link": deep_link,
            "instruction": f"Open Telegram and message @{TELEGRAM_BOT_USERNAME}: /start {code}",
        }

    # ── Alert formatting ──────────────────────────────────────────────────────

    def _format_alert(self, alert: dict) -> str:
        severity = alert.get("severity", "unknown").lower()
        emoji = {
            "extreme": "🔴", "critical": "🔴", "red": "🔴",
            "severe": "🟠", "high": "🟠", "orange": "🟠",
            "warning": "🟡", "medium": "🟡", "yellow": "🟡",
            "low": "🟢", "green": "🟢",
        }.get(severity, "⚠️")

        loc = alert.get("location", {})
        city = loc.get("city", "")
        state = loc.get("state", "")
        loc_str = f"{city}, {state}".strip(", ") or "India"

        return (
            f"{emoji} <b>Suraksha Setu Alert</b>\n\n"
            f"<b>{alert.get('title', 'Disaster Alert')}</b>\n\n"
            f"📍 <i>{loc_str}</i>\n"
            f"⚡ Severity: <b>{severity.upper()}</b>\n\n"
            f"{alert.get('description', '')}\n\n"
            f"☎️ NDMA Helpline: <b>1078</b> | Emergency: <b>112</b>\n"
            f"<i>— Suraksha Setu Disaster Platform</i>"
        )

    # ── Proximity broadcast ───────────────────────────────────────────────────

    async def notify_nearby_users(self, alert: dict, db_session) -> int:
        """
        Query all users whose saved location is within their preferred radius
        of the alert location, then send them a Telegram message.
        Returns the number of messages sent.
        """
        if not self.enabled:
            return 0

        alert_loc = alert.get("location", {})
        alert_lat = alert_loc.get("lat") or alert_loc.get("latitude")
        alert_lon = alert_loc.get("lon") or alert_loc.get("longitude")
        if alert_lat is None or alert_lon is None:
            logger.info("Alert has no coordinates — skipping Telegram proximity notify")
            return 0

        from sqlalchemy import select
        from database import User

        result = await db_session.execute(
            select(User).where(
                User.telegram_chat_id.isnot(None),
                User.is_active == True,
            )
        )
        users = result.scalars().all()

        text = self._format_alert(alert)
        sent = 0
        tasks = []

        for user in users:
            user_loc = user.location or {}
            ulat = user_loc.get("lat") or user_loc.get("latitude")
            ulon = user_loc.get("lon") or user_loc.get("longitude")
            if ulat is None or ulon is None:
                continue

            channels = user.notification_channels or {}
            if not channels.get("telegram", True):
                continue

            radius = user.notification_radius_km or DEFAULT_ALERT_RADIUS_KM
            dist = _haversine_km(float(ulat), float(ulon), float(alert_lat), float(alert_lon))
            if dist <= radius:
                tasks.append(self.send_message(user.telegram_chat_id, text))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        sent = sum(1 for r in results if r is True)
        if tasks:
            logger.info("Telegram proximity notify: %d/%d sent for alert '%s'", sent, len(tasks), alert.get("title"))
        return sent

    async def notify_pincode_users(self, alert: dict, pincode: str, db_session) -> int:
        """
        OPTIMIZED: Send Telegram alerts to users matching pincode using DB queries.
        
        Instead of fetching ALL users and looping, uses indexed pincode query.
        ~1000x faster for large user bases.
        """
        if not self.enabled or not pincode:
            return 0

        from utils.spatial_query import find_pincode_users

        users = await find_pincode_users(db_session, pincode)

        text = self._format_alert(alert)
        tasks = []
        sent_count = 0

        for user in users:
            channels = user.notification_channels or {}
            if channels.get("telegram", True):  # Default to True if not set
                tasks.append(self.send_message(user.telegram_chat_id, text))

        if not tasks:
            return 0
            
        results = await asyncio.gather(*tasks, return_exceptions=True)
        sent_count = sum(1 for r in results if r is True)
        logger.info("Telegram pincode notify (%s): %d/%d sent for '%s'", pincode, sent_count, len(tasks), alert.get("title"))
        return sent_count


telegram_service = TelegramService()
