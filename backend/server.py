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
import asyncio
import logging
import os
import io
import uuid
import json
import base64
from datetime import datetime, timezone
from dotenv import load_dotenv
from pydantic import BaseModel

# Core modules
from database import init_db, close_db, get_db, AsyncSessionLocal, AILog, Alert, AlertFeedback, ChatMessage, User
from notifications import ws_manager, push_manager
from risk_engine import RiskEngine
from playbook import playbook_engine
from utils.redis_client import redis_client
from utils.abuse_guard import enforce_rate_limit
from firebase_auth import verify_firebase_token, get_optional_user

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

# Geo utility
from geopy.geocoders import Nominatim

# Load Environment
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REDIS_TOKEN_KEY = "openai:total_tokens_used"


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _parse_training_locations() -> list:
    """
    Parse DATASET_TRAINING_LOCATIONS in format:
      City Name:lat:lon,Another City:lat:lon
    """
    defaults = [
        ("New Delhi", 28.6139, 77.2090),
        ("Mumbai", 19.0760, 72.8777),
        ("Kolkata", 22.5726, 88.3639),
        ("Chennai", 13.0827, 80.2707),
        ("Bengaluru", 12.9716, 77.5946),
    ]
    raw = os.getenv("DATASET_TRAINING_LOCATIONS", "").strip()
    if not raw:
        return defaults

    parsed = []
    for item in raw.split(","):
        parts = [p.strip() for p in item.split(":")]
        if len(parts) != 3:
            continue
        city, lat_s, lon_s = parts
        try:
            parsed.append((city, float(lat_s), float(lon_s)))
        except ValueError:
            continue

    return parsed or defaults


async def _run_periodic_alert_ingestion():
    """Run deterministic alert ingestion on a recurring interval."""
    if not _env_flag("ENABLE_BACKGROUND_ALERT_INGESTION", True):
        logger.info("Background alert ingestion is disabled")
        return

    interval = max(300, int(os.getenv("ALERT_INGEST_INTERVAL_SECONDS", "900")))
    startup_delay = max(5, int(os.getenv("ALERT_INGEST_STARTUP_DELAY_SECONDS", "15")))
    await asyncio.sleep(startup_delay)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                await IngestionManager.run_ingest_cycle(db)
            logger.info("Background alert ingestion cycle completed")
        except asyncio.CancelledError:
            logger.info("Background alert ingestion task stopped")
            raise
        except Exception as e:
            logger.warning("Background alert ingestion failed: %s", e)

        await asyncio.sleep(interval)


async def _run_periodic_dataset_collection():
    """Continuously collect weather/AQI/disaster records for training datasets."""
    if not _env_flag("ENABLE_BACKGROUND_DATASET_COLLECTION", True):
        logger.info("Background dataset collection is disabled")
        return

    interval = max(600, int(os.getenv("DATASET_INGEST_INTERVAL_SECONDS", "1800")))
    startup_delay = max(10, int(os.getenv("DATASET_INGEST_STARTUP_DELAY_SECONDS", "30")))
    locations = _parse_training_locations()
    await asyncio.sleep(startup_delay)

    while True:
        try:
            from routes.weather import _fetch_weather, _fetch_aqi
            from routes.disasters import (
                _fetch_usgs_earthquakes,
                _fetch_gdacs_disasters,
                _persist_disaster_training_rows,
            )

            for city, lat, lon in locations:
                weather_result, aqi_result = await asyncio.gather(
                    _fetch_weather(lat, lon, city=city),
                    _fetch_aqi(lat, lon, city=city),
                    return_exceptions=True,
                )
                if isinstance(weather_result, Exception):
                    logger.warning("Weather collection failed for %s: %s", city, weather_result)
                if isinstance(aqi_result, Exception):
                    logger.warning("AQI collection failed for %s: %s", city, aqi_result)

            quake_data, gdacs_data = await asyncio.gather(
                _fetch_usgs_earthquakes(),
                _fetch_gdacs_disasters(),
                return_exceptions=True,
            )

            disaster_rows = []
            if isinstance(quake_data, list):
                disaster_rows.extend(quake_data)
            elif isinstance(quake_data, Exception):
                logger.warning("USGS dataset collection failed: %s", quake_data)

            if isinstance(gdacs_data, list):
                disaster_rows.extend(gdacs_data)
            elif isinstance(gdacs_data, Exception):
                logger.warning("GDACS dataset collection failed: %s", gdacs_data)

            if disaster_rows:
                await _persist_disaster_training_rows(disaster_rows)

            logger.info(
                "Background dataset collection completed for %d cities (%d disaster rows)",
                len(locations),
                len(disaster_rows),
            )
        except asyncio.CancelledError:
            logger.info("Background dataset collection task stopped")
            raise
        except Exception as e:
            logger.warning("Background dataset collection failed: %s", e)

        await asyncio.sleep(interval)

# ──────────────────────────────────────────────────────────────
#  LIFESPAN
# ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Initializing Suraksha Setu v3.0...")

    await init_db()

    # Restore SMS phone registry from DB so auto-alert SMS survives restarts.
    try:
        from database import AsyncSessionLocal, User
        from sqlalchemy import select
        from sms_service import phone_registry, sms_service

        restored = 0
        async with AsyncSessionLocal() as _db:
            result = await _db.execute(
                select(User).where(User.is_active == True, User.phone.isnot(None))
            )
            users = result.scalars().all()

            for user in users:
                normalized_phone = sms_service._normalize_recipient_e164(user.phone or "")
                if not normalized_phone:
                    continue
                loc = user.location if isinstance(user.location, dict) else {}
                phone_registry.register(
                    uid=user.id,
                    phone=normalized_phone,
                    email=user.email or "",
                    name=user.full_name or user.username or "",
                    location={
                        "lat": loc.get("lat", loc.get("latitude")),
                        "lon": loc.get("lon", loc.get("longitude")),
                        "gps_pincode": loc.get("gps_pincode") or loc.get("home_pincode") or loc.get("pin_code"),
                        "city": loc.get("city"),
                        "state": loc.get("state"),
                    },
                )
                restored += 1

        logger.info("Restored %d SMS phone registration(s) from DB", restored)
    except Exception as _e:
        logger.warning("SMS phone registry restore failed: %s", _e)

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

    background_tasks = [
        asyncio.create_task(_run_periodic_alert_ingestion()),
        asyncio.create_task(_run_periodic_dataset_collection()),
    ]
    app.state.background_tasks = background_tasks

    logger.info("✅ Suraksha Setu Backend Online")
    yield

    for task in getattr(app.state, "background_tasks", []):
        task.cancel()
    if getattr(app.state, "background_tasks", None):
        await asyncio.gather(*app.state.background_tasks, return_exceptions=True)

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
    await enforce_rate_limit(
        request,
        bucket="ai_chat",
        limit=25,
        window_seconds=60,
        key_hint=str(data.get("user_id") or data.get("session_id") or ""),
    )

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
    response_text = result.get("message", "")
    session_id = data.get("session_id") or context.get("session_id") or f"session_{uuid.uuid4().hex[:12]}"
    client_user_id = data.get("user_id") or context.get("user_id")
    language = (locale or context.get("language") or context.get("locale") or "en")[:10]
    chat_entry_id = None
    chat_timestamp = datetime.now(timezone.utc)
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

            # Persist full chat exchange for historical retrieval and model training.
            resolved_user_id = None
            if client_user_id:
                existing_user = await db.get(User, client_user_id)
                if existing_user:
                    resolved_user_id = client_user_id

            chat_row = ChatMessage(
                id=str(uuid.uuid4()),
                user_id=resolved_user_id,
                session_id=session_id,
                message=message,
                response=response_text,
                language=language,
                context={
                    **context,
                    "role": role,
                    "client_user_id": client_user_id,
                    "providers": result.get("providers_used", []),
                },
                timestamp=chat_timestamp,
            )
            db.add(chat_row)
            chat_entry_id = chat_row.id

            await db.commit()
    except Exception as e:
        logger.warning(f"AI log write failed: {e}")

    # Reshape response for frontend widgets
    return {
        "id": chat_entry_id,
        "session_id": session_id,
        "timestamp": chat_timestamp.isoformat(),
        "success": result.get("success", True),
        "response": response_text,
        "answer": response_text,
        "role": role,
        "confidence": result.get("confidence", 0.65),
        "token_cost": result.get("token_cost", 0),
        "sources": result.get("sources", []),
        "cached": result.get("cached", False),
        "quiz": result.get("quiz"),
        "tool_calls_executed": result.get("tool_calls_executed", []),
        "usage": usage,
    }


@ai_router.get("/history")
async def ai_history(session_id: str, limit: int = 100):
    """Get persisted chat history for a client session."""
    limit = min(max(limit, 1), 200)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.timestamp.asc())
            .limit(limit)
        )
        rows = result.scalars().all()

    return {
        "session_id": session_id,
        "messages": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "session_id": r.session_id,
                "message": r.message,
                "response": r.response,
                "language": r.language,
                "context": r.context,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ],
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

    if result.get("error") and not result.get("analysis"):
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

ALERT_FEEDBACK_VERDICTS = {"accurate", "false_alarm", "outdated", "duplicate"}


class AlertFeedbackRequest(BaseModel):
    verdict: str
    note: str | None = None
    confidence: int | None = None
    user_id: str | None = None


def _build_feedback_summary(counts: dict[str, int]) -> dict:
    normalized = {key: int(counts.get(key, 0)) for key in ALERT_FEEDBACK_VERDICTS}
    total = sum(normalized.values())
    trust_score = round((normalized.get("accurate", 0) / total) * 100, 1) if total else None
    return {
        "total": total,
        "trust_score": trust_score,
        "counts": normalized,
    }


@api_router.get("/alerts")
async def get_alerts(
    lat=None,
    lon=None,
    radius_km: float = 100.0,
    severity=None,
    report_type=None,
    limit: int = 1000,
    db: AsyncSession = Depends(get_db),
):
    """Get active alerts with optional geo-filtering."""
    limit = max(1, min(int(limit or 200), 5000))
    query = select(Alert).where(Alert.is_active == True, Alert.retracted == False)
    if severity:
        query = query.where(func.lower(Alert.severity) == severity.lower())
    if report_type:
        query = query.where(func.lower(Alert.alert_type) == report_type.lower())

    result = await db.execute(query.order_by(Alert.created_at.desc()).limit(limit))
    alerts = result.scalars().all()

    feedback_by_alert: dict[str, dict[str, int]] = {}
    if alerts:
        alert_ids = [a.id for a in alerts]
        feedback_result = await db.execute(
            select(
                AlertFeedback.alert_id,
                AlertFeedback.verdict,
                func.count(AlertFeedback.id),
            )
            .where(AlertFeedback.alert_id.in_(alert_ids))
            .group_by(AlertFeedback.alert_id, AlertFeedback.verdict)
        )
        for alert_id, verdict, votes in feedback_result.all():
            feedback_by_alert.setdefault(alert_id, {})[verdict] = int(votes or 0)

    query_lat = float(lat) if lat is not None else None
    query_lon = float(lon) if lon is not None else None
    geo_filter = query_lat is not None and query_lon is not None
    payload = []
    for a in alerts:
        location_data = a.location if isinstance(a.location, dict) else {}
        if not location_data and isinstance(a.location, str):
            location_data = {"name": a.location}

        alert_lat = location_data.get("lat")
        alert_lon = location_data.get("lon")
        distance_km = None
        if geo_filter and alert_lat is not None and alert_lon is not None:
            try:
                from utils.spatial_query import haversine_distance
                lat_val = query_lat if query_lat is not None else 0.0
                lon_val = query_lon if query_lon is not None else 0.0
                distance_km = round(
                    haversine_distance(lat_val, lon_val, float(alert_lat), float(alert_lon)),
                    2,
                )
            except Exception:
                distance_km = None

        if geo_filter and distance_km is not None and distance_km > radius_km:
            continue

        location_label = (
            location_data.get("city")
            or location_data.get("name")
            or location_data.get("state")
            or (a.location if isinstance(a.location, str) else "Unknown Location")
        )
        created_at = a.created_at.isoformat() if a.created_at else None
        feedback_summary = _build_feedback_summary(feedback_by_alert.get(a.id, {}))

        payload.append(
            {
                "id": a.id,
                "type": a.alert_type,
                "report_type": a.alert_type,
                "alert_type": a.alert_type,
                "severity": a.severity,
                "title": a.title,
                "description": a.description,
                "message": a.description,
                "location": location_label,
                "location_data": location_data,
                "coordinates": {
                    "lat": alert_lat,
                    "lon": alert_lon,
                },
                "distance_km": distance_km,
                "source": a.source,
                "created_at": created_at,
                "timestamp": created_at,
                "feedback": feedback_summary,
                "trust_score": feedback_summary.get("trust_score"),
            }
        )

    return {
        "alerts": payload,
        "count": len(payload),
    }


@api_router.get("/alerts/{alert_id}/feedback")
async def get_alert_feedback(alert_id: str, db: AsyncSession = Depends(get_db)):
    """Return trust feedback summary and recent votes for an alert."""
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    summary_rows = await db.execute(
        select(AlertFeedback.verdict, func.count(AlertFeedback.id))
        .where(AlertFeedback.alert_id == alert_id)
        .group_by(AlertFeedback.verdict)
    )
    counts: dict[str, int] = {}
    for verdict, votes in summary_rows.all():
        counts[verdict] = int(votes or 0)

    recent_rows = await db.execute(
        select(AlertFeedback)
        .where(AlertFeedback.alert_id == alert_id)
        .order_by(AlertFeedback.created_at.desc())
        .limit(20)
    )
    recent_feedback = recent_rows.scalars().all()

    return {
        "alert_id": alert_id,
        **_build_feedback_summary(counts),
        "recent_feedback": [
            {
                "id": row.id,
                "user_id": row.user_id,
                "verdict": row.verdict,
                "confidence": row.confidence,
                "note": row.note,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in recent_feedback
        ],
    }


@api_router.post("/alerts/{alert_id}/feedback")
async def submit_alert_feedback(
    alert_id: str,
    body: AlertFeedbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict | None = Depends(get_optional_user),
):
    """Store or update user feedback about alert quality and accuracy."""
    await enforce_rate_limit(
        request,
        bucket="alert_feedback",
        limit=12,
        window_seconds=60,
        key_hint=(_user or {}).get("uid") if _user else body.user_id,
    )

    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    verdict = (body.verdict or "").strip().lower()
    if verdict not in ALERT_FEEDBACK_VERDICTS:
        raise HTTPException(
            status_code=422,
            detail=f"verdict must be one of: {sorted(ALERT_FEEDBACK_VERDICTS)}",
        )

    confidence = body.confidence
    if confidence is not None:
        confidence = max(0, min(100, int(confidence)))

    note = (body.note or "").strip()
    if len(note) > 500:
        note = note[:500]

    user_id = (_user or {}).get("uid") or (body.user_id or "").strip() or None
    existing = None
    if user_id:
        existing_result = await db.execute(
            select(AlertFeedback).where(
                AlertFeedback.alert_id == alert_id,
                AlertFeedback.user_id == user_id,
            )
        )
        existing = existing_result.scalar_one_or_none()

    if existing:
        existing.verdict = verdict
        existing.confidence = confidence
        existing.note = note or None
        feedback_row = existing
    else:
        feedback_row = AlertFeedback(
            id=str(uuid.uuid4()),
            alert_id=alert_id,
            user_id=user_id,
            verdict=verdict,
            confidence=confidence,
            note=note or None,
        )
        db.add(feedback_row)

    await db.commit()

    summary_rows = await db.execute(
        select(AlertFeedback.verdict, func.count(AlertFeedback.id))
        .where(AlertFeedback.alert_id == alert_id)
        .group_by(AlertFeedback.verdict)
    )
    counts: dict[str, int] = {}
    for row_verdict, votes in summary_rows.all():
        counts[row_verdict] = int(votes or 0)

    return {
        "success": True,
        "alert_id": alert_id,
        "feedback": {
            "id": feedback_row.id,
            "user_id": feedback_row.user_id,
            "verdict": feedback_row.verdict,
            "confidence": feedback_row.confidence,
            "note": feedback_row.note,
        },
        "summary": _build_feedback_summary(counts),
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
                                    "type": a.alert_type,
                                    "severity": a.severity,
                                    "title": a.title,
                                    "description": a.description,
                                    "location": a.location,
                                    "coordinates": {
                                        "lat": (a.location or {}).get("lat") if isinstance(a.location, dict) else None,
                                        "lon": (a.location or {}).get("lon") if isinstance(a.location, dict) else None,
                                    },
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
                elif msg_type == "subscribe_user":
                    user_id = str(message.get("user_id") or "").strip()
                    if user_id:
                        ws_manager.subscribe_user(client_id, user_id)
                        await ws_manager.send_personal_message(
                            {
                                "type": "user_subscribed",
                                "status": "ok",
                                "user_id": user_id,
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
_ADMIN_ROLES = {"admin", "developer"}


def _admin_role_from_token(token: dict) -> str:
    claims = token.get("firebase_claims") or {}
    return (
        claims.get("role")
        or claims.get("user_type")
        or token.get("role")
        or ""
    ).strip().lower()


async def require_admin_access(
    token: dict = Depends(verify_firebase_token),
    db: AsyncSession = Depends(get_db),
):
    """Authorize admin routes via Firebase claims or local DB role fallback."""
    token_role = _admin_role_from_token(token)
    if token_role in _ADMIN_ROLES:
        return token

    uid = token.get("uid")
    if uid:
        db_user = await db.get(User, uid)
        db_role = (db_user.user_type or "").strip().lower() if db_user else ""
        if db_user and db_user.is_active and db_role in _ADMIN_ROLES:
            return token

    raise HTTPException(status_code=403, detail="Admin access required")


admin_router = APIRouter(
    prefix="/admin",
    tags=["Admin"],
    dependencies=[Depends(require_admin_access)],
)


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

class PhoneRegistrationRequest(BaseModel):
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

    normalized_phone = sms_service._normalize_recipient_e164(req.phone)
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Invalid phone number")
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

# Telegram Mini App routes
from routes.telegram import telegram_router
app.include_router(telegram_router)


# ── Telegram Bot Webhook ──────────────────────────────────────────────────────
# Production webhook setup docs at: docs/TELEGRAM_WEBHOOK_SETUP.md
# Webhook endpoint handles: auto-linking buttons, manual codes, callback queries

@app.post("/api/telegram/webhook", include_in_schema=False)
async def telegram_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Telegram Bot webhook endpoint (production-ready).
    
    Handles:
    1. /start <CODE> — Manual linking with code
    2. /start — Auto-linking button flow
    3. Callback queries — Button click responses (approve/cancel linking)
    4. Webhook secret verification (if configured)
    
    Security:
    - Verifies X-Telegram-Bot-Api-Secret-Token header (if TELEGRAM_WEBHOOK_SECRET set)
    - Returns 200 OK to Telegram within 25 seconds
    - Processes all message types, returns early if not relevant
    
    Register webhook with BotFather:
    POST https://api.telegram.org/bot<TOKEN>/setWebhook
      ?url=https://your-domain.com/api/telegram/webhook
      &secret_token=<RANDOM_SECRET>
    """
    try:
        from telegram_service import telegram_service
        from sqlalchemy import select
        from database import User
        import re
        import json

        # 1. Optional: Verify webhook secret header
        secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
        if not telegram_service.verify_webhook_secret(secret_token):
            logger.warning("[Telegram Webhook] Invalid secret token")
            return {"ok": True}  # Still return 200 but don't process

        update = await request.json()
        update_id = update.get("update_id", 0)

        # ── Handle /start command with code or auto-link request ──────────────
        
        message = update.get("message", {})
        if message:
            text = (message.get("text") or "").strip()
            chat = message.get("chat", {})
            chat_id = str(chat.get("id", ""))
            from_user = message.get("from", {})
            tg_username = from_user.get("username", "")

            # Check for /start <CODE> (manual code-based linking)
            code_match = re.match(r"^/start\s+([A-Za-z0-9]+)$", text)
            if code_match and chat_id:
                code = code_match.group(1)
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
                        "Your Telegram account is now linked.\n"
                        "You'll receive disaster alerts for your location.\n\n"
                        "Stay safe! 🛡️",
                    )
                    logger.info(f"[Telegram] Linked chat_id={chat_id} to user={matched_user.id} via code")
                else:
                    await telegram_service.send_message(
                        chat_id,
                        "❌ Invalid or expired link code.\n\n"
                        "Please generate a new code from your Suraksha Setu profile.\n"
                        "Or click 'Enable Alerts' to auto-link now!",
                    )
                return {"ok": True}

            # Check for plain /start (show auto-link buttons)
            if text == "/start" and chat_id:
                await telegram_service.start_auto_linking(chat_id, tg_username)
                logger.info(f"[Telegram] Started auto-linking for chat_id={chat_id}")
                return {"ok": True}

        # ── Handle callback query (button clicks) ─────────────────────────────
        
        callback_query = update.get("callback_query", {})
        if callback_query:
            callback_id = callback_query.get("id")
            from_user = callback_query.get("from", {})
            chat_id = str(from_user.get("id", ""))
            tg_username = from_user.get("username", "")
            message = callback_query.get("message", {})
            message_id = message.get("message_id")
            callback_data = callback_query.get("data", "")

            logger.info(f"[Telegram] Callback: {callback_data} from chat_id={chat_id}")

            # Auto-linking approval
            if callback_data == "auto_link:approve" and chat_id:
                # Try to find user by Telegram username first
                result = await db.execute(
                    select(User).where(User.telegram_username == tg_username)
                )
                user = result.scalar_one_or_none()

                if user:
                    # User exists and matches Telegram username
                    user.telegram_chat_id = chat_id
                    if tg_username:
                        user.telegram_username = tg_username
                    await db.commit()
                    
                    await telegram_service.answer_callback_query(
                        callback_id,
                        "✅ Linked successfully!",
                        show_alert=False
                    )
                    
                    await telegram_service.send_message(
                        chat_id,
                        "✅ <b>Suraksha Setu Connected!</b>\n\n"
                        "Your account is linked and active.\n"
                        "Disaster alerts for your location will now be sent here.\n\n"
                        "🔔 Enable notifications to never miss an alert!\n"
                        "Stay safe! 🛡️",
                    )
                    logger.info(f"[Telegram] Auto-linked chat_id={chat_id} to user={user.id}")
                else:
                    # No user found, show instructions
                    await telegram_service.answer_callback_query(
                        callback_id,
                        "To auto-link, first create a Suraksha Setu account with this Telegram username!",
                        show_alert=True
                    )
                    logger.info(f"[Telegram] No user found for telegram_username={tg_username}")

            # Auto-linking cancellation
            elif callback_data == "auto_link:cancel" and chat_id:
                await telegram_service.answer_callback_query(
                    callback_id,
                    "Cancelled. You can always link later from the app profile.",
                    show_alert=False
                )
                logger.info(f"[Telegram] User cancelled auto-linking: chat_id={chat_id}")

            return {"ok": True}

    except Exception as exc:
        logger.warning(f"[Telegram Webhook] Error processing update: {exc}", exc_info=True)
    
    # Always return 200 OK to Telegram (acknowledgement, not response)
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
