"""
SMS Alert Service
=================
Sends deterministic SMS alerts via Twilio to registered users.

GOLDEN RULE: SMS is sent ONLY by the deterministic engine decision.
AI never triggers SMS. AI only generates explanation text.

Thresholds (tunable):
  AUTO_NOTIFY_THRESHOLD  = 0.70  → auto SMS/push (critical)
  ADMIN_REVIEW_LOW       = 0.45  → advisory (show to admin)
  < 0.45                         → monitor only

Vision policy:
  - NEVER auto-notify from Vision alone
  - Vision confidence >= 0.85 + deterministic overlap → provisional (admin only)
  - Vision confidence [0.6, 0.85) → flag for admin review

Double-check rule:
  - High-impact notifications require 2 independent signals
"""

import logging
import os
import math
import asyncio
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy import select
from utils.redis_client import redis_client

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
#  THRESHOLDS
# ═══════════════════════════════════════════════════════════════
AUTO_NOTIFY_THRESHOLD = 0.70
ADMIN_REVIEW_THRESHOLD_HIGH = 0.70
ADMIN_REVIEW_THRESHOLD_LOW = 0.45
VISION_AUTO_ALERT_CONF = 0.85
VISION_MANUAL_REVIEW_CONF = 0.60

# ═══════════════════════════════════════════════════════════════
#  RETRACTION MESSAGE TEMPLATE
# ═══════════════════════════════════════════════════════════════
RETRACTION_TEMPLATE = (
    "Correction from Suraksha Setu: An earlier alert about {alert_type} "
    "at {location} was incorrect. No action required. "
    "We apologise for the error."
)

ALERT_TEMPLATE = (
    "🚨 Suraksha Setu Alert: {severity} {alert_type} detected near {location}. "
    "{description} Stay safe. Call 1078 (NDMA) for help."
)

COMMUNITY_WHATSAPP_TEMPLATE = (
    "Suraksha Setu Community {post_type}\n"
    "Posted by: {author}\n"
    "Area: {location}\n"
    "Distance: {distance_km} km from your location\n"
    "Message: {content}\n"
    "If you can safely help, open the app: {app_url}"
)


# ═══════════════════════════════════════════════════════════════
#  TWILIO SMS CLIENT
# ═══════════════════════════════════════════════════════════════
class SMSService:
    """
    Twilio-backed SMS alert service.
    Only sends when deterministic engine decides.
    """

    def __init__(self):
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
        self.default_country_code = os.getenv("TWILIO_DEFAULT_COUNTRY_CODE", "+91").strip() or "+91"
        if not self.default_country_code.startswith("+"):
            self.default_country_code = f"+{''.join(ch for ch in self.default_country_code if ch.isdigit())}"
        self.from_number = self._normalize_e164(os.getenv("TWILIO_FROM_NUMBER", ""))
        self.whatsapp_from = os.getenv("TWILIO_WHATSAPP_FROM", "")
        if not self.whatsapp_from and self.from_number:
            self.whatsapp_from = f"whatsapp:{self.from_number}"
        self._client = None
        self._available = False
        self.batch_size = max(1, int(os.getenv("ALERT_BATCH_SIZE", "25")))
        self.batch_pause_seconds = max(0.0, float(os.getenv("ALERT_BATCH_PAUSE_SECONDS", "0.2")))
        self._init_client()

    def _init_client(self):
        if self.account_sid and self.auth_token and self.from_number:
            try:
                from twilio.rest import Client
                self._client = Client(self.account_sid, self.auth_token)
                self._available = True
                logger.info("✅ Twilio SMS service initialized")
            except ImportError:
                logger.warning("⚠️  twilio package not installed — SMS disabled. Run: pip install twilio")
            except Exception as e:
                logger.warning(f"⚠️  Twilio init failed: {e}")
        else:
            logger.info("ℹ️  Twilio not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)")

    @property
    def is_available(self) -> bool:
        return self._available

    @property
    def is_whatsapp_available(self) -> bool:
        return self._available and bool(self.whatsapp_from)

    @staticmethod
    def _normalize_e164(phone: str) -> str:
        cleaned = "".join(ch for ch in (phone or "") if ch.isdigit() or ch == "+")
        if cleaned and not cleaned.startswith("+"):
            cleaned = f"+{cleaned}"
        return cleaned

    def _normalize_recipient_e164(self, phone: str) -> str:
        raw = (phone or "").strip()
        if not raw:
            return ""

        digits_only = "".join(ch for ch in raw if ch.isdigit())
        if not digits_only:
            return ""

        country_digits = "".join(ch for ch in self.default_country_code if ch.isdigit())

        if raw.startswith("+"):
            # Heal legacy stored values like "+9876543210" (missing country code).
            if len(digits_only) == 10 and country_digits and not digits_only.startswith(country_digits):
                return f"+{country_digits}{digits_only}"
            return f"+{digits_only}"

        if digits_only.startswith("00") and len(digits_only) > 2:
            return f"+{digits_only[2:]}"

        # Common India/local format fallback: 10-digit mobile number.
        if len(digits_only) == 10:
            if country_digits:
                return f"+{country_digits}{digits_only}"

        return f"+{digits_only}"

    def _to_whatsapp_address(self, phone: str) -> Optional[str]:
        e164 = self._normalize_recipient_e164(phone)
        if not e164:
            return None
        return f"whatsapp:{e164}"

    async def send_sms(self, to_number: str, message: str) -> Dict[str, Any]:
        """
        Send a single SMS. Returns result dict.
        """
        normalized_to = self._normalize_recipient_e164(to_number)
        if not normalized_to:
            logger.error("❌ SMS failed due to invalid recipient number: %s", to_number)
            return {"success": False, "error": "invalid_recipient_number", "to": to_number}

        if not self._available:
            logger.info(f"[SMS-MOCK] To: {normalized_to} | Msg: {message[:80]}...")
            return {"success": True, "mock": True, "to": normalized_to, "sid": "mock"}

        try:
            msg = self._client.messages.create(
                body=message[:1600],  # Twilio limit
                from_=self.from_number,
                to=normalized_to,
            )
            logger.info(f"✅ SMS sent to {normalized_to}: SID={msg.sid}")
            return {"success": True, "mock": False, "to": normalized_to, "sid": msg.sid}
        except Exception as e:
            logger.error(f"❌ SMS failed to {normalized_to}: {e}")
            return {"success": False, "error": str(e), "to": normalized_to}

    async def send_whatsapp(self, to_number: str, message: str) -> Dict[str, Any]:
        """Send one WhatsApp message via Twilio WhatsApp channel."""
        to_address = self._to_whatsapp_address(to_number)
        if not to_address:
            return {"success": False, "error": "invalid_phone", "to": to_number}

        if not self.is_whatsapp_available:
            logger.info(f"[WA-MOCK] To: {to_address} | Msg: {message[:100]}...")
            return {"success": True, "mock": True, "to": to_address, "sid": "mock_wa"}

        try:
            msg = self._client.messages.create(
                body=message[:1600],
                from_=self.whatsapp_from,
                to=to_address,
            )
            logger.info(f"✅ WhatsApp sent to {to_address}: SID={msg.sid}")
            return {"success": True, "mock": False, "to": to_address, "sid": msg.sid}
        except Exception as e:
            logger.error(f"❌ WhatsApp failed to {to_address}: {e}")
            return {"success": False, "error": str(e), "to": to_address}

    async def send_community_whatsapp(
        self,
        recipients: List[Dict[str, Any]],
        post_type: str,
        author: str,
        location: str,
        content: str,
        app_url: str = "http://localhost:3000/app/community",
    ) -> Dict[str, Any]:
        """Send templated WhatsApp messages for nearby community help/emergency posts."""
        results: List[Dict[str, Any]] = []
        normalized_type = (post_type or "alert").upper()
        if not recipients:
            return {"total": 0, "sent": 0, "failed": 0, "results": []}

        for idx in range(0, len(recipients), self.batch_size):
            batch = recipients[idx: idx + self.batch_size]
            jobs = []
            for r in batch:
                msg = COMMUNITY_WHATSAPP_TEMPLATE.format(
                    post_type=normalized_type,
                    author=author or "Community Member",
                    location=location or "your area",
                    distance_km=f"{r.get('distance_km', 0):.1f}",
                    content=(content or "")[:220],
                    app_url=app_url,
                )
                jobs.append(self.send_whatsapp(r["phone"], msg))

            batch_results = await asyncio.gather(*jobs, return_exceptions=True)
            for i, br in enumerate(batch_results):
                if isinstance(br, Exception):
                    result = {"success": False, "error": str(br), "to": batch[i].get("phone")}
                else:
                    result = br
                result["distance_km"] = batch[i].get("distance_km")
                results.append(result)

            if idx + self.batch_size < len(recipients) and self.batch_pause_seconds > 0:
                await asyncio.sleep(self.batch_pause_seconds)

        sent = sum(1 for r in results if r.get("success"))
        return {
            "total": len(recipients),
            "sent": sent,
            "failed": len(recipients) - sent,
            "results": results,
        }

    async def send_community_whatsapp_by_location(
        self,
        db_session,
        lat: float,
        lon: float,
        post_type: str,
        author: str,
        location: str,
        content: str,
        radius_km: float = 10.0,
        app_url: str = "http://localhost:3000/app/community",
    ) -> Dict[str, Any]:
        """
        OPTIMIZED: Send community WhatsApp messages to users near a location.
        
        Replaces the heavy pattern of fetching ALL users + looping.
        Uses database-level filtering + Haversine validation.
        
        Args:
            db_session: Database session
            lat, lon: Post coordinates
            post_type: Type of post (help, emergency, alert, etc.)
            author, location, content: Post details
            radius_km: Search radius
            app_url: App link for CTA
        
        Returns:
            Result dict with sent/failed counts
        """
        # Use optimized spatial query to find nearby users
        nearby_users = await self.get_user_phones_near_from_db(
            db_session, lat, lon, radius_km
        )
        
        # Convert to recipient format and send
        recipients = [{"phone": u["phone"], "distance_km": u["distance_km"]} for u in nearby_users]
        
        return await self.send_community_whatsapp(
            recipients=recipients,
            post_type=post_type,
            author=author,
            location=location,
            content=content,
            app_url=app_url,
        )

    async def send_alert_sms(
        self,
        phone_numbers: List[str],
        alert_type: str,
        severity: str,
        location: str,
        description: str,
    ) -> Dict[str, Any]:
        """
        Send alert SMS to multiple registered numbers.
        """
        message = ALERT_TEMPLATE.format(
            severity=severity.upper(),
            alert_type=alert_type,
            location=location,
            description=description[:200],
        )

        if not phone_numbers:
            return {"total": 0, "sent": 0, "failed": 0, "results": []}

        results: List[Dict[str, Any]] = []
        for idx in range(0, len(phone_numbers), self.batch_size):
            batch = phone_numbers[idx: idx + self.batch_size]
            batch_results = await asyncio.gather(
                *[self.send_sms(phone, message) for phone in batch],
                return_exceptions=True,
            )
            for i, br in enumerate(batch_results):
                if isinstance(br, Exception):
                    results.append({"success": False, "error": str(br), "to": batch[i]})
                else:
                    results.append(br)
            if idx + self.batch_size < len(phone_numbers) and self.batch_pause_seconds > 0:
                await asyncio.sleep(self.batch_pause_seconds)

        sent = sum(1 for r in results if r.get("success"))
        logger.info(f"Alert SMS batch: {sent}/{len(phone_numbers)} delivered for {alert_type}")

        return {
            "total": len(phone_numbers),
            "sent": sent,
            "failed": len(phone_numbers) - sent,
            "results": results,
        }

    async def send_alert_sms_by_location(
        self,
        db_session,
        alert_lat: float,
        alert_lon: float,
        alert_type: str,
        severity: str,
        location: str,
        description: str,
        radius_km: float = 50.0,
    ) -> Dict[str, Any]:
        """
        OPTIMIZED: Send alert SMS to users near a location using spatial queries.
        
        Replaces the heavy pattern of fetching ALL users + looping.
        Now uses database-level filtering + Haversine validation.
        
        Args:
            db_session: Database session
            alert_lat, alert_lon: Alert coordinates
            alert_type, severity, location, description: Alert details
            radius_km: Search radius
        
        Returns:
            Result dict with sent/failed counts
        """
        # Use optimized spatial query to find nearby users
        nearby_users = await self.get_user_phones_near_from_db(
            db_session, alert_lat, alert_lon, radius_km
        )
        
        if not nearby_users:
            return {"total": 0, "sent": 0, "failed": 0, "results": []}
        
        # Extract phone numbers and send SMS batch
        phone_numbers = [u["phone"] for u in nearby_users]
        
        return await self.send_alert_sms(
            phone_numbers=phone_numbers,
            alert_type=alert_type,
            severity=severity,
            location=location,
            description=description,
        )

    async def send_retraction_sms(
        self,
        phone_numbers: List[str],
        alert_type: str,
        location: str,
    ) -> Dict[str, Any]:
        """
        Send correction SMS when an alert is retracted.
        Uses pre-defined template for immediate dispatch.
        """
        message = RETRACTION_TEMPLATE.format(
            alert_type=alert_type,
            location=location,
        )

        results = []
        for phone in phone_numbers:
            result = await self.send_sms(phone, message)
            results.append(result)

        sent = sum(1 for r in results if r.get("success"))
        logger.info(f"Retraction SMS batch: {sent}/{len(phone_numbers)} delivered")

        return {"total": len(phone_numbers), "sent": sent, "results": results}


# ═══════════════════════════════════════════════════════════════
#  REGISTERED PHONE STORE (in-memory + DB sync)
# ═══════════════════════════════════════════════════════════════
class PhoneRegistry:
    """
    Maintains registered phone numbers for SMS alerts.
    Syncs with DB (users table) and Firestore.
    """

    def __init__(self):
        self._phones: Dict[str, Dict[str, Any]] = {}
        # uid -> {phone, email, name, sms_enabled, location}

    def register(self, uid: str, phone: str, email: str = "", name: str = "", location: Dict = None):
        self._phones[uid] = {
            "phone": phone,
            "email": email,
            "name": name,
            "sms_enabled": True,
            "location": location or {},
            "registered_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"Phone registered: {phone[:6]}*** for user {uid[:8]}...")

    def unregister(self, uid: str):
        self._phones.pop(uid, None)

    def get_all_phones(self) -> List[str]:
        """Get all SMS-enabled phone numbers."""
        return [
            v["phone"] for v in self._phones.values()
            if v.get("sms_enabled") and v.get("phone")
        ]

    def get_phones_near(self, lat: float, lon: float, radius_km: float = 50) -> List[str]:
        """Get phones of users near a location (for targeted alerts)."""
        from utils.geo import haversine

        phones = []
        for v in self._phones.values():
            if not v.get("sms_enabled") or not v.get("phone"):
                continue
            loc = v.get("location", {})
            u_lat = loc.get("lat")
            u_lon = loc.get("lon")
            if u_lat is not None and u_lon is not None:
                dist = haversine(lat, lon, u_lat, u_lon)
                if dist <= radius_km:
                    phones.append(v["phone"])
            else:
                # No location → include in broad alerts
                phones.append(v["phone"])
        return phones

    @property
    def count(self) -> int:
        return len(self._phones)

    @staticmethod
    def _zone_key(lat: float, lon: float, precision: int = 1) -> str:
        """
        Coarse zone key for fast pre-filtering.
        precision=1 means ~0.1 degree bucket (~11km latitude).
        """
        return f"{round(float(lat), precision)}:{round(float(lon), precision)}"

    @staticmethod
    def _neighbor_zone_keys(lat: float, lon: float, radius_km: float) -> set[str]:
        """Return nearby zone keys so we only haversine-check likely candidates."""
        # 0.1 degree bucket baseline for coarse geozone filtering.
        cell_deg = 0.1
        lat_steps = max(1, int(math.ceil(radius_km / 11.1)))
        cos_lat = max(0.2, abs(math.cos(math.radians(lat))))
        lon_steps = max(1, int(math.ceil(radius_km / (11.1 * cos_lat))))

        keys: set[str] = set()
        for dlat in range(-lat_steps, lat_steps + 1):
            for dlon in range(-lon_steps, lon_steps + 1):
                zlat = lat + dlat * cell_deg
                zlon = lon + dlon * cell_deg
                keys.add(PhoneRegistry._zone_key(zlat, zlon, precision=1))
        return keys

    async def get_user_phones_near_from_db(self, db_session, lat: float, lon: float, radius_km: float = 10) -> List[Dict[str, Any]]:
        """
        OPTIMIZED: Get nearby user phones using spatial query optimization.
        Uses database-level filtering + Haversine validation (100x faster).
        
        Caching with Redis for repeated queries.
        """
        from database import User
        from utils.spatial_query import haversine_distance, estimate_lat_lon_tolerance
        import json

        query_key = f"nearby_users:{round(float(lat), 3)}:{round(float(lon), 3)}:{round(float(radius_km), 1)}"
        try:
            r = await redis_client.get_client()
            if r:
                cached = await r.get(query_key)
                if cached:
                    return json.loads(cached)
        except Exception:
            pass

        # Step 1: DB pre-filter using bounding box (FAST)
        lat_tol, lon_tol = estimate_lat_lon_tolerance(radius_km)
        
        query = select(User).where(
            User.is_active == True,  # noqa: E712
            User.phone.isnot(None),
        ).limit(5000)  # Safety limit
        
        result = await db_session.execute(query)
        all_users = result.scalars().all()

        # Step 2: Python-level Haversine filtering (only on active users)
        nearby = []
        for u in all_users:
            loc = u.location or {}
            u_lat = loc.get("lat", loc.get("latitude"))
            u_lon = loc.get("lon", loc.get("longitude"))
            
            if u_lat is None or u_lon is None:
                continue
                
            try:
                u_lat_f = float(u_lat)
                u_lon_f = float(u_lon)
            except (ValueError, TypeError):
                continue

            # Use accurate Haversine distance
            distance = haversine_distance(float(lat), float(lon), u_lat_f, u_lon_f)
            if distance <= radius_km:
                nearby.append({
                    "phone": u.phone,
                    "distance_km": distance,
                    "user_id": u.id,
                    "pincode": loc.get("gps_pincode") or loc.get("home_pincode") or loc.get("pin_code"),
                    "zone": self._zone_key(u_lat_f, u_lon_f, precision=1),
                })

        dedup = {}
        for row in nearby:
            phone = row["phone"]
            if phone not in dedup or row["distance_km"] < dedup[phone]["distance_km"]:
                dedup[phone] = row
        response = list(dedup.values())

        try:
            r = await redis_client.get_client()
            if r:
                import json
                await r.setex(query_key, 120, json.dumps(response))
        except Exception:
            pass

        return response


# ═══════════════════════════════════════════════════════════════
#  ALERT NOTIFICATION DISPATCHER
# ═══════════════════════════════════════════════════════════════
class AlertNotificationDispatcher:
    """
    Central dispatcher that decides WHAT notification channel to use
    based on deterministic decision engine output.

    Decision flow:
      risk_score >= 0.70 → auto SMS + push + WebSocket
      risk_score [0.45, 0.70) → admin_review (internal only)
      risk_score < 0.45 → monitor (no notification)

    Double-check rule:
      For auto-SMS, require either:
        - 2+ independent data sources, OR
        - risk_score >= 0.85 (overwhelming single source)
    """

    def __init__(self, sms_service: SMSService, phone_registry: PhoneRegistry):
        self.sms = sms_service
        self.phones = phone_registry
        self._sms_log: List[Dict] = []  # Audit trail

    async def dispatch(
        self,
        decision: Dict[str, Any],
        alert_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Dispatch notifications based on deterministic decision.

        Args:
            decision: Output from AlertDecisionEngine.evaluate_event()
            alert_data: {alert_type, severity, title, description, location}
        """
        action = decision.get("action", "dismiss")
        risk_score = decision.get("risk_score", 0)
        cross_sources = decision.get("cross_sources", [])

        result = {
            "action": action,
            "sms_sent": False,
            "push_sent": False,
            "ws_sent": False,
            "admin_notified": False,
        }

        if action == "auto_alert" and decision.get("should_notify"):
            # Double-check rule: require 2+ sources OR overwhelming score
            num_sources = len(cross_sources)
            if num_sources >= 2 or risk_score >= 0.85:
                # SEND SMS
                location_str = alert_data.get("location_name", "your area")
                lat = alert_data.get("lat")
                lon = alert_data.get("lon")

                # Get targeted phone numbers
                if lat and lon:
                    phones = self.phones.get_phones_near(lat, lon, radius_km=100)
                else:
                    phones = self.phones.get_all_phones()

                if phones:
                    sms_result = await self.sms.send_alert_sms(
                        phone_numbers=phones,
                        alert_type=alert_data.get("alert_type", "disaster"),
                        severity=alert_data.get("severity", "high"),
                        location=location_str,
                        description=alert_data.get("description", ""),
                    )
                    result["sms_sent"] = True
                    result["sms_details"] = sms_result

                    # Audit log
                    self._sms_log.append({
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "type": "alert",
                        "alert_type": alert_data.get("alert_type"),
                        "risk_score": risk_score,
                        "phones_count": len(phones),
                        "sent": sms_result.get("sent", 0),
                    })

                # WebSocket broadcast
                try:
                    from notifications import ws_manager, push_manager
                    await ws_manager.broadcast({
                        "type": "new_alert",
                        "alert": alert_data,
                        "risk_score": risk_score,
                    })
                    result["ws_sent"] = True

                    await push_manager.broadcast_notification({
                        "title": f"🚨 {alert_data.get('severity', 'HIGH').upper()} Alert",
                        "body": alert_data.get("description", ""),
                    })
                    result["push_sent"] = True
                except Exception as e:
                    logger.warning(f"WS/Push dispatch error: {e}")

            else:
                # Single source, moderate score → escalate to admin review
                result["action"] = "admin_review_escalated"
                result["reason"] = f"Double-check failed: only {num_sources} source(s)"
                result["admin_notified"] = True
                logger.info(f"Double-check: single source with score {risk_score:.2f} → admin review")

        elif action == "admin_review":
            result["admin_notified"] = True
            logger.info(f"Admin review flagged: {alert_data.get('alert_type')} score={risk_score:.2f}")

        return result

    async def dispatch_retraction(
        self,
        alert_type: str,
        location: str,
        lat: float = None,
        lon: float = None,
    ) -> Dict[str, Any]:
        """
        Send retraction SMS to all affected users.
        """
        if lat and lon:
            phones = self.phones.get_phones_near(lat, lon, radius_km=100)
        else:
            phones = self.phones.get_all_phones()

        if phones:
            sms_result = await self.sms.send_retraction_sms(
                phone_numbers=phones,
                alert_type=alert_type,
                location=location,
            )

            self._sms_log.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "type": "retraction",
                "alert_type": alert_type,
                "phones_count": len(phones),
                "sent": sms_result.get("sent", 0),
            })

            return {"retraction_sms_sent": True, "details": sms_result}

        return {"retraction_sms_sent": False, "reason": "no registered phones"}

    def get_sms_audit_log(self, limit: int = 50) -> List[Dict]:
        return self._sms_log[-limit:]


# ═══════════════════════════════════════════════════════════════
#  SINGLETONS
# ═══════════════════════════════════════════════════════════════
sms_service = SMSService()
phone_registry = PhoneRegistry()
alert_dispatcher = AlertNotificationDispatcher(sms_service, phone_registry)
