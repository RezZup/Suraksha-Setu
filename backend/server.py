"""
Suraksha Setu API v3.0 – Production Server
Routes: AI (chat, voice, vision), Alerts, Admin, Playbook, Notifications, Geo, Community
"""
from fastapi import (
    FastAPI, APIRouter, HTTPException, Depends, Request,
    WebSocket, WebSocketDisconnect, UploadFile, File,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from contextlib import asynccontextmanager
import logging
import os
import io
import uuid
import json
import base64
from datetime import datetime, timezone
from dotenv import load_dotenv

# Core modules
from database import init_db, close_db, get_db, AsyncSessionLocal, AILog, Alert
from notifications import ws_manager, push_manager
from risk_engine import RiskEngine
from playbook import playbook_engine
from utils.redis_client import redis_client

# AI modules
from ai.orchestrator import orchestrator
from ai.openai_client import ai_client, TOTAL_TOKEN_LIMIT
from ai.sarvam_client import sarvam_client
from ai.vision_pipeline import analyze_community_image, save_upload
from ai.voice_pipeline import process_voice_query

# Data ingestion
from ingest.manager import IngestionManager

# Rate limiting
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter

# Geo utility
from geopy.geocoders import Nominatim

# Load Environment
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REDIS_TOKEN_KEY = "openai:total_tokens_used"

# ──────────────────────────────────────────────────────────────
#  LIFESPAN
# ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Initializing Suraksha Setu v3.0...")

    await init_db()

    # Restore push subscriptions from DB so they survive server restarts
    try:
        from database import AsyncSessionLocal
        async with AsyncSessionLocal() as _db:
            await push_manager.load_from_db(_db)
    except Exception as _e:
        logger.warning("Push subscription restore failed: %s", _e)

    await redis_client.connect()
    r = await redis_client.get_client()
    if r:
        await FastAPILimiter.init(r)
        logger.info("✅ Redis + Rate Limiter ready")
    else:
        logger.warning("⚠️  Redis unavailable – caching/rate-limiting disabled")

    logger.info("✅ Suraksha Setu Backend Online")
    yield

    await close_db()
    await redis_client.close()
    logger.info("🛑 Shutdown complete")


# ──────────────────────────────────────────────────────────────
#  APP
# ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="Suraksha Setu API",
    version="3.0.0",
    description="AI-Powered Disaster Management Platform for India",
    lifespan=lifespan,
)

_cors_env = os.getenv("CORS_ORIGINS", "").strip()
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()] if _cors_env else [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler for unhandled errors
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal server error"},
    )


# ══════════════════════════════════════════════════════════════
#  AI ROUTES
# ══════════════════════════════════════════════════════════════
ai_router = APIRouter(prefix="/api/ai", tags=["AI"])


@ai_router.post("")
@ai_router.post("/chat")
async def ai_chat(request: Request):
    """
    Unified AI Chat Endpoint.
    Body: { "role": "citizen", "message"|"query": "...", "context": {...} }
    Supports: text queries, function calling, RAG (scientist)
    """
    data = await request.json()
    role = data.get("role", "citizen")
    message = data.get("message") or data.get("query", "")
    context = data.get("context", {})

    # Language hints from frontend
    locale = data.get("locale") or data.get("language")
    if locale:
        context["locale"] = locale
        context["language"] = locale

    # Pass through widget-specific fields
    if data.get("rag_mode"):
        context["rag_mode"] = True
    if data.get("report_mode"):
        context["report_mode"] = data["report_mode"]
    if data.get("locale"):
        context["locale"] = data["locale"]

    if not message:
        raise HTTPException(status_code=400, detail="Message is required")

    result = await orchestrator.route_request(role, message, context)

    # Log to ai_logs
    usage = result.get("usage") or {}
    try:
        async with AsyncSessionLocal() as db:
            log = AILog(
                id=str(uuid.uuid4()),
                endpoint="chat",
                model=usage.get("model", "gpt-4o-mini"),
                prompt_tokens=usage.get("prompt", 0),
                completion_tokens=usage.get("completion", 0),
                total_tokens=usage.get("total", usage.get("total_tokens", 0)),
                role=role,
                tool_calls=result.get("tool_calls_executed"),
            )
            db.add(log)
            await db.commit()
    except Exception as e:
        logger.warning(f"AI log write failed: {e}")

    # Reshape response for frontend widgets
    return {
        "success": result.get("success", True),
        "response": result.get("message", ""),
        "answer": result.get("message", ""),
        "role": role,
        "confidence": result.get("confidence", 0.65),
        "token_cost": result.get("token_cost", 0),
        "sources": result.get("sources", []),
        "cached": result.get("cached", False),
        "quiz": result.get("quiz"),
        "tool_calls_executed": result.get("tool_calls_executed", []),
        "usage": usage,
    }


from ai.voice_pipeline import process_voice_query

@ai_router.post("/voice")
async def ai_voice(
    file: UploadFile = File(...),
    role: str = "citizen",
    language: str = None,
):
    """
    Voice Query Endpoint (Whisper + Orchestrator).
    Accepts audio file → transcribes → routes to AI → returns transcript + response.
    """
    if not file.content_type or not file.content_type.startswith("audio"):
        raise HTTPException(status_code=400, detail="Audio file required")

    audio_bytes = await file.read()
    if len(audio_bytes) > 25 * 1024 * 1024:  # 25MB Whisper limit
        raise HTTPException(status_code=413, detail="Audio file too large (max 25MB)")

    result = await process_voice_query(
        audio_bytes=audio_bytes,
        filename=file.filename or "voice.wav",
        role=role,
        context={"locale": language, "language": language} if language else {},
        language=language,
    )

    # Never hard-fail voice UX on upstream STT issues.
    # Return a graceful payload so frontend can fall back to transcript-based text chat.
    if result.get("error"):
        return {
            "transcript": result.get("transcript") or "",
            "detected_language": language or "unknown",
            "response": "I could not transcribe the audio clearly. Please try again or type your message.",
            "usage": None,
            "error": "voice_stt_unavailable",
        }

    # Log voice usage
    try:
        async with AsyncSessionLocal() as db:
            log = AILog(
                id=str(uuid.uuid4()),
                endpoint="voice",
                model="whisper-1",
                total_tokens=0, # specific to audio
                role=role,
                tool_calls=None
            )
            db.add(log)
            await db.commit()
    except Exception as e:
        logger.warning(f"Voice log failed: {e}")

    return result


@ai_router.post("/vision")
async def ai_vision(request: Request):
    """
    Vision Analysis Endpoint.
    Body: { "image_url": "https://...", "description": "..." }
    OR multipart form with image file.
    Analyses disaster images and classifies severity.
    """
    content_type = request.headers.get("content-type", "")

    if "multipart" in content_type:
        form = await request.form()
        image_file = form.get("image")
        description = form.get("description", "")
        if not image_file:
            raise HTTPException(status_code=400, detail="Image file required")
        img_bytes = await image_file.read()
        b64 = base64.b64encode(img_bytes).decode()
        image_source = f"data:image/jpeg;base64,{b64}"
    else:
        data = await request.json()
        image_source = data.get("image_url")
        description = data.get("description", "")
        if not image_source:
            raise HTTPException(status_code=400, detail="image_url required")

    result = await analyze_community_image(image_source, description)

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return result


@ai_router.post("/tts")
async def ai_tts(request: Request):
    """
    Text-to-Speech Endpoint.
    Body: { "text": "...", "voice": "alloy", "speed": 1.0 }
    Returns audio/mpeg stream.
    """
    data = await request.json()
    text = data.get("text", "")
    voice = data.get("voice", "alloy")
    speed = data.get("speed", 1.0)

    if not text:
        raise HTTPException(status_code=400, detail="text required")

    lang = data.get("language", "en-IN")
    # Indian languages → Sarvam TTS is cheaper and sounds more natural
    indian_langs = {"hi", "hi-IN", "ta", "ta-IN", "te", "te-IN", "bn", "bn-IN",
                    "gu", "gu-IN", "kn", "kn-IN", "ml", "ml-IN", "pa", "pa-IN",
                    "mr", "mr-IN", "hi-rom"}
    use_sarvam_first = sarvam_client.enabled and any(lang.startswith(l.split("-")[0]) for l in indian_langs)

    result = None
    if use_sarvam_first:
        # Normalise language code for Sarvam (hi-rom → hi-IN)
        sarvam_lang = "hi-IN" if lang in ("hi-rom", "hi") else (lang if "-IN" in lang else f"{lang.split('-')[0]}-IN")
        result = await sarvam_client.text_to_speech(text, language_code=sarvam_lang)
        if result.get("error"):
            logger.warning("Sarvam TTS failed (%s), falling back to OpenAI", result["error"])
            result = None

    if not result or result.get("error"):
        openai_result = await ai_client.text_to_speech(text, voice=voice, speed=speed)
        if openai_result.get("error"):
            raise HTTPException(status_code=500, detail=openai_result["error"])
        result = openai_result

    return StreamingResponse(
        io.BytesIO(result["audio_bytes"]),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "attachment; filename=speech.mp3"},
    )


@ai_router.post("/translate")
async def ai_translate(request: Request):
    """
    Translation endpoint (Sarvam-first backup utility).
    Body: { "text": "...", "source_language": "auto", "target_language": "hi" }
    """
    data = await request.json()
    text = data.get("text", "")
    source_language = data.get("source_language", "auto")
    target_language = data.get("target_language", "en")

    if not text:
        raise HTTPException(status_code=400, detail="text required")

    result = await sarvam_client.translate(
        text=text,
        source_language=source_language,
        target_language=target_language,
    )

    # Fallback to primary LLM translation if Sarvam route is unavailable
    if result.get("error"):
        if ai_client.client:
            fallback = await ai_client.chat(
                system_prompt=(
                    "You are a translation assistant. Return only translated text with no extra notes."
                ),
                user_prompt=(
                    f"Translate from {source_language} to {target_language}:\n{text}"
                ),
                model=os.getenv("OPENAI_MODEL_MINI", "gpt-4o-mini"),
                max_tokens=300,
                temperature=0.1,
            )
            if not fallback.get("error") and fallback.get("content"):
                return {
                    "success": True,
                    "translated_text": fallback.get("content").strip(),
                    "source_language": source_language,
                    "target_language": target_language,
                    "provider": "openai",
                }

        # Final passthrough fallback (never fail hard)
        return {
            "success": True,
            "translated_text": text,
            "source_language": source_language,
            "target_language": target_language,
            "provider": "fallback",
            "warning": "Translation provider unavailable; returned original text",
        }

    return {
        "success": True,
        "translated_text": result.get("translated_text"),
        "source_language": source_language,
        "target_language": target_language,
        "provider": "sarvam",
    }


# ══════════════════════════════════════════════════════════════
#  ALERT ROUTES
# ══════════════════════════════════════════════════════════════
api_router = APIRouter(prefix="/api", tags=["Core"])


@api_router.get("/alerts")
async def get_alerts(lat: float = None, lon: float = None, db: AsyncSession = Depends(get_db)):
    """Get active alerts with optional geo-filtering."""
    query = select(Alert).where(Alert.is_active == True, Alert.retracted == False)
    result = await db.execute(query.order_by(Alert.created_at.desc()).limit(50))
    alerts = result.scalars().all()
    return {
        "alerts": [
            {
                "id": a.id,
                "type": a.alert_type,
                "severity": a.severity,
                "title": a.title,
                "description": a.description,
                "location": a.location,
                "source": a.source,
                "created_at": str(a.created_at),
            }
            for a in alerts
        ]
    }


@api_router.post("/admin/ingest")
async def trigger_ingest(db: AsyncSession = Depends(get_db)):
    """Manual trigger for data ingestion cycle."""
    await IngestionManager.run_ingest_cycle(db)
    return {"status": "Ingestion Cycle Triggered"}


# ══════════════════════════════════════════════════════════════
#  PLAYBOOK
# ══════════════════════════════════════════════════════════════
@api_router.get("/playbook/actions")
async def get_playbook_actions(risk_type: str, severity: str, role: str = "citizen"):
    """Get deterministic SOP actions for a scenario."""
    actions = playbook_engine.get_actions(risk_type, severity, role)
    return {"actions": actions}


# ══════════════════════════════════════════════════════════════
#  NOTIFICATIONS
# ══════════════════════════════════════════════════════════════
@api_router.post("/notifications/subscribe")
async def subscribe_push(subscription: dict, db: AsyncSession = Depends(get_db)):
    """Register a push subscription, optionally with user location for proximity alerts."""
    # The payload may contain: { subscription: {...webpush sub...}, user_id, user_lat, user_lon }
    sub_info = subscription.get('subscription') or subscription
    user_id = subscription.get('user_id')
    user_lat = subscription.get('user_lat')
    user_lon = subscription.get('user_lon')

    # Add to in-memory manager (for WS/push broadcast compat)
    push_manager.add_subscription(sub_info)

    # Persist to DB with location so proximity push works after server restart
    try:
        from database import PushSubscription
        endpoint = (sub_info.get('endpoint') or '')
        # Upsert: delete old entry for same endpoint, then insert
        from sqlalchemy import select as sa_select, delete as sa_delete
        await db.execute(sa_delete(PushSubscription).where(
            PushSubscription.subscription_json['endpoint'].as_string() == endpoint
        ))
        db.add(PushSubscription(
            id=str(uuid.uuid4()),
            user_id=user_id,
            subscription_json=sub_info,
            user_lat=float(user_lat) if user_lat is not None else None,
            user_lon=float(user_lon) if user_lon is not None else None,
            is_active=True,
        ))
        await db.commit()
    except Exception as e:
        logger.warning("Could not persist push subscription: %s", e)

    return {"success": True}


@api_router.post("/notifications/broadcast")
async def broadcast_alert(payload: dict):
    """Admin endpoint to broadcast alert."""
    count = await push_manager.broadcast_notification(payload)
    await ws_manager.broadcast(payload)
    return {"sent_push": count, "sent_ws": "all"}


@api_router.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await ws_manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                msg_type = message.get("type")

                if msg_type == "ping":
                    await ws_manager.send_personal_message(
                        {"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()},
                        websocket,
                    )
                elif msg_type == "set_location":
                    location = message.get("location", {})
                    ws_manager.set_client_location(client_id, location)
                    await ws_manager.send_personal_message(
                        {"type": "location_set", "status": "ok"},
                        websocket,
                    )
                elif msg_type == "request_alerts":
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(
                            select(Alert)
                            .where(Alert.is_active == True, Alert.retracted == False)
                            .order_by(Alert.created_at.desc())
                            .limit(20)
                        )
                        active_alerts = result.scalars().all()
                    await ws_manager.send_personal_message(
                        {
                            "type": "alerts_list",
                            "alerts": [
                                {
                                    "id": str(a.id),
                                    "type": a.event_type,
                                    "severity": a.severity,
                                    "title": a.title,
                                    "description": a.description,
                                    "coordinates": a.coordinates,
                                    "created_at": a.created_at.isoformat() if a.created_at else None,
                                }
                                for a in active_alerts
                            ],
                        },
                        websocket,
                    )
                elif msg_type == "get_stats":
                    await ws_manager.send_personal_message(
                        {
                            "type": "stats",
                            "connected_clients": len(ws_manager.active_connections),
                        },
                        websocket,
                    )
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)


# ══════════════════════════════════════════════════════════════
#  ADMIN / AI USAGE MONITORING
# ══════════════════════════════════════════════════════════════
admin_router = APIRouter(prefix="/admin", tags=["Admin"])


@admin_router.get("/ai/usage")
async def ai_usage_stats():
    """Get AI token usage statistics and budget status."""
    try:
        r = await redis_client.get_client()
        used = int(await r.get(REDIS_TOKEN_KEY) or 0) if r else 0
    except Exception:
        used = 0

    # DB stats
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(
                    func.count(AILog.id),
                    func.sum(AILog.total_tokens),
                ).where(AILog.error.is_(None))
            )
            row = result.one()
            db_calls = row[0] or 0
            db_tokens = row[1] or 0
    except Exception:
        db_calls, db_tokens = 0, 0

    return {
        "redis_tokens_used": used,
        "db_total_calls": db_calls,
        "db_total_tokens": db_tokens,
        "budget_limit": TOTAL_TOKEN_LIMIT,
        "budget_remaining": max(0, TOTAL_TOKEN_LIMIT - used),
        "budget_used_pct": round(used / TOTAL_TOKEN_LIMIT * 100, 2) if TOTAL_TOKEN_LIMIT else 0,
    }


@admin_router.get("/ai/logs")
async def ai_logs(limit: int = 50):
    """Get recent AI call logs."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AILog).order_by(AILog.created_at.desc()).limit(limit)
            )
            logs = result.scalars().all()
            return {
                "logs": [
                    {
                        "id": l.id,
                        "endpoint": l.endpoint,
                        "model": l.model,
                        "total_tokens": l.total_tokens,
                        "role": l.role,
                        "tool_calls": l.tool_calls,
                        "cached": l.cached,
                        "error": l.error,
                        "created_at": str(l.created_at),
                    }
                    for l in logs
                ]
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════
#  SAFETY SCORE
# ══════════════════════════════════════════════════════════════
@api_router.get("/safety-score")
async def get_safety_score(
    latitude: float = None, longitude: float = None,
    db: AsyncSession = Depends(get_db)
):
    """Compute safety score based on nearby alerts and risk factors."""
    # Get active alerts
    result = await db.execute(
        select(Alert).where(Alert.is_active == True, Alert.retracted == False)
    )
    alerts = result.scalars().all()

    base_score = 90
    critical = sum(1 for a in alerts if a.severity in ("critical", "red"))
    warning = sum(1 for a in alerts if a.severity in ("warning", "orange"))
    base_score -= critical * 15 + warning * 5
    base_score = max(0, min(100, base_score))

    return {
        "total_score": base_score,
        "breakdown": {
            "location_risk": max(0, 100 - critical * 20),
            "weather_risk": max(0, 100 - warning * 10),
            "disaster_proximity": 100 if not alerts else max(0, 100 - len(alerts) * 8),
            "infrastructure": 85,
        },
        "active_alerts": len(alerts),
    }


# ══════════════════════════════════════════════════════════════
#  USER PHONE REGISTRATION (for SMS alerts)
# ══════════════════════════════════════════════════════════════
from sms_service import phone_registry, alert_dispatcher, sms_service
from pydantic import BaseModel as PydanticBaseModel

class PhoneRegistrationRequest(PydanticBaseModel):
    uid: str
    phone: str
    email: str = ""
    name: str = ""
    lat: float | None = None
    lon: float | None = None
    pincode: str | None = None
    city: str | None = None
    state: str | None = None

@api_router.post("/users/register-phone")
async def register_phone(req: PhoneRegistrationRequest, db: AsyncSession = Depends(get_db)):
    """Register a phone number for SMS alerts (in-memory + DB persistence)."""
    from database import User

    normalized_phone = sms_service._normalize_e164(req.phone)
    phone_registry.register(
        uid=req.uid,
        phone=normalized_phone,
        email=req.email,
        name=req.name,
        location={
            "lat": req.lat,
            "lon": req.lon,
            "gps_pincode": req.pincode,
            "city": req.city,
            "state": req.state,
        },
    )

    # Persist phone + location snapshot so proximity filters survive server restarts.
    result = await db.execute(select(User).where(User.id == req.uid))
    user = result.scalar_one_or_none()
    if not user:
        base_email = (req.email or f"{req.uid}@firebase.local").strip().lower()
        username = base_email.split("@")[0]
        dup = await db.execute(select(User).where(User.username == username))
        if dup.scalar_one_or_none():
            username = f"{username}_{req.uid[:6]}"
        user = User(
            id=req.uid,
            email=base_email,
            username=username,
            password_hash="firebase_auth",
            full_name=(req.name or username).strip(),
            user_type="citizen",
            is_active=True,
        )
        db.add(user)

    user.phone = normalized_phone
    if req.email:
        user.email = req.email.strip().lower()
    if req.name:
        user.full_name = req.name.strip()
    loc = dict(user.location or {})
    if req.lat is not None:
        loc["lat"] = float(req.lat)
    if req.lon is not None:
        loc["lon"] = float(req.lon)
    if req.pincode:
        loc["gps_pincode"] = req.pincode.strip()
    if req.city:
        loc["city"] = req.city.strip()
    if req.state:
        loc["state"] = req.state.strip()
    if loc:
        user.location = loc
    await db.commit()

    return {"success": True, "registered": phone_registry.count}


@api_router.get("/users/phone-count")
async def phone_count():
    return {"registered_phones": phone_registry.count}


@api_router.get("/sms/audit-log")
async def sms_audit_log(limit: int = 50):
    """Get SMS dispatch audit trail."""
    return {"logs": alert_dispatcher.get_sms_audit_log(limit)}


@api_router.get("/sms/status")
async def sms_status():
    """Check SMS service availability and thresholds."""
    return {
        "twilio_available": sms_service.is_available,
        "twilio_whatsapp_available": sms_service.is_whatsapp_available,
        "registered_phones": phone_registry.count,
        "thresholds": {
            "auto_notify": 0.70,
            "admin_review_high": 0.70,
            "admin_review_low": 0.45,
            "vision_auto_alert": 0.85,
            "vision_manual_review": 0.60,
        },
    }


# ══════════════════════════════════════════════════════════════
#  EVACUATION CENTERS
# ══════════════════════════════════════════════════════════════
@api_router.get("/evacuation-centers")
async def get_evacuation_centers(lat: float = None, lon: float = None):
    """Return known evacuation / relief centers."""
    # Static seed data – in production, this would come from DB
    centers = [
        {"id": "evac_1", "name": "District Hospital Shelter", "type": "hospital",
         "coordinates": {"lat": 28.6139, "lon": 77.2090}, "capacity": 500, "status": "open"},
        {"id": "evac_2", "name": "Community Relief Camp", "type": "relief_camp",
         "coordinates": {"lat": 28.6200, "lon": 77.2150}, "capacity": 300, "status": "open"},
        {"id": "evac_3", "name": "School Emergency Shelter", "type": "school",
         "coordinates": {"lat": 28.6100, "lon": 77.2000}, "capacity": 200, "status": "open"},
    ]
    return centers


# ══════════════════════════════════════════════════════════════
#  PUSH VAPID KEY
# ══════════════════════════════════════════════════════════════
@api_router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """Return the VAPID public key for push subscriptions."""
    from notifications import VAPID_PUBLIC_KEY
    return {"publicKey": VAPID_PUBLIC_KEY}


# ══════════════════════════════════════════════════════════════
#  GRID ZONE RISK + AR OVERLAY
# ══════════════════════════════════════════════════════════════
from grid_risk import grid_risk_service

@api_router.get("/grid/zone-risk")
async def get_zone_risk(lat: float, lon: float, radius_km: float = 10.0):
    """
    Main endpoint: GPS → 10km grid cells → risk states → AR overlay.
    Multiple users in the same area share grid state (credit-safe).
    """
    radius_km = min(radius_km, 50.0)  # Cap at 50km
    result = await grid_risk_service.get_zone_risk(lat, lon, radius_km)
    return result


@api_router.get("/grid/ar-overlay")
async def get_ar_overlay(lat: float, lon: float, radius_km: float = 10.0):
    """
    AR-specific endpoint: returns only the overlay payload.
    AR visualizes last validated state — never reasons.
    """
    radius_km = min(radius_km, 50.0)
    result = await grid_risk_service.get_zone_risk(lat, lon, radius_km)
    return result["ar_overlay"]


@api_router.post("/grid/refresh")
async def force_refresh_grid(lat: float, lon: float, radius_km: float = 10.0):
    """Force-refresh grid cells (admin/ingestion use)."""
    radius_km = min(radius_km, 50.0)
    await grid_risk_service.force_refresh(lat, lon, radius_km)
    return {"status": "refreshed", "lat": lat, "lon": lon, "radius_km": radius_km}


# ══════════════════════════════════════════════════════════════
#  UTILITY
# ══════════════════════════════════════════════════════════════
@api_router.get("/geo/reverse")
async def reverse_geocode(lat: float, lon: float):
    geolocator = Nominatim(user_agent="suraksha_setu_backend")
    try:
        location = geolocator.reverse((lat, lon), language='en')
        return {"address": location.address} if location else {"address": "Unknown"}
    except Exception as e:
        logger.error(f"Geocode Error: {e}")
        return {"address": "Unknown"}


# ══════════════════════════════════════════════════════════════
#  REGISTER ROUTERS
# ══════════════════════════════════════════════════════════════
app.include_router(ai_router)
app.include_router(api_router)
app.include_router(admin_router)

# Weather & AQI routes
from routes.weather import weather_router
app.include_router(weather_router)

# Risk & Anomaly Detection routes
from routes.risk import risk_router
app.include_router(risk_router)

# Community routes
from routes.community import community_router
app.include_router(community_router)

# Serve uploaded media files
from fastapi.staticfiles import StaticFiles
import pathlib as _pathlib
_uploads_dir = _pathlib.Path(os.getenv("UPLOAD_DIR", "./uploads"))
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

# Disasters routes
from routes.disasters import disasters_router
app.include_router(disasters_router)

# Location routes
from routes.location import location_router
app.include_router(location_router)

# Scientist routes
from routes.scientist import scientist_router
app.include_router(scientist_router)

# Include admin routes from routes/ if exists
try:
    from routes.admin import router as admin_routes_router
    app.include_router(admin_routes_router)
except ImportError:
    pass

# Profile routes
from routes.profile import profile_router
app.include_router(profile_router)


# ── Telegram Bot Webhook ──────────────────────────────────────────────────────

@app.post("/api/telegram/webhook", include_in_schema=False)
async def telegram_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Telegram Bot webhook endpoint.
    Receives updates from Telegram and handles /start <CODE> for account linking.
    Register this URL with BotFather: POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=<HOST>/api/telegram/webhook
    """
    try:
        from telegram_service import telegram_service
        from sqlalchemy import select
        from database import User
        import re

        update = await request.json()
        message = update.get("message", {})
        text = (message.get("text") or "").strip()
        chat = message.get("chat", {})
        chat_id = str(chat.get("id", ""))
        from_user = message.get("from", {})
        tg_username = from_user.get("username", "")

        # Handle /start <CODE> for account linking
        m = re.match(r"^/start\s+([A-Za-z0-9]+)$", text)
        if m and chat_id:
            code = m.group(1)
            # Find which user has this code: brute-force check all users who have
            # a pending link code by matching via verify_link_code
            result = await db.execute(select(User).where(User.is_active == True))
            users = result.scalars().all()
            matched_user = None
            for u in users:
                if telegram_service.verify_link_code(u.id, code):
                    matched_user = u
                    break

            if matched_user:
                matched_user.telegram_chat_id = chat_id
                if tg_username:
                    matched_user.telegram_username = tg_username
                await db.commit()
                await telegram_service.send_message(
                    chat_id,
                    "✅ <b>Suraksha Setu Connected!</b>\n\n"
                    "You will now receive disaster alerts for your location.\n\n"
                    "Stay safe! 🛡️",
                )
                logger.info(f"[Telegram] Linked chat_id={chat_id} to user={matched_user.id}")
            else:
                await telegram_service.send_message(
                    chat_id,
                    "❌ Invalid or expired link code.\n\n"
                    "Please generate a new code from your Suraksha Setu profile.",
                )
    except Exception as exc:
        logger.warning(f"[Telegram Webhook] Error: {exc}")
    # Always return 200 to Telegram
    return {"ok": True}



@app.get("/")
def read_root():
    return {
        "status": "Suraksha Setu API v3.0 Online",
        "ai_features": [
            "chat", "function_calling", "whisper", "vision",
            "embeddings", "rag", "tts", "agents",
        ],
        "modules": {
            "ai_orchestrator": "active",
            "risk_engine": "active",
            "playbook": "active",
            "notifications": "active",
            "vision_pipeline": "active",
            "voice_pipeline": "active",
            "rag_system": "active",
        },
    }


if __name__ == "__main__":
    import uvicorn
    import sys
    # Force UTF-8 output on Windows to handle emoji in logs
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    print("Starting Suraksha Setu Backend Server...")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
