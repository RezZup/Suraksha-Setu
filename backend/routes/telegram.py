"""
Telegram Mini App Integration Routes
─────────────────────────────────────
Handles automatic Chat ID registration when users launch the Telegram Mini App.

Endpoints:
  POST /api/telegram/mini-app/register  — Auto-register user from Mini App init data
  GET  /api/telegram/mini-app/chat-id   — Get current user's registered Chat ID

Flow:
  1. User opens @settu9856bot in Telegram
  2. Clicks "Enable Disaster Alerts" button (opens Mini App)
  3. Mini App calls POST /api/telegram/mini-app/register with initData
  4. Backend verifies signature, extracts Chat ID, auto-registers user
  5. User authenticated and Chat ID saved — zero manual steps!
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db, User
from firebase_auth import verify_firebase_token
from telegram_service import telegram_service

logger = logging.getLogger(__name__)

telegram_router = APIRouter(prefix="/api/telegram", tags=["Telegram"])


# ── Request / Response models ─────────────────────────────────────────────────

class MiniAppRegisterRequest(BaseModel):
    """Telegram Mini App initialization data"""
    init_data: str  # Raw initData from window.Telegram.WebApp.initData
    firebase_token: Optional[str] = None  # Firebase auth token (optional)


class MiniAppRegisterResponse(BaseModel):
    """Response after Mini App registration"""
    success: bool
    message: str
    chat_id: Optional[str] = None
    user_id: Optional[str] = None
    telegram_username: Optional[str] = None


class ChatIDResponse(BaseModel):
    """Current user's registered Chat ID"""
    chat_id: Optional[str] = None
    telegram_username: Optional[str] = None
    registered: bool


# ── Mini App Routes ───────────────────────────────────────────────────────────

@telegram_router.post(
    "/mini-app/register",
    response_model=MiniAppRegisterResponse,
    summary="Auto-register user from Telegram Mini App"
)
async def register_from_mini_app(
    request: MiniAppRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Register/update user Chat ID from Telegram Mini App.
    
    The Telegram Mini App launches and passes initData containing:
    - user.id (Telegram user ID)
    - user.username
    - user.first_name, last_name
    - hash (HMAC-SHA256 signature)
    
    We validate the hash, extract user info, and automatically register them.
    
    This eliminates the need for manual Chat ID entry!
    """
    
    # Validate Mini App data using Telegram's signature
    mini_app_data = telegram_service.validate_mini_app_data(request.init_data)
    
    if not mini_app_data:
        logger.warning("Invalid Mini App data received")
        raise HTTPException(
            status_code=401,
            detail="Invalid Telegram Mini App data. Signature verification failed."
        )
    
    chat_id = mini_app_data.get("chat_id")
    telegram_id = mini_app_data.get("user_id")
    telegram_username = mini_app_data.get("telegram_username") or mini_app_data.get("first_name", "")
    
    if not chat_id:
        raise HTTPException(
            status_code=400,
            detail="Could not extract Chat ID from Mini App data"
        )
    
    try:
        # If user has Firebase token, get their user_id
        firebase_user_id = None
        if request.firebase_token:
            try:
                claims = await verify_firebase_token(request.firebase_token)
                firebase_user_id = claims.get("uid")
            except Exception as e:
                logger.warning("Firebase token verification failed: %s", e)
        
        # Try to find existing user by Telegram ID first
        if telegram_id:
            result = await db.execute(
                select(User).where(User.telegram_chat_id == chat_id)
            )
            user = result.scalars().first()
        else:
            user = None
        
        # If no user found by Telegram ID, try Firebase ID
        if not user and firebase_user_id:
            result = await db.execute(
                select(User).where(User.id == firebase_user_id)
            )
            user = result.scalars().first()
        
        if user:
            # Update existing user's Chat ID and username
            user.telegram_chat_id = chat_id
            if telegram_username and not user.telegram_username:
                user.telegram_username = telegram_username
            
            logger.info("✅ Updated Chat ID for user %s: %s", user.id, chat_id)
            message = "Chat ID updated successfully"
        else:
            # User doesn't exist in our system yet
            # This is expected - they may be registering via Mini App first
            logger.info("ℹ️  Mini App user Chat ID %s (username: %s) — awaiting app registration", 
                       chat_id, telegram_username)
            message = "Telegram Chat ID registered. Please complete profile setup in the app."
            
            # Optionally create a minimal user record if you want to track them
            # Otherwise, just return success and they'll be created on first login
        
        await db.commit()
        
        return MiniAppRegisterResponse(
            success=True,
            message=message,
            chat_id=chat_id,
            user_id=firebase_user_id,
            telegram_username=telegram_username
        )
    
    except Exception as e:
        logger.error("Mini App registration error: %s", e)
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Registration failed: {str(e)}"
        )


@telegram_router.get(
    "/mini-app/chat-id",
    response_model=ChatIDResponse,
    summary="Get current user's registered Chat ID"
)
async def get_user_chat_id(
    firebase_token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the current authenticated user's registered Telegram Chat ID.
    Requires Firebase authentication.
    """
    
    try:
        claims = await verify_firebase_token(firebase_token)
        user_id = claims.get("uid")
    except Exception as e:
        logger.warning("Firebase token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalars().first()
    
    if not user:
        return ChatIDResponse(
            chat_id=None,
            telegram_username=None,
            registered=False
        )
    
    has_chat_id = bool(user.telegram_chat_id)
    
    return ChatIDResponse(
        chat_id=user.telegram_chat_id if has_chat_id else None,
        telegram_username=user.telegram_username,
        registered=has_chat_id
    )
