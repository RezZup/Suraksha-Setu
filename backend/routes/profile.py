"""
User Profile API Routes
────────────────────────
GET  /api/profile/{user_id}          — fetch profile
PUT  /api/profile/{user_id}          — update profile fields
POST /api/profile/{user_id}/avatar   — upload avatar image
GET  /api/profile/{user_id}/telegram-link — get Telegram link code & instructions
POST /api/profile/telegram/verify    — verify link code and pair chat_id
POST /api/profile/{user_id}/test-email  — send test email to verify SMTP
"""
import uuid
import os
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db, User
from firebase_auth import verify_firebase_token

logger = logging.getLogger(__name__)

profile_router = APIRouter(prefix="/api/profile", tags=["Profile"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
ALLOWED_IMG_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_AVATAR_SIZE_MB = 5


# ── Request / Response models ─────────────────────────────────────────────────

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None
    phone: Optional[str] = None
    notification_email: Optional[str] = None
    telegram_username: Optional[str] = None
    notification_radius_km: Optional[float] = None
    notification_channels: Optional[dict] = None   # {"telegram": bool, "email": bool}
    preferences: Optional[dict] = None
    # Firebase-sourced fields sent from frontend on first sync
    firebase_display_name: Optional[str] = None
    firebase_email: Optional[str] = None
    firebase_photo_url: Optional[str] = None
    firebase_role: Optional[str] = None
    # Custom avatar (DiceBear URL or uploaded URL)
    avatar_url: Optional[str] = None
    # Pincode fields — stored inside user.location JSON
    home_pincode: Optional[str] = None   # user-set home PIN
    gps_pincode: Optional[str] = None    # auto-detected from GPS on app open
    gps_city: Optional[str] = None
    gps_state: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None


class TelegramVerifyRequest(BaseModel):
    user_id: str
    code: str
    telegram_chat_id: str
    telegram_username: Optional[str] = None


class TelegramLinkChatIdRequest(BaseModel):
    """Request to directly link a Telegram Chat ID without verification code."""
    chat_id: str  # Numeric Telegram Chat ID (e.g., "123456789")
    firebase_token: str  # Firebase token for user verification


# ── Helpers ───────────────────────────────────────────────────────────────────

def _profile_dict(user: User) -> dict:
    loc = user.location or {}
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "bio": getattr(user, "bio", None),
        "phone": getattr(user, "phone", None),
        "notification_email": getattr(user, "notification_email", None),
        "telegram_username": getattr(user, "telegram_username", None),
        "telegram_linked": bool(getattr(user, "telegram_chat_id", None)),
        "avatar_url": getattr(user, "avatar_url", None),
        "notification_radius_km": getattr(user, "notification_radius_km", 50),
        "notification_channels": getattr(user, "notification_channels", None) or {"telegram": True, "email": True},
        "user_type": user.user_type,
        "is_active": user.is_active,
        "location": loc,
        "preferences": user.preferences,
        "created_at": str(user.created_at) if user.created_at else None,
        # Pincode fields surfaced for frontend convenience
        "home_pincode": loc.get("home_pincode", ""),
        "gps_pincode": loc.get("gps_pincode", ""),
        "gps_city": loc.get("city", ""),
        "gps_state": loc.get("state", ""),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@profile_router.get("/{user_id}")
async def get_profile(user_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch a user's profile. Returns empty defaults if user not in DB yet."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        # User exists in Firebase but not yet in our DB — return empty defaults
        return {
            "success": True,
            "exists": False,
            "profile": {
                "id": user_id,
                "email": "",
                "username": "",
                "full_name": "",
                "bio": None,
                "phone": None,
                "notification_email": None,
                "telegram_username": None,
                "telegram_linked": False,
                "avatar_url": None,
                "notification_radius_km": 50,
                "notification_channels": {"telegram": True, "email": True},
                "user_type": "citizen",
                "is_active": True,
                "location": None,
                "preferences": None,
                "created_at": None,
            },
        }
    return {"success": True, "exists": True, "profile": _profile_dict(user)}


@profile_router.put("/{user_id}")
async def update_profile(
    user_id: str,
    body: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_firebase_token),
):
    """Update profile fields. Upserts user row if not yet in DB. Requires auth."""
    # Only allow editing own profile (unless admin / developer)
    token_uid = _token.get("uid", "")
    token_role = _token.get("role", "citizen")
    if token_uid != user_id and token_role not in ("admin", "developer"):
        raise HTTPException(status_code=403, detail="Cannot edit another user's profile")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        # Create a minimal user row for this Firebase user
        fb_email = (body.firebase_email or "").strip().lower()
        fb_name = (body.firebase_display_name or "").strip()
        fb_role = body.firebase_role or "citizen"
        username = fb_email.split("@")[0] if fb_email else user_id[:16]
        # Ensure username uniqueness
        dup = await db.execute(select(User).where(User.username == username))
        if dup.scalar_one_or_none():
            username = f"{username}_{user_id[:6]}"
        user = User(
            id=user_id,
            email=fb_email or f"{user_id}@firebase.local",
            username=username,
            password_hash="firebase_auth",
            full_name=fb_name or username,
            user_type=fb_role if fb_role in ("citizen", "student", "scientist", "admin") else "citizen",
            is_active=True,
        )
        if body.firebase_photo_url:
            user.avatar_url = body.firebase_photo_url
        db.add(user)
        logger.info("[Profile] Created DB row for Firebase user %s", user_id)

    # Apply updates
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.bio is not None:
        user.bio = body.bio[:500]
    if body.phone is not None:
        user.phone = body.phone.strip() or None
    if body.notification_email is not None:
        user.notification_email = body.notification_email.strip().lower() or None
    if body.telegram_username is not None:
        tg = body.telegram_username.strip().lstrip("@")
        user.telegram_username = tg or None
    if body.notification_radius_km is not None:
        # Clamp between 5 and 500 km
        user.notification_radius_km = max(5.0, min(500.0, body.notification_radius_km))
    if body.notification_channels is not None:
        user.notification_channels = body.notification_channels
    if body.preferences is not None:
        user.preferences = {**(user.preferences or {}), **body.preferences}
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url

    # ── Pincode / GPS location updates ──────────────────────────────────────
    if any([
        body.home_pincode is not None,
        body.gps_pincode is not None,
        body.gps_lat is not None,
    ]):
        loc = dict(user.location or {})
        if body.home_pincode is not None:
            hp = body.home_pincode.strip()
            if hp and (hp.isdigit() and len(hp) == 6):
                loc["home_pincode"] = hp
            elif hp == "":
                loc.pop("home_pincode", None)
        if body.gps_pincode is not None:
            loc["gps_pincode"] = body.gps_pincode.strip()
        if body.gps_city is not None:
            loc["city"] = body.gps_city
        if body.gps_state is not None:
            loc["state"] = body.gps_state
        if body.gps_lat is not None:
            loc["lat"] = body.gps_lat
        if body.gps_lon is not None:
            loc["lon"] = body.gps_lon
        user.location = loc

    await db.commit()
    await db.refresh(user)
    return {"success": True, "profile": _profile_dict(user)}


@profile_router.post("/{user_id}/avatar")
async def upload_avatar(
    user_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_firebase_token),
):
    """Upload a profile avatar image. Returns the URL."""
    if file.content_type not in ALLOWED_IMG_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP or GIF avatars accepted")

    data = await file.read()
    if len(data) > MAX_AVATAR_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Avatar must be under {MAX_AVATAR_SIZE_MB}MB")

    ext = file.content_type.split("/")[-1].replace("jpeg", "jpg")
    filename = f"avatar_{user_id}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(data)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    backend_url = os.getenv("REACT_APP_BACKEND_URL", "http://localhost:8000")
    avatar_url = f"{backend_url}/uploads/{filename}"
    user.avatar_url = avatar_url
    await db.commit()

    return {"success": True, "avatar_url": avatar_url}


@profile_router.get("/{user_id}/telegram-link")
async def get_telegram_link(user_id: str, db: AsyncSession = Depends(get_db)):
    """Generate a Telegram link code for the given user."""
    from telegram_service import telegram_service

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not telegram_service.enabled:
        return {"success": False, "error": "Telegram bot not configured on server"}

    link_info = telegram_service.get_link_instructions(user_id)
    return {
        "success": True,
        "already_linked": bool(getattr(user, "telegram_chat_id", None)),
        **link_info,
    }


@profile_router.post("/telegram/verify")
async def verify_telegram_link(body: TelegramVerifyRequest, db: AsyncSession = Depends(get_db)):
    """
    Called by the Telegram bot webhook (or frontend after user confirms).
    Validates the code and stores the chat_id.
    """
    from telegram_service import telegram_service

    if not telegram_service.verify_link_code(body.user_id, body.code):
        raise HTTPException(status_code=400, detail="Invalid or expired link code")

    result = await db.execute(select(User).where(User.id == body.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.telegram_chat_id = str(body.telegram_chat_id)
    if body.telegram_username:
        user.telegram_username = body.telegram_username.lstrip("@")
    await db.commit()

    # Send confirmation to the user
    await telegram_service.send_message(
        str(body.telegram_chat_id),
        "✅ <b>Suraksha Setu Connected!</b>\n\n"
        "You will now receive disaster alerts for your location via Telegram.\n\n"
        "Stay safe! 🛡️",
    )

    return {"success": True, "message": "Telegram account linked successfully"}


@profile_router.post("/telegram/link-chat-id")
async def link_telegram_chat_id(
    body: TelegramLinkChatIdRequest,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_firebase_token),
):
    """
    Direct Chat ID linking endpoint.
    User provides their Telegram Chat ID (from @getidsbot) and firebase token.
    Automatically links the Chat ID to their account.
    
    Flow:
    1. User opens @getidsbot in Telegram
    2. Gets their numeric Chat ID (e.g., 123456789)
    3. Pastes it in frontend form
    4. Frontend calls this endpoint with chat_id + firebase_token
    5. Backend verifies token, saves chat_id, sends confirmation
    """
    from telegram_service import telegram_service

    # Get user ID from Firebase token
    user_id = _token.get("uid", "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")

    # Validate chat_id format (must be numeric)
    if not body.chat_id.strip().isdigit():
        raise HTTPException(
            status_code=400,
            detail="Chat ID must contain only numbers (e.g., 123456789)"
        )

    chat_id = body.chat_id.strip()

    # Find or create user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        # Create minimal user record if doesn't exist
        user = User(
            id=user_id,
            email=_token.get("email", ""),
            username=_token.get("name", f"user_{user_id[:8]}"),
            user_type="citizen",
        )
        db.add(user)

    # Save the Chat ID
    user.telegram_chat_id = chat_id

    await db.commit()
    await db.refresh(user)

    # Send confirmation message to user's Telegram
    try:
        await telegram_service.send_message(
            chat_id,
            "✅ <b>Suraksha Setu Connected!</b>\n\n"
            "Your Telegram account is now linked to Suraksha Setu.\n\n"
            "You will receive disaster alerts for your location.\n\n"
            "Stay safe! 🛡️",
        )
    except Exception as e:
        logger.warning(f"Could not send confirmation to Chat ID {chat_id}: {e}")
        # Don't fail the request if we can't send the message
        pass

    return {
        "success": True,
        "chat_id": chat_id,
        "message": "Telegram Chat ID linked successfully!"
    }


@profile_router.delete("/{user_id}/telegram-unlink")
async def unlink_telegram(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_firebase_token),
):
    """Remove Telegram link from a user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.telegram_chat_id = None
    await db.commit()
    return {"success": True, "message": "Telegram unlinked"}


@profile_router.post("/{user_id}/test-email")
async def send_test_email(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    _token: dict = Depends(verify_firebase_token),
):
    """Send a test email to the user's configured notification_email."""
    from email_service import email_service

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    to_email = getattr(user, "notification_email", None)
    if not to_email:
        raise HTTPException(status_code=400, detail="No notification email configured. Set it in your profile first.")

    ok = await email_service.send_test_email(to_email, user.full_name or user.username or "")
    if not ok:
        raise HTTPException(status_code=503, detail="Email service unavailable. Check server SMTP configuration.")

    return {"success": True, "message": f"Test email sent to {to_email}"}
