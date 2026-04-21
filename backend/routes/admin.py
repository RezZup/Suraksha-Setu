"""
Admin API Routes for Alert Management, Users & Stats
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from database import (
    get_db,
    Alert,
    IncidentLog,
    User,
    CommunityReport,
    CommunityPost,
    AILog,
    UserReport,
    Notification,
    WeatherDataset,
    AQIDataset,
    EarthquakeDataset,
    FloodDataset,
    HeatwaveDataset,
    NearbyDisasterDataset,
    MOSDACMetadata,
    SourceIngestionLog,
)
from notifications import ws_manager
from sqlalchemy import select, func
from sqlalchemy.orm.attributes import flag_modified
import logging
import uuid
import json
import asyncio
import os
import copy
from datetime import datetime, timezone, timedelta
from firebase_auth import verify_firebase_token
from ai.openai_client import ai_client, GOOGLE_MODEL_CHAT, OPENROUTER_CHAT_MODEL

logger = logging.getLogger(__name__)

_ADMIN_ROLES = {"admin", "developer"}


def _role_from_token(token: dict) -> str:
    claims = token.get("firebase_claims") or {}
    return (
        claims.get("role")
        or claims.get("user_type")
        or token.get("role")
        or ""
    ).strip().lower()


async def require_admin_user(
    token: dict = Depends(verify_firebase_token),
    db=Depends(get_db),
):
    """Allow admin/developer users via Firebase claims or local DB role."""
    token_role = _role_from_token(token)
    if token_role in _ADMIN_ROLES:
        return token

    uid = token.get("uid")
    if uid:
        db_user = await db.get(User, uid)
        db_role = (db_user.user_type or "").strip().lower() if db_user else ""
        if db_user and db_user.is_active and db_role in _ADMIN_ROLES:
            return token

    raise HTTPException(status_code=403, detail="Admin access required")


router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(require_admin_user)])

REVIEW_REQUIRED_POST_TYPES = {"alert", "warning", "emergency"}
COMMUNITY_APPROVAL_NOTIFY_CHANNELS = {"sms", "telegram"}
DEFAULT_COMMUNITY_APPROVAL_CHANNELS = ["sms", "telegram"]
DEFAULT_COMMUNITY_APPROVAL_RADIUS_KM = 10.0
MAX_COMMUNITY_APPROVAL_RADIUS_KM = 50.0
COMMUNITY_VERIFICATION_STATUS_META = {
    "pending_admin_review": {"label": "Pending Admin Review", "progress": 25},
    "in_review": {"label": "Under Review", "progress": 55},
    "needs_info": {"label": "Need More Information", "progress": 40},
    "approved": {"label": "Verified by Admin", "progress": 100},
    "rejected": {"label": "Rejected", "progress": 100},
    "not_required": {"label": "No Verification Needed", "progress": 100},
}


def _normalize_channel_list(channels: Optional[List[str]]) -> List[str]:
    if not channels:
        return []
    normalized: List[str] = []
    seen = set()
    for channel in channels:
        key = str(channel or "").strip().lower()
        if key in COMMUNITY_APPROVAL_NOTIFY_CHANNELS and key not in seen:
            seen.add(key)
            normalized.append(key)
    return normalized


def _extract_lat_lon(location_meta: Dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    if not isinstance(location_meta, dict):
        return None, None
    lat_raw = location_meta.get("lat", location_meta.get("latitude"))
    lon_raw = location_meta.get("lon", location_meta.get("longitude"))
    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except (TypeError, ValueError):
        return None, None
    return lat, lon


def _normalize_pincode(value: Any) -> Optional[str]:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) < 6:
        return None
    return digits[:6]


def _extract_pincode(location_meta: Dict[str, Any]) -> Optional[str]:
    if not isinstance(location_meta, dict):
        return None

    pincode_candidates = (
        location_meta.get("pincode"),
        location_meta.get("pin_code"),
        location_meta.get("gps_pincode"),
        location_meta.get("home_pincode"),
    )
    for candidate in pincode_candidates:
        normalized = _normalize_pincode(candidate)
        if normalized:
            return normalized
    return None


def _user_channel_enabled(user: User, *channel_keys: str) -> bool:
    channels = user.notification_channels if isinstance(user.notification_channels, dict) else {}
    for key in channel_keys:
        if key in channels:
            return channels.get(key) is not False
    return True


async def _collect_nearby_users_for_dispatch(
    db,
    lat: Optional[float],
    lon: Optional[float],
    radius_km: float,
    pincode: Optional[str],
) -> List[Dict[str, Any]]:
    from utils.spatial_query import haversine_distance

    normalized_pincode = _normalize_pincode(pincode)
    has_coordinates = lat is not None and lon is not None
    if not has_coordinates and not normalized_pincode:
        return []

    query = (
        select(User)
        .where(User.is_active == True, User.location.isnot(None))
        .limit(10000)
    )
    result = await db.execute(query)
    users = result.scalars().all()

    nearby: List[Dict[str, Any]] = []
    for user in users:
        user_loc = user.location if isinstance(user.location, dict) else {}
        user_lat, user_lon = _extract_lat_lon(user_loc)
        user_pin = _extract_pincode(user_loc)

        distance_km: Optional[float] = None
        matched_by: Optional[str] = None

        if has_coordinates and user_lat is not None and user_lon is not None:
            try:
                distance_val = haversine_distance(float(lat), float(lon), float(user_lat), float(user_lon))
                try:
                    user_pref_radius = float(user.notification_radius_km) if user.notification_radius_km is not None else radius_km
                except (TypeError, ValueError):
                    user_pref_radius = radius_km
                effective_radius = max(1.0, min(radius_km, max(1.0, user_pref_radius)))
                if distance_val <= effective_radius:
                    distance_km = round(distance_val, 2)
                    matched_by = "radius"
            except Exception:
                matched_by = None

        if matched_by is None and normalized_pincode and user_pin == normalized_pincode:
            matched_by = "pincode"

        if matched_by:
            nearby.append(
                {
                    "user": user,
                    "distance_km": distance_km,
                    "matched_by": matched_by,
                }
            )

    # Deduplicate by user id, prefer distance-based match over pincode fallback.
    dedup: Dict[str, Dict[str, Any]] = {}
    for row in nearby:
        user_id = str(row["user"].id)
        existing = dedup.get(user_id)
        if existing is None:
            dedup[user_id] = row
            continue

        existing_distance = existing.get("distance_km")
        current_distance = row.get("distance_km")
        if existing_distance is None and current_distance is not None:
            dedup[user_id] = row
        elif existing_distance is not None and current_distance is not None and current_distance < existing_distance:
            dedup[user_id] = row

    return list(dedup.values())


def _community_dispatch_text(post: CommunityPost, location_label: str) -> str:
    post_type = str(post.post_type or "alert").strip().upper()
    short_content = (post.content or "")[:180]
    app_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    return (
        f"Suraksha Setu Verified {post_type} near {location_label}. "
        f"{short_content} Open app: {app_url}/app/community"
    )


async def _dispatch_approved_community_post(
    post: CommunityPost,
    location_meta: Dict[str, Any],
    channels: List[str],
    radius_km: float,
    db,
) -> Dict[str, Any]:
    """Send nearby community approval notifications and return channel delivery stats."""
    lat, lon = _extract_lat_lon(location_meta)
    pincode = _extract_pincode(location_meta)
    location_label = (
        location_meta.get("name")
        or location_meta.get("city")
        or location_meta.get("pincode")
        or "your area"
    )
    summary: Dict[str, Any] = {
        "radius_km": radius_km,
        "channels_requested": channels,
        "has_coordinates": lat is not None and lon is not None,
        "pincode": pincode,
        "recipient_candidates": 0,
        "sms": {"requested": "sms" in channels, "total": 0, "sent": 0, "failed": 0},
        "telegram": {"requested": "telegram" in channels, "total": 0, "sent": 0, "failed": 0},
        "in_app": {"requested": True, "total": 0, "queued": 0, "ws_delivered": 0},
        "alert_center": {"created": False, "alert_id": None},
        "ws_broadcast": False,
        "push_sent": 0,
        "errors": [],
    }

    # Even when coordinates are missing, continue the flow so Alert Center gets updated.
    nearby_rows: List[Dict[str, Any]] = []
    if (lat is None or lon is None) and not pincode:
        summary["errors"].append("Post has neither coordinates nor pincode for nearby notifications")
    else:
        nearby_rows = await _collect_nearby_users_for_dispatch(
            db=db,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
            pincode=pincode,
        )

    # Fallback: ensure post author still receives approval channel messages.
    if not nearby_rows and post.user_id and str(post.user_id).strip().lower() not in {"", "anonymous", "you"}:
        author_user = await db.get(User, post.user_id)
        if author_user and author_user.is_active:
            nearby_rows.append(
                {
                    "user": author_user,
                    "distance_km": None,
                    "matched_by": "author",
                }
            )

    summary["recipient_candidates"] = len(nearby_rows)

    message_text = _community_dispatch_text(post, location_label)
    notify_channels = _normalize_channel_list(channels)

    if "sms" in notify_channels:
        try:
            from sms_service import sms_service

            sms_recipients: List[Dict[str, Any]] = []
            seen_phones = set()
            for row in nearby_rows:
                user = row["user"]
                if not user.phone or not _user_channel_enabled(user, "sms"):
                    continue
                phone_value = str(user.phone).strip()
                if not phone_value or phone_value in seen_phones:
                    continue
                seen_phones.add(phone_value)
                sms_recipients.append({"phone": phone_value, "user_id": user.id})

            summary["sms"]["total"] = len(sms_recipients)
            if sms_recipients:
                sms_jobs = [sms_service.send_sms(row["phone"], message_text) for row in sms_recipients]
                sms_results = await asyncio.gather(*sms_jobs, return_exceptions=True)
                sent_count = 0
                for idx, sms_res in enumerate(sms_results):
                    if isinstance(sms_res, Exception):
                        summary["errors"].append(f"SMS error for {sms_recipients[idx].get('phone')}: {sms_res}")
                        continue
                    if sms_res.get("success"):
                        sent_count += 1
                summary["sms"]["sent"] = sent_count
                summary["sms"]["failed"] = len(sms_recipients) - sent_count
        except Exception as exc:
            logger.warning("Community approval SMS dispatch failed for post=%s: %s", post.id, exc)
            summary["errors"].append(f"SMS dispatch failed: {exc}")

    if "telegram" in notify_channels:
        try:
            from telegram_service import telegram_service

            if telegram_service.enabled:
                tg_recipients: List[str] = []
                for row in nearby_rows:
                    user = row["user"]
                    if not user.telegram_chat_id:
                        continue
                    if not _user_channel_enabled(user, "telegram"):
                        continue
                    tg_recipients.append(str(user.telegram_chat_id))

                summary["telegram"]["total"] = len(tg_recipients)
                if tg_recipients:
                    tg_jobs = [telegram_service.send_message(chat_id, message_text) for chat_id in tg_recipients]
                    tg_results = await asyncio.gather(*tg_jobs, return_exceptions=True)
                    sent_count = 0
                    for idx, tg_res in enumerate(tg_results):
                        if isinstance(tg_res, Exception):
                            summary["errors"].append(f"Telegram error for chat {tg_recipients[idx]}: {tg_res}")
                            continue
                        if tg_res is True:
                            sent_count += 1
                    summary["telegram"]["sent"] = sent_count
                    summary["telegram"]["failed"] = len(tg_recipients) - sent_count
            else:
                summary["errors"].append("Telegram service is not configured")
        except Exception as exc:
            logger.warning("Community approval Telegram dispatch failed for post=%s: %s", post.id, exc)
            summary["errors"].append(f"Telegram dispatch failed: {exc}")

    now_iso = datetime.now(timezone.utc).isoformat()
    community_type = str(post.post_type or "alert").strip().lower() or "alert"
    alert_severity = {
        "emergency": "critical",
        "warning": "high",
        "alert": "moderate",
    }.get(community_type, "moderate")
    alert_location = copy.deepcopy(location_meta) if isinstance(location_meta, dict) else {}
    if lat is not None:
        alert_location["lat"] = lat
    if lon is not None:
        alert_location["lon"] = lon
    if pincode and not alert_location.get("pincode"):
        alert_location["pincode"] = pincode

    try:
        existing_alert = None
        existing_alerts_result = await db.execute(
            select(Alert)
            .where(Alert.source == "community_verified", Alert.retracted == False)
            .order_by(Alert.created_at.desc())
            .limit(300)
        )
        for candidate in existing_alerts_result.scalars().all():
            metadata = candidate.alert_metadata if isinstance(candidate.alert_metadata, dict) else {}
            if metadata.get("community_post_id") == post.id:
                existing_alert = candidate
                break

        alert_title = f"Verified community {community_type.capitalize()} near {location_label}"
        alert_description = (post.content or "").strip()[:500] or "Verified community report published by admin."
        alert_metadata = {
            "community_post_id": post.id,
            "verification_status": "approved",
            "notify_radius_km": radius_km,
            "updated_at": now_iso,
        }

        if existing_alert:
            existing_alert.alert_type = community_type
            existing_alert.severity = alert_severity
            existing_alert.title = alert_title
            existing_alert.description = alert_description
            existing_alert.location = alert_location
            existing_alert.alert_metadata = alert_metadata
            existing_alert.is_active = True
            existing_alert.retracted = False
            existing_alert.source = "community_verified"
            flag_modified(existing_alert, "location")
            flag_modified(existing_alert, "alert_metadata")
            alert_row = existing_alert
        else:
            alert_row = Alert(
                id=str(uuid.uuid4()),
                alert_type=community_type,
                severity=alert_severity,
                title=alert_title,
                description=alert_description,
                location=alert_location,
                alert_metadata=alert_metadata,
                source="community_verified",
                is_active=True,
                retracted=False,
            )
            db.add(alert_row)

        summary["alert_center"] = {
            "created": existing_alert is None,
            "alert_id": alert_row.id,
        }
    except Exception as exc:
        logger.warning("Community approval alert-center publish failed for post=%s: %s", post.id, exc)
        summary["errors"].append(f"Alert-center publish failed: {exc}")
        alert_row = None

    try:
        from notifications import push_manager

        ws_payload = {
            "type": "new_alert",
            "id": alert_row.id if alert_row else post.id,
            "alert_type": community_type,
            "title": f"Verified community {community_type.capitalize()} nearby",
            "description": (post.content or "")[:240],
            "message": (post.content or "")[:240],
            "severity": alert_severity,
            "location": location_label,
            "location_data": alert_location,
            "coordinates": {"lat": lat, "lon": lon},
            "url": "/app/community",
            "source": "community_verified",
            "timestamp": now_iso,
        }

        if lat is not None and lon is not None:
            await ws_manager.broadcast_location_based(ws_payload, radius_km=radius_km)
            summary["ws_broadcast"] = True
            summary["push_sent"] = await push_manager.send_nearby_push(
                lat,
                lon,
                {
                    "title": ws_payload["title"],
                    "body": ws_payload["description"],
                    "url": "/app/community",
                    "type": "community_post_verified",
                },
                radius_km=radius_km,
                db=db,
            )
        else:
            summary["errors"].append("Skipped WS/push nearby delivery because post coordinates are missing")
    except Exception as exc:
        logger.warning("Community approval WS/Push dispatch failed for post=%s: %s", post.id, exc)
        summary["errors"].append(f"WS/Push dispatch failed: {exc}")

    try:
        in_app_recipients = []
        for row in nearby_rows:
            user = row["user"]
            if not user.id or str(user.id) == str(post.user_id):
                continue
            if not _user_channel_enabled(user, "in_app", "app"):
                continue
            in_app_recipients.append(user)

        # Deduplicate recipients by user id.
        dedup_recipients = {str(user.id): user for user in in_app_recipients}
        recipient_users = list(dedup_recipients.values())

        summary["in_app"]["total"] = len(recipient_users)
        if recipient_users:
            ws_jobs = []
            for user in recipient_users:
                notification_id = str(uuid.uuid4())
                notification_payload = {
                    "id": notification_id,
                    "user_id": user.id,
                    "type": "alert",
                    "title": f"Verified community {community_type.capitalize()} nearby",
                    "message": message_text,
                    "post_id": post.id,
                    "from_user_id": "admin",
                    "from_name": "Admin Team",
                    "from_photo": None,
                    "is_read": False,
                    "timestamp": now_iso,
                }

                db.add(
                    Notification(
                        id=notification_id,
                        user_id=user.id,
                        type="alert",
                        title=notification_payload["title"],
                        message=notification_payload["message"],
                        post_id=post.id,
                        from_user_id="admin",
                        from_name="Admin Team",
                        from_photo=None,
                        is_read=False,
                    )
                )
                ws_jobs.append(
                    ws_manager.notify_user(
                        user.id,
                        {
                            "type": "in_app_notification",
                            "notification": notification_payload,
                        },
                    )
                )

            summary["in_app"]["queued"] = len(recipient_users)
            ws_results = await asyncio.gather(*ws_jobs, return_exceptions=True)
            delivered_connections = 0
            for idx, ws_res in enumerate(ws_results):
                if isinstance(ws_res, Exception):
                    summary["errors"].append(
                        f"In-app websocket fanout failed for user {recipient_users[idx].id}: {ws_res}"
                    )
                    continue
                delivered_connections += int(ws_res or 0)
            summary["in_app"]["ws_delivered"] = delivered_connections
    except Exception as exc:
        logger.warning("Community approval in-app dispatch failed for post=%s: %s", post.id, exc)
        summary["errors"].append(f"In-app dispatch failed: {exc}")

    return summary


def _default_community_verification(post_type: str) -> dict:
    normalized_type = (post_type or "general").strip().lower()
    if normalized_type in REVIEW_REQUIRED_POST_TYPES:
        meta = COMMUNITY_VERIFICATION_STATUS_META["pending_admin_review"]
        return {
            "requires_admin_review": True,
            "status": "pending_admin_review",
            "status_label": meta["label"],
            "progress_percent": meta["progress"],
            "message": "Submitted and waiting for admin verification.",
            "admin_comment": None,
            "report_to_user": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "history": [],
        }

    meta = COMMUNITY_VERIFICATION_STATUS_META["not_required"]
    return {
        "requires_admin_review": False,
        "status": "not_required",
        "status_label": meta["label"],
        "progress_percent": meta["progress"],
        "message": "No verification required for this post type.",
        "admin_comment": None,
        "report_to_user": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "history": [],
    }


def _normalize_community_verification(location_meta: dict, post_type: str) -> dict:
    defaults = _default_community_verification(post_type)
    raw = location_meta.get("verification") if isinstance(location_meta, dict) else None
    if not isinstance(raw, dict):
        return defaults

    merged = {**defaults, **raw}
    if not isinstance(merged.get("history"), list):
        merged["history"] = []
    status = str(merged.get("status") or defaults["status"]).strip().lower()
    if status not in COMMUNITY_VERIFICATION_STATUS_META:
        status = defaults["status"]
    status_meta = COMMUNITY_VERIFICATION_STATUS_META[status]

    merged["status"] = status
    merged["status_label"] = merged.get("status_label") or status_meta["label"]
    try:
        merged["progress_percent"] = int(merged.get("progress_percent", status_meta["progress"]))
    except Exception:
        merged["progress_percent"] = status_meta["progress"]

    merged["progress_percent"] = max(0, min(100, merged["progress_percent"]))
    merged["requires_admin_review"] = bool(merged.get("requires_admin_review", defaults["requires_admin_review"]))
    return merged


def _extract_post_image_analysis(post: CommunityPost, location_meta: dict) -> Optional[dict]:
    from_location = location_meta.get("image_analysis") if isinstance(location_meta, dict) else None
    if isinstance(from_location, dict):
        return from_location

    media_items = post.media if isinstance(post.media, list) else []
    analyses: list[dict] = []
    for media_item in media_items:
        if not isinstance(media_item, dict):
            continue
        analysis = media_item.get("analysis")
        if isinstance(analysis, dict):
            nested = analysis.get("analysis")
            if isinstance(nested, dict):
                analyses.append(nested)
            else:
                analyses.append(analysis)

    if not analyses:
        return None
    analyses.sort(key=lambda item: float(item.get("confidence", 0.0) or 0.0), reverse=True)
    return analyses[0]


# ==================== REQUEST MODELS ====================

class RetractionRequest(BaseModel):
    alert_id: str
    reason: str
    admin_user_id: Optional[str] = None


class AlertApprovalRequest(BaseModel):
    alert_id: str
    approved: bool
    admin_user_id: Optional[str] = None


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None


class UserCreateRequest(BaseModel):
    name: str
    email: str
    role: str = "citizen"
    status: str = "active"


class AlertCreateRequest(BaseModel):
    alert_type: str
    severity: str
    title: str
    description: str
    source: str = "admin"
    location: dict
    is_active: bool = True
    pincode: Optional[str] = None        # target pincode area (e.g. "400001")
    radius_km: Optional[float] = None   # WS radius override (default 100 km)


class AlertUpdateRequest(BaseModel):
    alert_type: Optional[str] = None
    severity: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    location: Optional[dict] = None
    is_active: Optional[bool] = None
    retracted: Optional[bool] = None


class CommunityPostVerificationRequest(BaseModel):
    status: str  # pending_admin_review | in_review | needs_info | approved | rejected
    progress_message: Optional[str] = None
    admin_comment: Optional[str] = None
    report_to_user: Optional[str] = None
    notify_channels: Optional[List[str]] = None  # sms, telegram
    notify_radius_km: Optional[float] = None


class BroadcastGenerateRequest(BaseModel):
    prompt: str
    severity: str = "warning"
    audience: str = "citizens in affected area"
    language: str = "English"


class AdminIngestionRunRequest(BaseModel):
    source_mode: str = "all"  # all | alerts_cycle | mosdac | mosdac_backfill | weather_aqi | disasters
    mosdac_days_back: int = 7
    mosdac_limit_per_tile: int = 80
    locations: Optional[List[Dict[str, Any]]] = None


def _parse_training_locations_from_env() -> List[tuple[str, float, float]]:
    """Parse DATASET_TRAINING_LOCATIONS (City:lat:lon,...) with sane defaults."""
    defaults: List[tuple[str, float, float]] = [
        ("New Delhi", 28.6139, 77.2090),
        ("Mumbai", 19.0760, 72.8777),
        ("Kolkata", 22.5726, 88.3639),
        ("Chennai", 13.0827, 80.2707),
        ("Bengaluru", 12.9716, 77.5946),
    ]
    raw = os.getenv("DATASET_TRAINING_LOCATIONS", "").strip()
    if not raw:
        return defaults

    parsed: List[tuple[str, float, float]] = []
    for item in raw.split(","):
        parts = [p.strip() for p in item.split(":")]
        if len(parts) != 3:
            continue
        city, lat_s, lon_s = parts
        try:
            parsed.append((city or "Unknown", float(lat_s), float(lon_s)))
        except ValueError:
            continue
    return parsed or defaults


def _normalize_manual_locations(locations: Optional[List[Dict[str, Any]]]) -> List[tuple[str, float, float]]:
    if not locations:
        return []

    normalized: List[tuple[str, float, float]] = []
    for idx, row in enumerate(locations):
        if not isinstance(row, dict):
            continue
        city = str(row.get("city") or row.get("name") or f"location_{idx + 1}").strip()
        try:
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
        except (TypeError, ValueError):
            continue
        normalized.append((city, lat, lon))
    return normalized


async def _run_weather_aqi_ingestion(locations: List[tuple[str, float, float]]) -> Dict[str, Any]:
    """Fetch weather+AQI for each location and persist via existing route helpers."""
    from routes.weather import _fetch_weather, _fetch_aqi

    summary: Dict[str, Any] = {
        "locations": len(locations),
        "weather_ok": 0,
        "aqi_ok": 0,
        "errors": [],
    }

    for city, lat, lon in locations:
        weather_res, aqi_res = await asyncio.gather(
            _fetch_weather(lat, lon, city=city),
            _fetch_aqi(lat, lon, city=city),
            return_exceptions=True,
        )

        if isinstance(weather_res, Exception):
            summary["errors"].append(f"weather:{city}:{weather_res}")
        else:
            summary["weather_ok"] += 1

        if isinstance(aqi_res, Exception):
            summary["errors"].append(f"aqi:{city}:{aqi_res}")
        else:
            summary["aqi_ok"] += 1

    summary["errors"] = summary["errors"][:20]
    return summary


async def _run_disaster_source_ingestion() -> Dict[str, Any]:
    """Fetch USGS + GDACS and persist earthquake/flood/heatwave rows."""
    from routes.disasters import (
        _fetch_usgs_earthquakes,
        _fetch_gdacs_disasters,
        _persist_disaster_training_rows,
    )

    summary: Dict[str, Any] = {
        "usgs_rows": 0,
        "gdacs_rows": 0,
        "persisted_rows": 0,
        "errors": [],
    }

    usgs_res, gdacs_res = await asyncio.gather(
        _fetch_usgs_earthquakes(),
        _fetch_gdacs_disasters(),
        return_exceptions=True,
    )

    merged: List[Dict[str, Any]] = []
    if isinstance(usgs_res, Exception):
        summary["errors"].append(f"usgs:{usgs_res}")
    elif isinstance(usgs_res, list):
        summary["usgs_rows"] = len(usgs_res)
        merged.extend(usgs_res)

    if isinstance(gdacs_res, Exception):
        summary["errors"].append(f"gdacs:{gdacs_res}")
    elif isinstance(gdacs_res, list):
        summary["gdacs_rows"] = len(gdacs_res)
        merged.extend(gdacs_res)

    if merged:
        await _persist_disaster_training_rows(merged)
        summary["persisted_rows"] = len(merged)

    summary["errors"] = summary["errors"][:20]
    return summary


async def _run_mosdac_metadata_ingestion() -> Dict[str, Any]:
    """Poll MOSDAC metadata now and persist new records."""
    from ingest.mosdac_poller import mosdac_poller

    metadata_results = await mosdac_poller.poll_all_datasets()
    datasets: Dict[str, Dict[str, int]] = {}
    total_polled = 0
    total_stored = 0

    for dataset_id, records in metadata_results.items():
        stored = await mosdac_poller.store_metadata(records)
        datasets[dataset_id] = {
            "polled": len(records),
            "stored": stored,
        }
        total_polled += len(records)
        total_stored += stored

    return {
        "mode": "mosdac_poll",
        "datasets": datasets,
        "total_polled": total_polled,
        "total_stored": total_stored,
        "scan_config": mosdac_poller.scan_config(),
    }


async def _build_data_summary(db, recent_hours: int = 24) -> Dict[str, Any]:
    """Summarize how much data exists in DB across all training/source tables."""
    recent_window = max(1, min(recent_hours, 24 * 30))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=recent_window)

    dataset_specs = [
        {
            "id": "weather",
            "label": "Weather Dataset",
            "model": WeatherDataset,
            "time_col": WeatherDataset.ingested_at,
            "source_col": WeatherDataset.source,
        },
        {
            "id": "aqi",
            "label": "AQI Dataset",
            "model": AQIDataset,
            "time_col": AQIDataset.ingested_at,
            "source_col": AQIDataset.source,
        },
        {
            "id": "earthquake",
            "label": "Earthquake Dataset",
            "model": EarthquakeDataset,
            "time_col": EarthquakeDataset.ingested_at,
            "source_col": EarthquakeDataset.source,
        },
        {
            "id": "flood",
            "label": "Flood Dataset",
            "model": FloodDataset,
            "time_col": FloodDataset.ingested_at,
            "source_col": FloodDataset.source,
        },
        {
            "id": "heatwave",
            "label": "Heatwave Dataset",
            "model": HeatwaveDataset,
            "time_col": HeatwaveDataset.ingested_at,
            "source_col": HeatwaveDataset.source,
        },
        {
            "id": "nearby",
            "label": "Nearby Dataset",
            "model": NearbyDisasterDataset,
            "time_col": NearbyDisasterDataset.captured_at,
            "source_col": NearbyDisasterDataset.source,
        },
        {
            "id": "mosdac",
            "label": "MOSDAC Metadata",
            "model": MOSDACMetadata,
            "time_col": MOSDACMetadata.created_at,
            "source_col": MOSDACMetadata.dataset_id,
        },
        {
            "id": "ingestion_logs",
            "label": "Source Ingestion Logs",
            "model": SourceIngestionLog,
            "time_col": SourceIngestionLog.ingested_at,
            "source_col": SourceIngestionLog.source,
        },
    ]

    datasets: List[Dict[str, Any]] = []
    total_rows = 0
    total_rows_recent = 0

    for spec in dataset_specs:
        model = spec["model"]
        time_col = spec["time_col"]
        source_col = spec["source_col"]

        total = int((await db.execute(select(func.count(model.id)))).scalar() or 0)
        recent = int((await db.execute(select(func.count(model.id)).where(time_col >= cutoff))).scalar() or 0)
        last_seen_dt = (await db.execute(select(func.max(time_col)))).scalar()

        source_rows = (await db.execute(
            select(source_col, func.count(model.id))
            .group_by(source_col)
            .order_by(func.count(model.id).desc())
            .limit(12)
        )).all()

        sources = [
            {
                "source": str(row[0] or "unknown"),
                "rows": int(row[1] or 0),
            }
            for row in source_rows
        ]

        datasets.append({
            "id": spec["id"],
            "label": spec["label"],
            "rows_total": total,
            "rows_recent": recent,
            "last_seen": last_seen_dt.isoformat() if last_seen_dt else None,
            "sources": sources,
        })
        total_rows += total
        total_rows_recent += recent

    ingestion_status_rows = (await db.execute(
        select(SourceIngestionLog.status, func.count(SourceIngestionLog.id))
        .group_by(SourceIngestionLog.status)
    )).all()
    ingestion_status = {str(status or "unknown"): int(cnt or 0) for status, cnt in ingestion_status_rows}

    avg_quality = (await db.execute(select(func.avg(SourceIngestionLog.quality_score)))).scalar()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "recent_window_hours": recent_window,
        "totals": {
            "rows_total": total_rows,
            "rows_recent": total_rows_recent,
            "dataset_groups": len(datasets),
        },
        "ingestion_logs": {
            "status_breakdown": ingestion_status,
            "average_quality_score": round(float(avg_quality or 0.0), 3),
        },
        "datasets": datasets,
    }


# ==================== ADMIN STATS ENDPOINT ====================

@router.get("/stats")
async def get_admin_stats(db=Depends(get_db)):
    """Real-time dashboard stats."""
    try:
        # Active alerts
        active_q = await db.execute(
            select(func.count(Alert.id)).where(Alert.is_active == True, Alert.retracted == False)
        )
        active_alerts = active_q.scalar() or 0

        # Pending alerts (not active, not retracted = pending review)
        pending_q = await db.execute(
            select(func.count(Alert.id)).where(Alert.is_active == False, Alert.retracted == False)
        )
        pending_alerts = pending_q.scalar() or 0

        # Total alerts
        total_q = await db.execute(select(func.count(Alert.id)))
        total_alerts = total_q.scalar() or 0

        # Users
        total_users_q = await db.execute(select(func.count(User.id)))
        total_users = total_users_q.scalar() or 0

        active_users_q = await db.execute(
            select(func.count(User.id)).where(User.is_active == True)
        )
        active_users = active_users_q.scalar() or 0

        # Community posts
        posts_q = await db.execute(select(func.count(CommunityPost.id)))
        total_posts = posts_q.scalar() or 0

        # Community reports (pending)
        try:
            reports_q = await db.execute(
                select(func.count(CommunityReport.id)).where(CommunityReport.verified == False)
            )
            pending_reports = reports_q.scalar() or 0
        except Exception:
            pending_reports = 0

        pending_post_verifications = 0
        try:
            verification_posts_q = await db.execute(
                select(CommunityPost).where(CommunityPost.post_type.in_(list(REVIEW_REQUIRED_POST_TYPES))).limit(500)
            )
            for post in verification_posts_q.scalars().all():
                location_meta = post.location if isinstance(post.location, dict) else {}
                verification = _normalize_community_verification(location_meta, post.post_type)
                if verification.get("status") in {"pending_admin_review", "in_review", "needs_info"}:
                    pending_post_verifications += 1
        except Exception:
            pending_post_verifications = 0

        # Registered phones
        try:
            from sms_service import phone_registry
            registered_phones = phone_registry.count
        except Exception:
            registered_phones = 0

        # Incident count
        try:
            inc_q = await db.execute(select(func.count(IncidentLog.id)))
            incidents = inc_q.scalar() or 0
        except Exception:
            incidents = 0

        # AI calls today
        try:
            today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            ai_q = await db.execute(
                select(func.count(AILog.id)).where(AILog.created_at >= today)
            )
            ai_calls_today = ai_q.scalar() or 0
        except Exception:
            ai_calls_today = 0

        return {
            "active_alerts": active_alerts,
            "pending_alerts": pending_alerts,
            "total_alerts": total_alerts,
            "total_users": total_users,
            "active_users": active_users,
            "total_posts": total_posts,
            "pending_reports": pending_reports,
            "pending_post_verifications": pending_post_verifications,
            "registered_phones": registered_phones,
            "incidents": incidents,
            "ai_calls_today": ai_calls_today,
            "system_status": "operational",
        }

    except Exception as e:
        logger.error(f"Stats error: {e}")
        return {
            "active_alerts": 0,
            "pending_alerts": 0,
            "total_alerts": 0,
            "total_users": 0,
            "active_users": 0,
            "total_posts": 0,
            "pending_reports": 0,
            "pending_post_verifications": 0,
            "registered_phones": 0,
            "incidents": 0,
            "ai_calls_today": 0,
            "system_status": "degraded",
        }

@router.get("/data/summary")
async def get_admin_data_summary(recent_hours: int = 24, db=Depends(get_db)):
    """Detailed row counts by dataset/source so admin can audit stored data volume."""
    return await _build_data_summary(db=db, recent_hours=recent_hours)


@router.post("/data/ingest/run")
async def run_admin_data_ingestion(body: AdminIngestionRunRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """
    Admin-triggered source ingestion:
    - MOSDAC metadata (poll/backfill)
    - Weather + AQI collection
    - Disaster source fetch + persistence
    - Full alert ingestion cycle
    """
    from ingest.manager import IngestionManager

    mode = (body.source_mode or "all").strip().lower()
    valid_modes = {"all", "alerts_cycle", "mosdac", "mosdac_backfill", "weather_aqi", "disasters"}
    if mode not in valid_modes:
        raise HTTPException(status_code=422, detail=f"source_mode must be one of: {sorted(valid_modes)}")

    manual_locations = _normalize_manual_locations(body.locations)
    locations = manual_locations or _parse_training_locations_from_env()

    result: Dict[str, Any] = {
        "success": True,
        "mode": mode,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "steps": {},
        "errors": [],
    }

    async def _step(step_id: str, coro):
        try:
            payload = await coro
            result["steps"][step_id] = {"success": True, "result": payload}
        except Exception as exc:
            result["success"] = False
            result["errors"].append(f"{step_id}: {exc}")
            result["steps"][step_id] = {"success": False, "error": str(exc)}

    if mode in {"all", "alerts_cycle"}:
        await _step("alerts_cycle", IngestionManager.run_ingest_cycle(db))

    if mode in {"all", "weather_aqi"}:
        await _step("weather_aqi", _run_weather_aqi_ingestion(locations))

    if mode in {"all", "disasters"}:
        await _step("disasters", _run_disaster_source_ingestion())

    if mode in {"all", "mosdac"}:
        await _step("mosdac", _run_mosdac_metadata_ingestion())

    if mode == "mosdac_backfill":
        from ingest.mosdac_poller import mosdac_poller

        days_back = max(1, min(int(body.mosdac_days_back or 7), 30))
        per_tile = max(5, min(int(body.mosdac_limit_per_tile or 80), 300))
        await _step(
            "mosdac_backfill",
            mosdac_poller.backfill_metadata(days_back=days_back, limit_per_tile=per_tile),
        )

    result["errors"] = result["errors"][:20]
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    result["data_summary"] = await _build_data_summary(db=db, recent_hours=24)
    return result

@router.get("/users")
async def list_users(db=Depends(get_db)):
    """List all users with stats."""
    try:
        result = await db.execute(
            select(User).order_by(User.created_at.desc()).limit(200)
        )
        users = result.scalars().all()

        return {
            "users": [
                {
                    "id": u.id,
                    "name": u.full_name or u.username,
                    "email": u.email,
                    "role": u.user_type or "citizen",
                    "status": "active" if u.is_active else "inactive",
                    "joinedDate": u.created_at.strftime("%Y-%m-%d") if u.created_at else "",
                    "lastActive": _relative_time(u.updated_at),
                    "location": (u.location or {}).get("city", "Not specified") if isinstance(u.location, dict) else "Not specified",
                }
                for u in users
            ]
        }
    except Exception as e:
        logger.error(f"User list error: {e}")
        return {"users": []}


@router.put("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdateRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Update a user's profile."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.name is not None:
        user.full_name = body.name
    if body.email is not None:
        user.email = body.email
    if body.role is not None:
        user.user_type = body.role
    if body.status is not None:
        user.is_active = body.status == "active"
    await db.commit()
    return {"success": True}


@router.post("/users")
async def create_user(body: UserCreateRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Create a user from admin dashboard."""
    email = body.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already exists")

    user_id = str(uuid.uuid4())
    username_base = email.split("@")[0] if "@" in email else body.name.strip().lower().replace(" ", "")
    username = username_base[:30] or f"user_{user_id[:6]}"
    dupe_username = await db.execute(select(User).where(User.username == username))
    if dupe_username.scalar_one_or_none():
        username = f"{username}_{user_id[:6]}"

    role = body.role if body.role in ("citizen", "student", "scientist", "admin", "developer") else "citizen"
    user = User(
        id=user_id,
        email=email,
        username=username,
        password_hash="admin_created",
        full_name=body.name.strip() or username,
        user_type=role,
        is_active=(body.status == "active"),
    )
    db.add(user)
    await db.commit()
    return {"success": True, "user_id": user.id}


@router.get("/alerts")
async def list_alerts(limit: int = 200, db=Depends(get_db)):
    """List alerts for admin CRUD panel."""
    result = await db.execute(select(Alert).order_by(Alert.created_at.desc()).limit(limit))
    alerts = result.scalars().all()
    return {
        "alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "severity": a.severity,
                "title": a.title,
                "description": a.description,
                "location": a.location,
                "source": a.source,
                "is_active": a.is_active,
                "retracted": a.retracted,
                "created_at": a.created_at.isoformat() if a.created_at else "",
            }
            for a in alerts
        ]
    }


@router.post("/alerts")
async def create_alert(body: AlertCreateRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Create alert from admin dashboard, then broadcast via WS + Telegram."""
    loc = dict(body.location or {})
    if body.pincode:
        loc["pincode"] = body.pincode

    alert = Alert(
        id=str(uuid.uuid4()),
        alert_type=body.alert_type,
        severity=body.severity,
        title=body.title,
        description=body.description,
        location=loc,
        source=body.source or "admin",
        is_active=body.is_active,
        retracted=False,
    )
    db.add(alert)
    await db.commit()

    alert_dict = {
        "id": alert.id,
        "type": "alert",
        "alert_type": alert.alert_type,
        "title": alert.title,
        "description": alert.description,
        "severity": alert.severity,
        "location": loc,
        "coordinates": {"lat": loc.get("lat"), "lon": loc.get("lon")},
        "is_active": alert.is_active,
        "source": alert.source,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # ── WebSocket broadcast ────────────────────────────────────────────────────
    try:
        radius = body.radius_km or 100.0
        if loc.get("lat") and loc.get("lon"):
            await ws_manager.broadcast_location_based(alert_dict, radius_km=radius)
        else:
            await ws_manager.broadcast(alert_dict, alert.id)
    except Exception as _e:
        logger.warning("WS broadcast failed: %s", _e)

    # ── Telegram: GPS proximity ────────────────────────────────────────────────
    try:
        import asyncio as _aio
        from telegram_service import telegram_service
        _aio.ensure_future(telegram_service.notify_nearby_users(alert_dict, db))
    except Exception as _e:
        logger.warning("Telegram GPS notify failed: %s", _e)

    # ── Telegram: pincode targeting ────────────────────────────────────────────
    if body.pincode:
        try:
            import asyncio as _aio
            from telegram_service import telegram_service
            _aio.ensure_future(telegram_service.notify_pincode_users(alert_dict, body.pincode, db))
        except Exception as _e:
            logger.warning("Telegram pincode notify failed: %s", _e)

    return {"success": True, "alert_id": alert.id}


@router.put("/alerts/{alert_id}")
async def update_alert(alert_id: str, body: AlertUpdateRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Update alert fields."""
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if body.alert_type is not None:
        alert.alert_type = body.alert_type
    if body.severity is not None:
        alert.severity = body.severity
    if body.title is not None:
        alert.title = body.title
    if body.description is not None:
        alert.description = body.description
    if body.source is not None:
        alert.source = body.source
    if body.location is not None:
        alert.location = body.location
    if body.is_active is not None:
        alert.is_active = body.is_active
    if body.retracted is not None:
        alert.retracted = body.retracted

    await db.commit()
    return {"success": True}


@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Delete alert from admin dashboard."""
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.delete(alert)
    await db.commit()
    return {"success": True}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Delete a user."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"success": True}


# ==================== TELEGRAM ADMIN ENDPOINTS ====================

class TelegramTestRequest(BaseModel):
    chat_id: str
    message: str


class TelegramBroadcastRequest(BaseModel):
    message: str
    alert_id: Optional[str] = None  # if set, format as an alert card


class MultiChannelBroadcastRequest(BaseModel):
    title: Optional[str] = "Admin Broadcast"
    message: str
    severity: Optional[str] = "warning"
    alert_type: Optional[str] = "admin_update"
    alert_id: Optional[str] = None
    channels: List[str] = ["telegram"]


@router.get("/broadcast/channels")
async def broadcast_channel_stats(db=Depends(get_db)):
    """Return available broadcast channels and recipient counts for admin UI."""
    telegram_service = None
    sms_service = None
    email_service = None
    push_subscriptions = 0
    ws_clients = len(ws_manager.active_connections)

    try:
        from telegram_service import telegram_service as _tg_service
        telegram_service = _tg_service
    except Exception:
        telegram_service = None

    try:
        from sms_service import sms_service as _sms_service
        sms_service = _sms_service
    except Exception:
        sms_service = None

    try:
        from email_service import email_service as _email_service
        email_service = _email_service
    except Exception:
        email_service = None

    try:
        from notifications import push_manager
        push_subscriptions = len(getattr(push_manager, "subscriptions", []) or [])
    except Exception:
        push_subscriptions = 0

    tg_q = await db.execute(
        select(func.count(User.id)).where(User.telegram_chat_id.isnot(None), User.is_active == True)
    )
    sms_q = await db.execute(
        select(func.count(User.id)).where(User.phone.isnot(None), User.is_active == True)
    )
    email_q = await db.execute(
        select(func.count(User.id)).where(User.notification_email.isnot(None), User.is_active == True)
    )

    return {
        "telegram": {
            "enabled": bool(getattr(telegram_service, "enabled", False)),
            "recipients": int(tg_q.scalar() or 0),
        },
        "sms": {
            "enabled": sms_service is not None,
            "live": bool(getattr(sms_service, "is_available", False)) if sms_service else False,
            "recipients": int(sms_q.scalar() or 0),
        },
        "email": {
            "enabled": bool(getattr(email_service, "enabled", False)) if email_service else False,
            "recipients": int(email_q.scalar() or 0),
        },
        "push": {
            "enabled": True,
            "recipients": push_subscriptions,
        },
        "websocket": {
            "enabled": True,
            "recipients": ws_clients,
        },
    }


@router.post("/broadcast/multi-channel")
async def admin_multi_channel_broadcast(body: MultiChannelBroadcastRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Broadcast one admin message across selected channels (telegram/sms/email/push/websocket)."""
    selected_channels = {c.strip().lower() for c in (body.channels or []) if c and c.strip()}
    allowed_channels = {"telegram", "sms", "email", "push", "websocket"}
    selected_channels = selected_channels.intersection(allowed_channels)

    if not selected_channels:
        raise HTTPException(status_code=422, detail="At least one valid channel is required")

    selected_alert = None
    if body.alert_id:
        selected_alert = await db.get(Alert, body.alert_id)
        if not selected_alert:
            raise HTTPException(status_code=404, detail="Alert not found for alert_id")

    title = (body.title or "").strip() or (selected_alert.title if selected_alert else "Admin Broadcast")
    severity = (body.severity or "").strip() or (selected_alert.severity if selected_alert else "warning")
    alert_type = (body.alert_type or "").strip() or (selected_alert.alert_type if selected_alert else "admin_update")
    raw_location = selected_alert.location if selected_alert else {}
    location_data = raw_location if isinstance(raw_location, dict) else {}
    message_text = (body.message or "").strip() or (selected_alert.description if selected_alert else "")

    if not message_text:
        raise HTTPException(status_code=422, detail="Message is required")

    payload = {
        "type": "admin_broadcast",
        "title": title,
        "description": message_text,
        "alert_type": alert_type,
        "severity": severity,
        "source": "admin",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "location": location_data or {},
    }

    results: Dict[str, Any] = {}

    if "telegram" in selected_channels:
        try:
            from telegram_service import telegram_service
            if not telegram_service.enabled:
                results["telegram"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": "Telegram bot not configured"}
            else:
                q = await db.execute(select(User).where(User.telegram_chat_id.isnot(None), User.is_active == True))
                users = [u for u in q.scalars().all() if (u.notification_channels or {}).get("telegram", True)]

                if selected_alert:
                    tg_text = telegram_service._format_alert({
                        "title": selected_alert.title,
                        "severity": selected_alert.severity,
                        "description": selected_alert.description,
                        "location": selected_alert.location or {},
                    })
                else:
                    tg_text = f"📢 <b>{title}</b>\n\n{message_text[:3900]}\n\n<i>— Suraksha Setu</i>"

                import asyncio
                tg_tasks = [telegram_service.send_message(u.telegram_chat_id, tg_text) for u in users]
                tg_res = await asyncio.gather(*tg_tasks, return_exceptions=True)
                tg_sent = sum(1 for r in tg_res if r is True)
                results["telegram"] = {
                    "enabled": True,
                    "sent": tg_sent,
                    "total": len(users),
                    "failed": max(0, len(users) - tg_sent),
                }
        except Exception as e:
            results["telegram"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": str(e)}

    if "sms" in selected_channels:
        try:
            from sms_service import sms_service
            q = await db.execute(select(User).where(User.phone.isnot(None), User.is_active == True))
            users = [u for u in q.scalars().all() if (u.notification_channels or {}).get("sms", True)]
            phone_numbers = sorted({str(u.phone).strip() for u in users if u.phone})

            sms_text = f"{title}: {message_text}".strip()
            sms_text = sms_text[:550]

            import asyncio
            sms_tasks = [sms_service.send_sms(phone, sms_text) for phone in phone_numbers]
            sms_res = await asyncio.gather(*sms_tasks, return_exceptions=True)
            sms_sent = sum(1 for r in sms_res if isinstance(r, dict) and r.get("success"))

            results["sms"] = {
                "enabled": True,
                "live": bool(getattr(sms_service, "is_available", False)),
                "sent": sms_sent,
                "total": len(phone_numbers),
                "failed": max(0, len(phone_numbers) - sms_sent),
            }
        except Exception as e:
            results["sms"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": str(e)}

    if "email" in selected_channels:
        try:
            from email_service import email_service
            if not email_service.enabled:
                results["email"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": "Email service not configured"}
            else:
                q = await db.execute(select(User).where(User.notification_email.isnot(None), User.is_active == True))
                users = [u for u in q.scalars().all() if (u.notification_channels or {}).get("email", True)]

                email_alert = {
                    "title": title,
                    "severity": severity,
                    "description": message_text,
                    "location": location_data or {"city": "India", "state": ""},
                    "source": "Suraksha Setu Admin",
                }

                import asyncio
                email_tasks = [
                    email_service.send_alert_email(
                        u.notification_email,
                        u.full_name or u.username or "",
                        email_alert,
                    )
                    for u in users
                ]
                email_res = await asyncio.gather(*email_tasks, return_exceptions=True)
                email_sent = sum(1 for r in email_res if r is True)

                results["email"] = {
                    "enabled": True,
                    "sent": email_sent,
                    "total": len(users),
                    "failed": max(0, len(users) - email_sent),
                }
        except Exception as e:
            results["email"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": str(e)}

    if "push" in selected_channels:
        try:
            from notifications import push_manager
            push_total = len(getattr(push_manager, "subscriptions", []) or [])
            push_sent = await push_manager.broadcast_notification(payload)
            results["push"] = {
                "enabled": True,
                "sent": int(push_sent or 0),
                "total": int(push_total),
                "failed": max(0, int(push_total) - int(push_sent or 0)),
            }
        except Exception as e:
            results["push"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": str(e)}

    if "websocket" in selected_channels:
        try:
            ws_total = len(ws_manager.active_connections)
            await ws_manager.broadcast(payload)
            results["websocket"] = {
                "enabled": True,
                "sent": int(ws_total),
                "total": int(ws_total),
                "failed": 0,
            }
        except Exception as e:
            results["websocket"] = {"enabled": False, "sent": 0, "total": 0, "failed": 0, "error": str(e)}

    # Always create in-app notification records so users see broadcast messages in the bell icon.
    try:
        actor_uid = (_admin or {}).get("uid") or "admin"
        actor_claims = (_admin or {}).get("firebase_claims") or {}
        actor_name = (
            actor_claims.get("name")
            or (_admin or {}).get("name")
            or (_admin or {}).get("email")
            or "Admin Team"
        )

        users_q = await db.execute(select(User).where(User.is_active == True))
        recipients = [u for u in users_q.scalars().all() if u.id and u.id not in {"anonymous", "You"}]
        in_app_payloads: List[Dict[str, Any]] = []

        for target_user in recipients:
            notification_id = str(uuid.uuid4())
            notification_payload = {
                "id": notification_id,
                "user_id": target_user.id,
                "type": "broadcast",
                "title": title[:500],
                "message": message_text[:1500],
                "post_id": None,
                "from_user_id": actor_uid,
                "from_name": actor_name,
                "from_photo": None,
                "is_read": False,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            db.add(
                Notification(
                    id=notification_id,
                    user_id=target_user.id,
                    type="broadcast",
                    title=title[:500],
                    message=message_text[:1500],
                    post_id=None,
                    from_user_id=actor_uid,
                    from_name=actor_name,
                    from_photo=None,
                    is_read=False,
                )
            )
            in_app_payloads.append(notification_payload)

        await db.commit()

        ws_delivered = 0
        for entry in in_app_payloads:
            ws_delivered += await ws_manager.notify_user(
                entry["user_id"],
                {
                    "type": "in_app_notification",
                    "notification": entry,
                },
            )

        results["in_app"] = {
            "enabled": True,
            "sent": len(recipients),
            "total": len(recipients),
            "failed": 0,
            "websocket_delivered": ws_delivered,
        }
    except Exception as e:
        await db.rollback()
        results["in_app"] = {
            "enabled": False,
            "sent": 0,
            "total": 0,
            "failed": 0,
            "error": str(e),
        }

    total_sent = sum(int(v.get("sent", 0)) for v in results.values())
    return {
        "success": True,
        "title": title,
        "message": message_text,
        "channels": sorted(list(selected_channels)),
        "results": results,
        "total_sent": total_sent,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/broadcast/generate")
async def generate_broadcast_content(
    body: BroadcastGenerateRequest,
    _admin=Depends(verify_firebase_token),
):
    """Generate a detailed admin broadcast draft; prefers Google and falls back to OpenRouter."""
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt is required")

    severity = (body.severity or "warning").strip().lower()
    audience = (body.audience or "citizens in affected area").strip()
    language = (body.language or "English").strip()

    system_prompt = """
You are a senior emergency communication officer for Suraksha Setu (India).
Write clear, actionable, non-panicky public advisories.
Your output must be STRICT JSON with keys:
{
  "title": "short headline",
  "message": "detailed public advisory in 4-8 lines",
  "key_actions": ["action 1", "action 2", "action 3"],
  "admin_notes": "optional operator note"
}
Rules:
- Keep factual tone and include immediate safety steps.
- Mention uncertainty if information is unverified.
- Avoid fear language, speculation, and political content.
- Keep title under 90 characters.
""".strip()

    user_prompt = (
        f"Severity: {severity}\n"
        f"Audience: {audience}\n"
        f"Language: {language}\n"
        f"Context from admin: {prompt}\n"
        "Generate the JSON now."
    )

    provider_errors = []
    generated = None

    if ai_client.google_client:
        generated = await ai_client.chat_google(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=GOOGLE_MODEL_CHAT,
            max_tokens=900,
            temperature=0.35,
            json_mode=True,
        )
        if generated.get("error"):
            provider_errors.append(f"google: {generated.get('error')}")
            generated = None

    if generated is None:
        generated = await ai_client.chat_openrouter(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=OPENROUTER_CHAT_MODEL,
            max_tokens=900,
            temperature=0.35,
            json_mode=True,
        )
        if generated.get("error"):
            provider_errors.append(f"openrouter: {generated.get('error')}")
            generated = None

    if generated is None:
        detail = "; ".join(provider_errors) if provider_errors else "No AI text-generation provider available"
        raise HTTPException(status_code=503, detail=detail)

    raw = (generated.get("content") or "").strip()
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {
            "title": f"{severity.capitalize()} Community Update",
            "message": raw,
            "key_actions": [],
            "admin_notes": "",
        }

    title = str(payload.get("title") or f"{severity.capitalize()} Community Update").strip()[:90]
    message = str(payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=500, detail="AI generated empty broadcast message")

    key_actions = payload.get("key_actions")
    if not isinstance(key_actions, list):
        key_actions = []
    key_actions = [str(item).strip() for item in key_actions if str(item).strip()][:5]

    admin_notes = str(payload.get("admin_notes") or "").strip()

    return {
        "success": True,
        "generated": {
            "title": title,
            "message": message,
            "key_actions": key_actions,
            "admin_notes": admin_notes,
        },
        "provider": generated.get("provider") or "openrouter",
        "model": generated.get("model") or OPENROUTER_CHAT_MODEL,
        "usage": generated.get("usage"),
    }


@router.get("/telegram/stats")
async def telegram_stats(db=Depends(get_db)):
    """Return Telegram integration stats."""
    try:
        from telegram_service import telegram_service, TELEGRAM_BOT_USERNAME
        linked_q = await db.execute(
            select(func.count(User.id)).where(User.telegram_chat_id.isnot(None))
        )
        linked_users = linked_q.scalar() or 0
        total_q = await db.execute(select(func.count(User.id)))
        total_users = total_q.scalar() or 0
        return {
            "enabled": telegram_service.enabled,
            "bot_username": TELEGRAM_BOT_USERNAME,
            "linked_users": linked_users,
            "total_users": total_users,
            "percentage": round(linked_users / total_users * 100, 1) if total_users else 0,
        }
    except Exception as e:
        logger.error("Telegram stats error: %s", e)
        return {"enabled": False, "bot_username": "", "linked_users": 0, "total_users": 0, "percentage": 0}


@router.post("/telegram/test")
async def telegram_test(body: TelegramTestRequest, _admin=Depends(verify_firebase_token)):
    """Send a test Telegram message to a specific chat_id (admin only)."""
    try:
        from telegram_service import telegram_service
        if not telegram_service.enabled:
            raise HTTPException(status_code=503, detail="Telegram bot not configured. Set TELEGRAM_BOT_TOKEN in .env")
        chat_id = body.chat_id.strip()
        if not chat_id:
            raise HTTPException(status_code=422, detail="chat_id is required")
        # Sanitise message: strip raw HTML to prevent injection into Telegram API
        message_text = body.message[:4000]
        html_msg = f"🔔 <b>Admin Test Message</b>\n\n{message_text}\n\n<i>— Suraksha Setu Admin Panel</i>"
        success = await telegram_service.send_message(chat_id, html_msg)
        if not success:
            raise HTTPException(status_code=502, detail="Telegram API rejected the message. Check chat_id and bot token.")
        return {"success": True, "chat_id": chat_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Telegram test error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/telegram/broadcast")
async def telegram_broadcast(body: TelegramBroadcastRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """Broadcast a message to all Telegram-linked users."""
    try:
        from telegram_service import telegram_service
        if not telegram_service.enabled:
            raise HTTPException(status_code=503, detail="Telegram bot not configured. Set TELEGRAM_BOT_TOKEN in .env")

        # If an alert_id is provided, format as alert card
        text = ""
        if body.alert_id:
            alert = await db.get(Alert, body.alert_id)
            if alert:
                alert_dict = {
                    "title": alert.title,
                    "severity": alert.severity,
                    "description": alert.description,
                    "location": alert.location or {},
                }
                text = telegram_service._format_alert(alert_dict)
            else:
                text = body.message[:4000]
        else:
            text = f"📢 <b>Admin Broadcast</b>\n\n{body.message[:4000]}\n\n<i>— Suraksha Setu</i>"

        # Fetch all linked users
        result = await db.execute(
            select(User).where(User.telegram_chat_id.isnot(None), User.is_active == True)
        )
        users = result.scalars().all()

        if not users:
            return {"success": True, "sent": 0, "total": 0, "message": "No Telegram-linked users found"}

        import asyncio
        tasks = [telegram_service.send_message(u.telegram_chat_id, text) for u in users]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        sent = sum(1 for r in results if r is True)
        logger.info("Telegram broadcast: %d/%d sent", sent, len(users))
        return {"success": True, "sent": sent, "total": len(users)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Telegram broadcast error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ==================== SYSTEM LOGS ====================

@router.get("/logs")
async def get_system_logs(limit: int = 20, db=Depends(get_db)):
    """Return recent system activity for the admin overview."""
    logs = []

    # Recent alerts as log items
    try:
        alert_result = await db.execute(
            select(Alert).order_by(Alert.created_at.desc()).limit(limit)
        )
        for a in alert_result.scalars().all():
            severity_map = {"critical": "red", "warning": "yellow", "info": "blue"}
            logs.append({
                "color": severity_map.get(a.severity, "blue"),
                "title": f"Alert: {a.title}",
                "description": f"{a.severity.capitalize()} — {a.source or 'system'}",
                "time": a.created_at.isoformat() if a.created_at else "",
            })
    except Exception:
        pass

    # Recent incidents
    try:
        inc_result = await db.execute(
            select(IncidentLog).order_by(IncidentLog.created_at.desc()).limit(limit)
        )
        for inc in inc_result.scalars().all():
            logs.append({
                "color": "red" if inc.incident_type == "retraction" else "yellow",
                "title": f"Incident: {inc.incident_type}",
                "description": inc.reason[:120],
                "time": inc.created_at.isoformat() if inc.created_at else "",
            })
    except Exception:
        pass

    # Sort by time descending
    logs.sort(key=lambda l: l["time"], reverse=True)
    return {"logs": logs[:limit]}


def _relative_time(dt):
    if not dt:
        return "Unknown"
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        from datetime import timezone as tz
        dt = dt.replace(tzinfo=tz.utc)
    diff = now - dt
    if diff.total_seconds() < 60:
        return "Just now"
    if diff.total_seconds() < 3600:
        return f"{int(diff.total_seconds() // 60)} minutes ago"
    if diff.total_seconds() < 86400:
        return f"{int(diff.total_seconds() // 3600)} hours ago"
    return f"{diff.days} days ago"


# ==================== ADMIN ENDPOINTS ====================

@router.post("/alerts/retract")
async def retract_alert(request: RetractionRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """
    Retract an alert using the full safety pipeline:
    1. Mark alert as retracted in DB
    2. Log incident (incident_logs table)
    3. Record false positive for auto-disable tracking
    4. Send correction via WebSocket + Push
    """
    from alert_safety import retraction_service, AlertDecisionEngine

    result = await retraction_service.retract_alert(
        alert_id=request.alert_id,
        reason=request.reason,
        admin_user_id=request.admin_user_id or "admin",
    )

    if not result["success"]:
        raise HTTPException(status_code=404 if "not found" in result.get("error", "") else 500,
                            detail=result.get("error", "Retraction failed"))

    return result


@router.post("/alerts/approve")
async def approve_pending_alert(request: AlertApprovalRequest, db=Depends(get_db), _admin=Depends(verify_firebase_token)):
    """
    Approve or reject a pending alert (human-in-the-loop for medium confidence).
    """
    from alert_safety import AlertDecisionEngine

    alert = await db.get(Alert, request.alert_id)
    
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    if request.approved:
        alert.is_active = True
        await db.commit()
        
        logger.info(f"Admin approved alert {request.alert_id}")
        
        return {
            "success": True,
            "alert_id": request.alert_id,
            "action": "approved",
            "message": "Alert activated and notifications sent"
        }
    else:
        alert.is_active = False
        alert.retracted = True
        alert.retraction_reason = "Rejected by admin during review"
        await db.commit()

        # Record as false positive
        AlertDecisionEngine.record_false_positive(alert.alert_type)
        
        logger.info(f"Admin rejected alert {request.alert_id}")
        
        return {
            "success": True,
            "alert_id": request.alert_id,
            "action": "rejected",
            "message": "Alert rejected and marked as false positive"
        }


@router.get("/incidents")
async def get_incident_logs(limit: int = 50, db = Depends(get_db)):
    """Get recent incident logs (retractions, false positives)."""
    from alert_safety import retraction_service

    logs = await retraction_service.get_incident_logs(limit=limit)
    return {"total": len(logs), "incidents": logs}


@router.get("/safety/status")
async def get_safety_status():
    """Get current alert safety engine status (rate limits, disabled types, false positive counts)."""
    from alert_safety import AlertDecisionEngine

    return {
        "false_positive_counts": dict(AlertDecisionEngine._false_positive_count),
        "auto_disabled_types": [
            t for t in AlertDecisionEngine._false_positive_count
            if AlertDecisionEngine._is_auto_disabled(t)
        ],
        "max_alerts_per_hour": AlertDecisionEngine.MAX_ALERTS_PER_HOUR,
        "false_positive_threshold": AlertDecisionEngine.FALSE_POSITIVE_THRESHOLD,
    }


@router.post("/safety/reset/{event_type}")
async def reset_false_positives(event_type: str):
    """Admin reset of false positive counter to re-enable auto-alerting."""
    from alert_safety import AlertDecisionEngine

    AlertDecisionEngine.reset_false_positives(event_type)
    return {"success": True, "event_type": event_type, "message": f"False positives reset for {event_type}"}


@router.get("/alerts/pending")
async def get_pending_alerts(db = Depends(get_db)):
    """Get alerts awaiting admin review (medium confidence)."""
    from sqlalchemy import select
    
    # Filter for alerts that are not active and not retracted
    # (These are pending review)
    query = select(Alert).where(
        Alert.is_active == False,
        Alert.retracted == False
    ).order_by(Alert.created_at.desc())
    
    result = await db.execute(query)
    alerts = result.scalars().all()
    
    return {
        "total": len(alerts),
        "pending_alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "severity": a.severity,
                "title": a.title,
                "location": a.location,
                "created_at": a.created_at.isoformat()
            }
            for a in alerts
        ]
    }


# ==================== COMMUNITY VERIFICATION ====================

@router.get("/community-verification/posts")
async def list_community_verification_posts(
    status: str = "pending_admin_review",
    limit: int = 50,
    db=Depends(get_db),
):
    """List community alert/emergency posts with admin verification state."""
    safe_limit = min(max(int(limit), 1), 200)

    query = (
        select(CommunityPost)
        .where(CommunityPost.post_type.in_(list(REVIEW_REQUIRED_POST_TYPES)))
        .order_by(CommunityPost.created_at.desc())
        .limit(safe_limit)
    )
    result = await db.execute(query)
    posts = result.scalars().all()

    normalized_status = (status or "all").strip().lower()
    response_posts: list[dict] = []
    for post in posts:
        location_meta = post.location if isinstance(post.location, dict) else {}
        verification = _normalize_community_verification(location_meta, post.post_type)
        if normalized_status != "all" and verification.get("status") != normalized_status:
            continue

        response_posts.append(
            {
                "id": post.id,
                "user_id": post.user_id,
                "type": post.post_type,
                "content": post.content,
                "media": post.media or [],
                "tags": post.tags or [],
                "location": location_meta,
                "image_analysis": _extract_post_image_analysis(post, location_meta),
                "is_public": bool(post.is_public),
                "created_at": post.created_at.isoformat() if post.created_at else None,
                "verification": verification,
            }
        )

    return {
        "total": len(response_posts),
        "status": normalized_status,
        "posts": response_posts,
    }


@router.put("/community-verification/posts/{post_id}")
async def update_community_post_verification(
    post_id: str,
    body: CommunityPostVerificationRequest,
    db=Depends(get_db),
    _admin=Depends(verify_firebase_token),
):
    """Update admin verification status, comments, and user-facing report for a community post."""
    post = await db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if (post.post_type or "").strip().lower() not in REVIEW_REQUIRED_POST_TYPES:
        raise HTTPException(status_code=400, detail="This post type does not require admin verification")

    target_status = (body.status or "").strip().lower()
    if target_status not in COMMUNITY_VERIFICATION_STATUS_META:
        allowed = ", ".join(sorted(COMMUNITY_VERIFICATION_STATUS_META.keys()))
        raise HTTPException(status_code=422, detail=f"status must be one of: {allowed}")

    location_meta = copy.deepcopy(post.location) if isinstance(post.location, dict) else {}
    verification = _normalize_community_verification(location_meta, post.post_type)

    status_meta = COMMUNITY_VERIFICATION_STATUS_META[target_status]
    progress_message = (body.progress_message or "").strip()
    if not progress_message:
        if target_status == "approved":
            progress_message = "This post has been verified by admin and is now visible to the community."
        elif target_status == "rejected":
            progress_message = "This post was rejected during admin verification and remains hidden."
        elif target_status == "needs_info":
            progress_message = "Admin requested more details to verify this post."
        elif target_status == "in_review":
            progress_message = "Admin is currently reviewing evidence and details."
        else:
            progress_message = "Post is queued for admin verification."

    admin_comment = (body.admin_comment or "").strip()[:1500] or None
    report_to_user = (body.report_to_user or "").strip()[:1500] or None

    actor_uid = (_admin or {}).get("uid") or "admin"
    actor_claims = (_admin or {}).get("firebase_claims") or {}
    actor_name = (
        actor_claims.get("name")
        or (_admin or {}).get("name")
        or (_admin or {}).get("email")
        or "Admin Team"
    )

    notify_channels = _normalize_channel_list(body.notify_channels)
    if target_status == "approved" and not notify_channels:
        notify_channels = DEFAULT_COMMUNITY_APPROVAL_CHANNELS.copy()
    raw_radius = body.notify_radius_km if body.notify_radius_km is not None else DEFAULT_COMMUNITY_APPROVAL_RADIUS_KM
    try:
        notify_radius_km = float(raw_radius)
    except (TypeError, ValueError):
        notify_radius_km = DEFAULT_COMMUNITY_APPROVAL_RADIUS_KM
    notify_radius_km = max(1.0, min(MAX_COMMUNITY_APPROVAL_RADIUS_KM, notify_radius_km))

    delivery_summary: Optional[Dict[str, Any]] = None
    if target_status == "approved":
        delivery_summary = await _dispatch_approved_community_post(
            post=post,
            location_meta=location_meta,
            channels=notify_channels,
            radius_km=notify_radius_km,
            db=db,
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    history = verification.get("history") if isinstance(verification.get("history"), list) else []
    history_entry = {
        "status": target_status,
        "status_label": status_meta["label"],
        "message": progress_message,
        "admin_comment": admin_comment,
        "report_to_user": report_to_user,
        "updated_by": actor_uid,
        "updated_at": now_iso,
    }
    if target_status == "approved":
        history_entry["notify_channels"] = notify_channels
        history_entry["notify_radius_km"] = notify_radius_km
        history_entry["delivery"] = delivery_summary
    history.append(history_entry)

    verification.update(
        {
            "requires_admin_review": True,
            "status": target_status,
            "status_label": status_meta["label"],
            "progress_percent": status_meta["progress"],
            "message": progress_message,
            "admin_comment": admin_comment,
            "report_to_user": report_to_user,
            "updated_by": actor_uid,
            "updated_at": now_iso,
            "history": history,
        }
    )

    if target_status == "approved":
        verification["notify_channels"] = notify_channels
        verification["notify_radius_km"] = notify_radius_km
        verification["delivery"] = delivery_summary or {}
    else:
        verification.pop("notify_channels", None)
        verification.pop("notify_radius_km", None)
        verification.pop("delivery", None)

    location_meta["verification"] = verification
    post.location = location_meta
    flag_modified(post, "location")
    post.is_public = target_status == "approved"

    user_notification_payload: Optional[Dict[str, Any]] = None
    if post.user_id and post.user_id not in {"anonymous", "You"}:
        user_message = report_to_user or admin_comment or progress_message
        notification_id = str(uuid.uuid4())
        user_notification_payload = {
            "id": notification_id,
            "user_id": post.user_id,
            "type": "admin_review",
            "title": f"Post verification: {status_meta['label']}",
            "message": user_message,
            "post_id": post.id,
            "from_user_id": actor_uid,
            "from_name": actor_name,
            "from_photo": None,
            "is_read": False,
            "timestamp": now_iso,
        }
        db.add(
            Notification(
                id=notification_id,
                user_id=post.user_id,
                type="admin_review",
                title=f"Post verification: {status_meta['label']}",
                message=user_message,
                post_id=post.id,
                from_user_id=actor_uid,
                from_name=actor_name,
                from_photo=None,
                is_read=False,
            )
        )

    await db.commit()

    if user_notification_payload:
        try:
            await ws_manager.notify_user(
                post.user_id,
                {
                    "type": "in_app_notification",
                    "notification": user_notification_payload,
                },
            )
        except Exception as ws_exc:
            logger.debug("Verification notification websocket fanout failed: %s", ws_exc)

    return {
        "success": True,
        "post_id": post.id,
        "is_public": bool(post.is_public),
        "verification": verification,
        "delivery": delivery_summary,
    }


# ==================== COMMUNITY REPORTS ====================

@router.get("/reports")
async def get_community_reports(status: str = "pending", limit: int = 50, db=Depends(get_db)):
    """List user-submitted community reports for admin moderation."""
    try:
        query = select(UserReport).order_by(UserReport.created_at.desc()).limit(limit)
        if status != "all":
            query = query.where(UserReport.status == status)
        result = await db.execute(query)
        reports = result.scalars().all()
        return {
            "total": len(reports),
            "reports": [
                {
                    "id": r.id,
                    "reporter_id": r.reporter_id,
                    "reporter_name": r.reporter_name,
                    "reported_user_id": r.reported_user_id,
                    "reported_user_name": r.reported_user_name,
                    "post_id": r.post_id,
                    "reason": r.reason,
                    "description": r.description,
                    "status": r.status,
                    "created_at": r.created_at.isoformat() if r.created_at else "",
                }
                for r in reports
            ],
        }
    except Exception as e:
        logger.error(f"Reports fetch error: {e}")
        return {"total": 0, "reports": []}


class ReportActionRequest(BaseModel):
    status: str  # 'reviewed' | 'resolved' | 'dismissed'
    admin_note: Optional[str] = None


@router.put("/reports/{report_id}")
async def update_report_status(report_id: str, body: ReportActionRequest, db=Depends(get_db)):
    """Update the status of a community report (dismiss / resolve)."""
    valid = {"reviewed", "resolved", "dismissed"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    report = await db.get(UserReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = body.status
    await db.commit()
    return {"success": True, "report_id": report_id, "status": body.status}
