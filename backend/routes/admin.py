"""
Admin API Routes for Alert Management, Users & Stats
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from database import get_db, Alert, IncidentLog, User, CommunityReport, CommunityPost, AILog, UserReport
from notifications import ws_manager
from sqlalchemy import select, func
import logging
import uuid
from datetime import datetime, timezone, timedelta
from firebase_auth import verify_firebase_token

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
            "registered_phones": registered_phones,
            "incidents": incidents,
            "ai_calls_today": ai_calls_today,
            "system_status": "operational",
        }
    except Exception as e:
        logger.error(f"Stats error: {e}")
        return {
            "active_alerts": 0, "pending_alerts": 0, "total_alerts": 0,
            "total_users": 0, "active_users": 0, "total_posts": 0,
            "pending_reports": 0, "registered_phones": 0, "incidents": 0,
            "ai_calls_today": 0, "system_status": "operational",
        }


# ==================== USER MANAGEMENT ====================

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
