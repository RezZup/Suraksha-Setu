"""
Community API Routes — fully database-backed with persistent storage
"""
from fastapi import APIRouter, HTTPException, Query, Depends, UploadFile, File, Form, Request
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
import uuid
import logging
import os
import pathlib
from datetime import datetime, timezone

from database import get_db, CommunityPost, Comment, DirectMessage, Notification, UserReport, User
from firebase_auth import verify_firebase_token, get_optional_user
from sms_service import sms_service, phone_registry
from utils.abuse_guard import enforce_rate_limit

logger = logging.getLogger(__name__)

community_router = APIRouter(prefix="/api/community", tags=["Community"])

# ─── Badge tiers ───────────────────────────────────────────────────────────────
def _compute_badge(helpful_posts: int) -> dict:
    """Return badge info based on number of helpful (help/offer/emergency/alert) posts."""
    if helpful_posts >= 50:
        return {"name": "Guardian", "emoji": "🌟", "color": "purple", "tier": 5}
    if helpful_posts >= 20:
        return {"name": "Saviour", "emoji": "🛡️", "color": "indigo", "tier": 4}
    if helpful_posts >= 10:
        return {"name": "Hero", "emoji": "🦸", "color": "blue", "tier": 3}
    if helpful_posts >= 5:
        return {"name": "Responder", "emoji": "🤝", "color": "green", "tier": 2}
    if helpful_posts >= 1:
        return {"name": "Helper", "emoji": "💚", "color": "teal", "tier": 1}
    return {"name": "Newcomer", "emoji": "🌱", "color": "gray", "tier": 0}

# Allowed upload types
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


class CreatePostRequest(BaseModel):
    content: str
    title: Optional[str] = None
    type: str = "general"
    location: Optional[str] = ""
    tags: Optional[List[str]] = []
    media: Optional[list] = []
    author: Optional[str] = "Anonymous"
    author_photo: Optional[str] = None
    user_id: Optional[str] = "anonymous"
    lat: Optional[float] = None
    lon: Optional[float] = None
    pincode: Optional[str] = None
    image_analysis: Optional[dict] = None


class CreateCommentRequest(BaseModel):
    content: str
    parent_id: Optional[str] = None
    author: Optional[str] = "You"
    author_id: Optional[str] = None   # commenter's user_id for notification
    author_photo: Optional[str] = None


def _post_to_dict(p: CommunityPost, comments: list = None) -> dict:
    """Convert a CommunityPost ORM object to API response dict."""
    return {
        "id": p.id,
        "user_id": p.user_id or "anonymous",
        "content": p.content,
        "title": p.content[:80] if p.content else "",
        "type": p.post_type or "general",
        "author": (p.location or {}).get("author", "Community Member"),
        "author_photo": (p.location or {}).get("author_photo"),
        "location": (p.location or {}).get("name", "India"),
        "lat": (p.location or {}).get("lat"),
        "lon": (p.location or {}).get("lon"),
        "pincode": (p.location or {}).get("pincode"),
        "tags": p.tags or [],
        "media": p.media or [],
        "image_analysis": (p.location or {}).get("image_analysis"),
        "likes": p.likes,
        "shares": p.shares,
        "comments": comments or [],
        "comments_count": p.comments_count or len(comments or []),
        "likedByUser": False,
        "savedByUser": False,
        "is_resolved": getattr(p, 'is_resolved', False) or False,
        "resolved_at": (p.resolved_at.isoformat() + "Z") if getattr(p, 'resolved_at', None) else None,
        "timestamp": (p.created_at.isoformat() + "Z") if p.created_at else "",
    }


def _comment_to_dict(c: Comment) -> dict:
    """Convert a Comment ORM object to API response dict."""
    return {
        "id": c.id,
        "author": c.user_id or "You",
        "author_photo": None,
        "content": c.content,
        "timestamp": (c.created_at.isoformat() + "Z") if c.created_at else "",
        "likes": c.likes,
        "likedByUser": False,
        "replies": [],
        "edited": c.updated_at != c.created_at if c.updated_at and c.created_at else False,
    }


def _notif_to_dict(n: Notification) -> dict:
    """Convert a Notification ORM object to API response dict."""
    return {
        "id": n.id,
        "user_id": n.user_id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "post_id": n.post_id,
        "from_user_id": n.from_user_id,
        "from_name": n.from_name,
        "from_photo": n.from_photo,
        "is_read": n.is_read,
        "timestamp": (n.created_at.isoformat() + "Z") if n.created_at else "",
    }


# ─────────── ENDPOINTS ───────────

@community_router.get("/posts")
async def get_posts(
    type: Optional[str] = None,
    pincode: Optional[str] = None,
    limit: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get community posts from database, with optional type and pincode filters."""
    query = select(CommunityPost).where(CommunityPost.is_public == True)
    if type:
        query = query.where(CommunityPost.post_type == type)
    query = query.order_by(CommunityPost.created_at.desc())
    # Load more if pincode filter will trim results
    query = query.limit(500 if pincode else limit)

    result = await db.execute(query)
    posts = result.scalars().all()

    # Pincode filter: match against location name string (Python-level)
    if pincode and pincode.strip():
        clean = pincode.strip()
        posts = [
            p for p in posts
            if (
                clean in str((p.location or {}).get("name", ""))
                or clean == str((p.location or {}).get("pincode", ""))
            )
        ]

    posts = posts[:limit]

    post_dicts = []
    for p in posts:
        # Load comments for this post
        comment_result = await db.execute(
            select(Comment)
            .where(Comment.post_id == p.id, Comment.parent_id.is_(None))
            .order_by(Comment.created_at.desc())
            .limit(50)
        )
        comments = [_comment_to_dict(c) for c in comment_result.scalars().all()]

        # Load replies for each comment
        for comment_dict in comments:
            reply_result = await db.execute(
                select(Comment)
                .where(Comment.parent_id == comment_dict["id"])
                .order_by(Comment.created_at.asc())
            )
            comment_dict["replies"] = [_comment_to_dict(r) for r in reply_result.scalars().all()]

        post_dicts.append(_post_to_dict(p, comments))

    return {"posts": post_dicts}


@community_router.post("/upload-image")
async def upload_community_image(
    file: UploadFile = File(...),
    description: str = Form(default=""),
):
    """Upload an image, run GPT-4o Vision analysis, return URL + analysis."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

    # Determine extension from content type
    ext_map = {
        "image/jpeg": ".jpg", "image/png": ".png",
        "image/gif": ".gif", "image/webp": ".webp",
        "video/mp4": ".mp4", "video/webm": ".webm",
    }
    ext = ext_map.get(file.content_type, ".bin")

    # Try Supabase Storage first, fall back to local disk
    from ai.vision_pipeline import save_upload, analyze_community_image
    from utils.supabase_storage import upload_file as supabase_upload

    public_url: str
    local_path: str

    supabase_url = await supabase_upload(raw, (file.filename or f"upload{ext}"), file.content_type)
    if supabase_url:
        # Supabase succeeded – still save locally so Vision pipeline can read bytes
        local_path = save_upload(raw, ext)
        public_url = supabase_url
    else:
        # Fall back to local disk
        local_path = save_upload(raw, ext)
        filename = pathlib.Path(local_path).name
        public_url = f"/uploads/{filename}"

    # Run vision pipeline for images only
    vision_result = None
    if file.content_type in ALLOWED_IMAGE_TYPES:
        try:
            vision_result = await analyze_community_image(local_path, description)
        except Exception as e:
            logger.warning("Vision pipeline failed: %s", e)

    return {
        "url": public_url,
        "type": file.content_type,
        "name": file.filename,
        "analysis": vision_result,
    }


@community_router.post("/posts")
async def create_post(
    http_request: Request,
    request: CreatePostRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_optional_user),
):
    """Create a community post in the database."""
    await enforce_rate_limit(
        http_request,
        bucket="community_post_create",
        limit=20,
        window_seconds=60,
        key_hint=(_user or {}).get("uid") if _user else request.user_id,
    )

    post_id = str(uuid.uuid4())

    # If the request carries a valid Firebase token, canonicalize the user_id
    # from the token — prevents impersonation by clients sending an arbitrary user_id.
    effective_user_id = request.user_id or "anonymous"
    if _user:
        effective_user_id = _user["uid"]

    # Supabase enforces FK on community_posts.user_id. Ensure the user exists.
    existing_user = await db.get(User, effective_user_id)
    if not existing_user:
        stable_suffix = uuid.uuid5(uuid.NAMESPACE_URL, effective_user_id).hex[:12]
        db.add(User(
            id=effective_user_id,
            email=f"guest_{stable_suffix}@guest.local",
            username=f"guest_{stable_suffix}",
            password_hash="external-auth",
            full_name=request.author or "Anonymous",
            user_type="citizen",
            location=None,
            preferences={},
        ))
        await db.flush()

    post_content = (request.content or "").strip()
    if not post_content and isinstance(request.image_analysis, dict):
        post_content = (
            request.image_analysis.get("self_generated_description")
            or request.image_analysis.get("description")
            or ""
        ).strip()

    if not post_content and request.media:
        for media_item in request.media:
            if not isinstance(media_item, dict):
                continue
            media_analysis = media_item.get("analysis")
            if isinstance(media_analysis, dict):
                media_analysis = media_analysis.get("analysis") if isinstance(media_analysis.get("analysis"), dict) else media_analysis
                if isinstance(media_analysis, dict):
                    post_content = (
                        media_analysis.get("self_generated_description")
                        or media_analysis.get("description")
                        or ""
                    ).strip()
            if post_content:
                break

    if not post_content and request.media:
        post_content = (request.title or "").strip() or "Community media update"

    if not post_content:
        raise HTTPException(status_code=400, detail="Post content, media, or valid image description is required")

    location_meta = {
        "name": request.location or "",
        "author": request.author or "Anonymous",
        "author_photo": request.author_photo,
    }
    if request.lat is not None:
        location_meta["lat"] = request.lat
    if request.lon is not None:
        location_meta["lon"] = request.lon
    if request.pincode:
        location_meta["pincode"] = request.pincode
    if isinstance(request.image_analysis, dict) and request.image_analysis:
        location_meta["image_analysis"] = request.image_analysis

    db_post = CommunityPost(
        id=post_id,
        user_id=effective_user_id,
        content=post_content,
        post_type=request.type,
        media=request.media or [],
        location=location_meta,
        tags=request.tags or [],
        likes=0,
        shares=0,
        comments_count=0,
        is_public=True,
    )
    db.add(db_post)
    await db.commit()
    await db.refresh(db_post)

    post_dict = _post_to_dict(db_post)

    # Broadcast proximity notification for high-priority post types
    if request.type in ("help", "emergency", "alert") and request.lat and request.lon:
        try:
            from notifications import ws_manager, push_manager
            alert_payload = {
                "type": "community_post",
                "title": f"🚨 {request.type.capitalize()} nearby — {request.author}",
                "body": post_content[:150],
                "post_type": request.type,
                "id": post_id,
                "author": request.author,
                "content": post_content[:200],
                "location": request.location,
                "coordinates": {"lat": request.lat, "lon": request.lon},
                "lat": request.lat,
                "lon": request.lon,
                "timestamp": post_dict["timestamp"],
                "url": "/app/community",
            }
            # WS: nearby users via WebSocket
            await ws_manager.broadcast_location_based(alert_payload, radius_km=10)
            # Push: nearby users via Web Push (background, don't block response)
            import asyncio
            asyncio.ensure_future(
                push_manager.send_nearby_push(request.lat, request.lon, alert_payload, radius_km=10, db=db)
            )

            # WhatsApp: send to users within 10 km for community help/emergency/alert posts
            nearby_users = await phone_registry.get_user_phones_near_from_db(
                db_session=db,
                lat=request.lat,
                lon=request.lon,
                radius_km=10,
            )
            if nearby_users:
                wa_result = await sms_service.send_community_whatsapp(
                    recipients=nearby_users,
                    post_type=request.type,
                    author=request.author or "Community Member",
                    location=request.location or "your area",
                    content=post_content,
                    app_url="http://localhost:3000/app/community",
                )
                logger.info(
                    "Community WhatsApp: sent=%s total=%s for post=%s",
                    wa_result.get("sent"),
                    wa_result.get("total"),
                    post_id,
                )
            else:
                logger.info("Community WhatsApp: no nearby users with phone/location in 10km")
        except Exception as e:
            logger.warning("Proximity notification failed: %s", e)

    return {"success": True, "post": post_dict}


@community_router.post("/posts/{post_id}/like")
async def like_post(
    post_id: str,
    unlike: bool = False,
    liker_id: Optional[str] = None,
    liker_name: Optional[str] = None,
    liker_photo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Like or unlike a post. Creates a notification for the post author on milestone likes."""
    post = await db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if unlike:
        post.likes = max(0, post.likes - 1)
    else:
        post.likes += 1
        # Notify post author at milestones (1, 5, 10, 25, 50 …)
        milestones = {1, 5, 10, 25, 50, 100}
        if post.likes in milestones and liker_id and post.user_id and liker_id != post.user_id:
            db.add(Notification(
                id=str(uuid.uuid4()),
                user_id=post.user_id,
                type="like",
                title=f"{liker_name or 'Someone'} liked your post",
                message=f"Your post now has {post.likes} like{'s' if post.likes > 1 else ''}.",
                post_id=post_id,
                from_user_id=liker_id,
                from_name=liker_name or "Community Member",
                from_photo=liker_photo,
                is_read=False,
            ))

    await db.commit()
    return {"success": True, "liked": not unlike, "likes": post.likes}


@community_router.post("/posts/{post_id}/save")
async def save_post(post_id: str, unsave: bool = False, db: AsyncSession = Depends(get_db)):
    """Save or unsave a post."""
    post = await db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"success": True, "saved": not unsave}


@community_router.delete("/posts/{post_id}")
async def delete_post(post_id: str, db: AsyncSession = Depends(get_db), _user=Depends(verify_firebase_token)):
    """Delete a post and its comments from the database."""
    post = await db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Only the post author (or admin) may delete a post
    if post.user_id and post.user_id not in ("anonymous", "You"):
        if _user["uid"] != post.user_id:
            raise HTTPException(status_code=403, detail="You can only delete your own posts")

    # Delete associated comments first
    comment_result = await db.execute(
        select(Comment).where(Comment.post_id == post_id)
    )
    for comment in comment_result.scalars().all():
        await db.delete(comment)

    await db.delete(post)
    await db.commit()
    return {"success": True}


@community_router.post("/posts/{post_id}/resolve")
async def toggle_resolve_post(
    post_id: str,
    resolved: bool = True,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Mark a help/offer/emergency post as resolved or unresolved (only the post author may do this)."""
    post = await db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Only the post owner may resolve their own post
    if user_id and post.user_id and post.user_id not in ("anonymous", "You") and user_id != post.user_id:
        raise HTTPException(status_code=403, detail="Only the post author can mark it as resolved")

    post.is_resolved = resolved
    post.resolved_at = datetime.now(timezone.utc) if resolved else None
    await db.commit()
    return {"success": True, "is_resolved": post.is_resolved, "resolved_at": (post.resolved_at.isoformat() + "Z") if post.resolved_at else None}


@community_router.post("/posts/{post_id}/comments")
async def add_comment(
    http_request: Request,
    post_id: str,
    request: CreateCommentRequest,
    db: AsyncSession = Depends(get_db),
):
    """Add a comment (or reply) to a post. Persisted in database."""
    await enforce_rate_limit(
        http_request,
        bucket="community_comment_create",
        limit=40,
        window_seconds=60,
        key_hint=request.author_id or request.author,
    )

    post = await db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # If replying, verify parent comment exists
    if request.parent_id:
        parent = await db.get(Comment, request.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent comment not found")

    comment_id = str(uuid.uuid4())
    db_comment = Comment(
        id=comment_id,
        user_id=request.author or "You",
        post_id=post_id,
        parent_id=request.parent_id,
        content=request.content,
        likes=0,
    )
    db.add(db_comment)

    # Update comment count on the post
    post.comments_count = (post.comments_count or 0) + 1

    # Create notification for post author (skip self-notifications)
    commenter_id = request.author_id or request.author or "anonymous"
    post_owner_id = post.user_id or "anonymous"
    if commenter_id != post_owner_id and post_owner_id not in ("anonymous", "You", None):
        notif_type = "reply" if request.parent_id else "comment"
        notif_title = (
            f"{request.author} replied to a comment on your post"
            if request.parent_id
            else f"{request.author} commented on your post"
        )
        db_notif = Notification(
            id=str(uuid.uuid4()),
            user_id=post_owner_id,
            type=notif_type,
            title=notif_title,
            message=request.content[:150],
            post_id=post_id,
            from_user_id=commenter_id,
            from_name=request.author or "Community Member",
            from_photo=request.author_photo,
            is_read=False,
        )
        db.add(db_notif)

    await db.commit()
    await db.refresh(db_comment)

    return {"success": True, "comment": _comment_to_dict(db_comment)}


@community_router.get("/stats")
async def community_stats(db: AsyncSession = Depends(get_db)):
    """Return aggregate stats for the community sidebar."""
    total_q = await db.execute(
        select(func.count(CommunityPost.id)).where(CommunityPost.is_public == True)
    )
    total = total_q.scalar() or 0

    helps_q = await db.execute(
        select(func.count(CommunityPost.id)).where(
            CommunityPost.is_public == True, CommunityPost.post_type == "help"
        )
    )
    helps = helps_q.scalar() or 0

    offers_q = await db.execute(
        select(func.count(CommunityPost.id)).where(
            CommunityPost.is_public == True, CommunityPost.post_type == "offer"
        )
    )
    offers = offers_q.scalar() or 0

    alerts_q = await db.execute(
        select(func.count(CommunityPost.id)).where(
            CommunityPost.is_public == True,
            CommunityPost.post_type.in_(["alert", "emergency"]),
        )
    )
    alerts = alerts_q.scalar() or 0

    return {
        "total_posts": total,
        "total_helps": helps,
        "total_offers": offers,
        "total_alerts": alerts,
    }


@community_router.get("/leaderboard")
async def get_leaderboard(
    limit: int = Query(default=10, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return top community contributors ranked by helpful activity, with badge info."""
    result = await db.execute(
        select(CommunityPost).where(CommunityPost.is_public == True)
    )
    all_posts = result.scalars().all()

    user_stats: dict = {}
    for post in all_posts:
        uid = post.user_id or "anonymous"
        if uid == "anonymous":
            continue
        if uid not in user_stats:
            loc = post.location or {}
            user_stats[uid] = {
                "user_id": uid,
                "name": loc.get("author", "Community Member"),
                "photo": loc.get("author_photo"),
                "total_posts": 0,
                "helpful_posts": 0,
            }
        user_stats[uid]["total_posts"] += 1
        if post.post_type in ("help", "offer", "emergency", "alert"):
            user_stats[uid]["helpful_posts"] += 1

    ranking = sorted(
        user_stats.values(),
        key=lambda x: (x["helpful_posts"], x["total_posts"]),
        reverse=True,
    )[:limit]

    for i, user in enumerate(ranking):
        user["rank"] = i + 1
        user["badge"] = _compute_badge(user["helpful_posts"])

    return {"leaderboard": ranking}


@community_router.get("/trending-tags")
async def get_trending_tags(
    limit: int = Query(default=8, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return most-used hashtags across all community posts."""
    result = await db.execute(
        select(CommunityPost.tags).where(CommunityPost.is_public == True)
    )
    tag_counts: dict = {}
    for row in result.all():
        for tag in (row[0] or []):
            t = tag.lower().strip("#").strip()
            if t:
                tag_counts[t] = tag_counts.get(t, 0) + 1

    sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:limit]
    return {"tags": [{"tag": t, "count": c} for t, c in sorted_tags]}


# ─── Direct Messages ───────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    from_user_id: str
    from_name: str
    from_photo: Optional[str] = None
    to_user_id: str
    to_name: str
    post_id: Optional[str] = None
    content: str


def _dm_to_dict(m: "DirectMessage") -> dict:
    return {
        "id": m.id,
        "from_user_id": m.from_user_id,
        "from_name": m.from_name,
        "from_photo": m.from_photo,
        "to_user_id": m.to_user_id,
        "to_name": m.to_name,
        "post_id": m.post_id,
        "content": m.content,
        "is_read": m.is_read,
        "timestamp": (m.created_at.isoformat() + "Z") if m.created_at else "",
    }


@community_router.post("/messages")
async def send_message(req: SendMessageRequest, db: AsyncSession = Depends(get_db)):
    """Send a direct message to another user."""
    if req.from_user_id == req.to_user_id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    msg = DirectMessage(
        id=str(uuid.uuid4()),
        from_user_id=req.from_user_id,
        from_name=req.from_name,
        from_photo=req.from_photo,
        to_user_id=req.to_user_id,
        to_name=req.to_name,
        post_id=req.post_id,
        content=req.content.strip(),
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return {"success": True, "message": _dm_to_dict(msg)}


@community_router.get("/messages/conversation/{other_user_id}")
async def get_conversation(
    other_user_id: str,
    my_user_id: str = Query(...),
    post_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Fetch all messages between two users (optionally scoped to one post)."""
    q = select(DirectMessage).where(
        or_(
            and_(DirectMessage.from_user_id == my_user_id, DirectMessage.to_user_id == other_user_id),
            and_(DirectMessage.from_user_id == other_user_id, DirectMessage.to_user_id == my_user_id),
        )
    )
    if post_id:
        q = q.where(DirectMessage.post_id == post_id)
    q = q.order_by(DirectMessage.created_at.asc())
    result = await db.execute(q)
    msgs = result.scalars().all()

    # Mark unread messages as read
    for m in msgs:
        if m.to_user_id == my_user_id and not m.is_read:
            m.is_read = True
    await db.commit()

    return {"messages": [_dm_to_dict(m) for m in msgs]}


@community_router.get("/messages/inbox/{user_id}")
async def get_inbox(user_id: str, db: AsyncSession = Depends(get_db)):
    """Return conversation threads (latest message per partner) for a user."""
    q = select(DirectMessage).where(
        or_(DirectMessage.from_user_id == user_id, DirectMessage.to_user_id == user_id)
    ).order_by(DirectMessage.created_at.desc())
    result = await db.execute(q)
    all_msgs = result.scalars().all()

    # Build thread map: partner_user_id → latest message + unread count
    threads: dict = {}
    for m in all_msgs:
        partner_id = m.to_user_id if m.from_user_id == user_id else m.from_user_id
        partner_name = m.to_name if m.from_user_id == user_id else m.from_name
        partner_photo = None  # we don't store partner photo on inbox; use from_photo if partner is sender
        if m.from_user_id != user_id:
            partner_photo = m.from_photo
        if partner_id not in threads:
            threads[partner_id] = {
                "partner_id": partner_id,
                "partner_name": partner_name,
                "partner_photo": partner_photo,
                "last_message": _dm_to_dict(m),
                "unread_count": 0,
                "post_id": m.post_id,
            }
        if m.to_user_id == user_id and not m.is_read:
            threads[partner_id]["unread_count"] += 1

    return {"threads": list(threads.values())}


@community_router.post("/messages/{message_id}/read")
async def mark_read(message_id: str, db: AsyncSession = Depends(get_db)):
    """Mark a single message as read."""
    msg = await db.get(DirectMessage, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    msg.is_read = True
    await db.commit()
    return {"success": True}


# ─── Notification endpoints ────────────────────────────────────────────────────

@community_router.get("/notifications/{user_id}")
async def get_notifications(
    user_id: str,
    limit: int = Query(default=20, le=50),
    unread_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Fetch notifications for a user, newest first."""
    q = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        q = q.where(Notification.is_read == False)  # noqa: E712
    q = q.order_by(Notification.created_at.desc()).limit(limit)
    result = await db.execute(q)
    notifs = result.scalars().all()

    unread_q = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.is_read == False  # noqa: E712
        )
    )
    unread_count = unread_q.scalar() or 0

    return {"notifications": [_notif_to_dict(n) for n in notifs], "unread_count": unread_count}


@community_router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, db: AsyncSession = Depends(get_db)):
    """Mark a single notification as read."""
    notif = await db.get(Notification, notif_id)
    if notif:
        notif.is_read = True
        await db.commit()
    return {"success": True}


@community_router.post("/notifications/read-all/{user_id}")
async def mark_all_notifications_read(user_id: str, db: AsyncSession = Depends(get_db)):
    """Mark all unread notifications for a user as read."""
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    for n in result.scalars().all():
        n.is_read = True
    await db.commit()
    return {"success": True}


# ─── User Reports ──────────────────────────────────────────────────────────────

class SubmitReportRequest(BaseModel):
    reporter_id: str
    reporter_name: str
    reported_user_id: str
    reported_user_name: str
    post_id: Optional[str] = None
    reason: str  # 'misinformation','spam','harassment','inappropriate','false_emergency'
    description: Optional[str] = None


@community_router.post("/report")
async def submit_report(request: SubmitReportRequest, db: AsyncSession = Depends(get_db)):
    """Submit a report about a user or post for admin review."""
    if request.reporter_id == request.reported_user_id:
        raise HTTPException(status_code=400, detail="Cannot report yourself")
    valid_reasons = {"misinformation", "spam", "harassment", "inappropriate", "false_emergency", "other"}
    if request.reason not in valid_reasons:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Must be one of: {', '.join(sorted(valid_reasons))}")

    report = UserReport(
        id=str(uuid.uuid4()),
        reporter_id=request.reporter_id,
        reporter_name=request.reporter_name,
        reported_user_id=request.reported_user_id,
        reported_user_name=request.reported_user_name,
        post_id=request.post_id,
        reason=request.reason,
        description=(request.description or "")[:500],
        status="pending",
    )
    db.add(report)
    await db.commit()
    return {"success": True, "report_id": report.id, "message": "Report submitted for admin review. Thank you for helping keep the community safe."}
