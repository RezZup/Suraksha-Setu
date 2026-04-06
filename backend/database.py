"""
PostgreSQL Database Configuration and Models
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, Mapped, mapped_column
from sqlalchemy import String, DateTime, JSON, Boolean, Integer, Float, Text, ForeignKey, TypeDecorator, UniqueConstraint
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import os
from dotenv import load_dotenv

load_dotenv()

# Get database URL from environment
DATABASE_URL = os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL')

# Auto-detect database type and configure appropriately
if DATABASE_URL:
    if DATABASE_URL.startswith('sqlite'):
        # SQLite for local development
        print("[DB] Using SQLite for local development")
        engine = create_async_engine(
            DATABASE_URL,
            echo=False,
            connect_args={"check_same_thread": False}
        )
    elif DATABASE_URL.startswith('postgresql://'):
        # PostgreSQL for production (Render)
        print("🔧 Using PostgreSQL for production")
        DATABASE_URL = DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://', 1)
        engine = create_async_engine(
            DATABASE_URL,
            echo=False,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            connect_args={
                "ssl": "require",  # Render PostgreSQL requires SSL
                "server_settings": {"application_name": "suraksha_setu_backend"}
            }
        )
    elif DATABASE_URL.startswith('postgresql+asyncpg://'):
        # Already converted PostgreSQL URL
        print("🔧 Using PostgreSQL for production")
        engine = create_async_engine(
            DATABASE_URL,
            echo=False,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            connect_args={
                "ssl": "require",
                "server_settings": {"application_name": "suraksha_setu_backend"}
            }
        )
    else:
        raise ValueError(f"Unsupported database URL format: {DATABASE_URL[:20]}...")
else:
    raise ValueError("DATABASE_URL not set in environment variables")

# Define SafeGeography as JSON for broad compatibility across SQLite/Supabase schemas.
# Existing deployments store geom columns as JSON, so using Geography would trigger
# ST_AsBinary(json) errors on SELECT.
SafeGeography = JSON

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Base class for models
Base = declarative_base()

# ==================== DATABASE MODELS ====================

class User(Base):
    """User table for authentication and preferences"""
    __tablename__ = 'users'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[Optional[str]] = mapped_column(String(255))
    user_type: Mapped[str] = mapped_column(String(50))  # student, scientist, admin, citizen
    location: Mapped[Optional[Dict]] = mapped_column(JSON)
    geom: Mapped[Any] = mapped_column(SafeGeography(), nullable=True)
    preferences: Mapped[Optional[Dict]] = mapped_column(JSON)
    # Profile & notification fields
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    telegram_username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notification_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notification_radius_km: Mapped[Optional[float]] = mapped_column(Float, default=50.0)
    notification_channels: Mapped[Optional[Dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ChatMessage(Base):
    """Chat message history"""
    __tablename__ = 'chat_messages'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.id', ondelete='CASCADE'))
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    message: Mapped[str] = mapped_column(Text)
    response: Mapped[str] = mapped_column(Text)
    language: Mapped[Optional[str]] = mapped_column(String(10))
    context: Mapped[Optional[Dict]] = mapped_column(JSON)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class Alert(Base):
    """Disaster and weather alerts"""
    __tablename__ = 'alerts'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    alert_type: Mapped[str] = mapped_column(String(50), index=True)  # weather, disaster, aqi, etc.
    severity: Mapped[str] = mapped_column(String(20))  # low, medium, high, critical
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[Dict] = mapped_column(JSON)  # {lat, lon, city, state, pin_codes}
    geom: Mapped[Any] = mapped_column(SafeGeography(), nullable=True)
    alert_metadata: Mapped[Optional[Dict]] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(100))  # IMD, ISRO, CPCB, etc.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    retracted: Mapped[bool] = mapped_column(Boolean, default=False)
    retraction_reason: Mapped[Optional[str]] = mapped_column(Text)
    retracted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class AlertFeedback(Base):
    """User trust/quality feedback for generated alerts."""
    __tablename__ = 'alert_feedback'
    __table_args__ = (
        UniqueConstraint('alert_id', 'user_id', name='uq_alert_feedback_user'),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    alert_id: Mapped[str] = mapped_column(String(255), ForeignKey('alerts.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    verdict: Mapped[str] = mapped_column(String(30), index=True)  # accurate, false_alarm, outdated, duplicate
    confidence: Mapped[Optional[int]] = mapped_column(Integer)
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class CommunityReport(Base):
    """User-generated disaster reports"""
    __tablename__ = 'community_reports'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey('users.id', ondelete='CASCADE'), index=True)
    report_type: Mapped[str] = mapped_column(String(50))  # flood, fire, earthquake, etc.
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[Dict] = mapped_column(JSON)
    geom: Mapped[Any] = mapped_column(SafeGeography(), nullable=True)
    media_urls: Mapped[Optional[list]] = mapped_column(JSON)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    downvotes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class StatusCheck(Base):
    """User welfare status checks"""
    __tablename__ = 'status_checks'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey('users.id', ondelete='CASCADE'), index=True)
    status: Mapped[str] = mapped_column(String(20))  # safe, help_needed, emergency
    message: Mapped[Optional[str]] = mapped_column(Text)
    location: Mapped[Dict] = mapped_column(JSON)
    geom: Mapped[Any] = mapped_column(SafeGeography(), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class PushSubscription(Base):
    """Web push notification subscriptions"""
    __tablename__ = 'push_subscriptions'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.id', ondelete='CASCADE'))
    subscription_json: Mapped[Dict] = mapped_column(JSON)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500))
    user_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # GPS latitude for proximity
    user_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # GPS longitude for proximity
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserReport(Base):
    """Reports submitted by users about false/harmful posts or users."""
    __tablename__ = 'user_reports'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    reporter_id: Mapped[str] = mapped_column(String(255), index=True)
    reporter_name: Mapped[str] = mapped_column(String(255))
    reported_user_id: Mapped[str] = mapped_column(String(255), index=True)
    reported_user_name: Mapped[str] = mapped_column(String(255))
    post_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('community_posts.id', ondelete='SET NULL'), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(String(100))   # 'misinformation','spam','harassment','inappropriate','false_emergency'
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default='pending')   # 'pending','reviewed','resolved'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class CommunityPost(Base):
    """Community social media posts"""
    __tablename__ = 'community_posts'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey('users.id', ondelete='CASCADE'), index=True)
    content: Mapped[str] = mapped_column(Text)
    post_type: Mapped[str] = mapped_column(String(50))  # text, image, video, poll, etc.
    media: Mapped[Optional[list]] = mapped_column(JSON)
    location: Mapped[Optional[Dict]] = mapped_column(JSON)
    tags: Mapped[Optional[list]] = mapped_column(JSON)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    shares: Mapped[int] = mapped_column(Integer, default=0)
    comments_count: Mapped[int] = mapped_column(Integer, default=0)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)


class MOSDACMetadata(Base):
    """MOSDAC Product Metadata (Layer 1)"""
    __tablename__ = 'mosdac_metadata'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    product_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    identifier: Mapped[str] = mapped_column(String(500))  # Filename
    dataset_id: Mapped[str] = mapped_column(String(255), index=True)
    timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    bounding_box: Mapped[Optional[Dict]] = mapped_column(JSON)
    raw_metadata: Mapped[Dict] = mapped_column(JSON)  # Renamed from 'metadata' (SQLAlchemy reserved)
    downloaded: Mapped[bool] = mapped_column(Boolean, default=False)
    file_path: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class IncidentLog(Base):
    """Incident Log for Alert Retractions and False Positives"""
    __tablename__ = 'incident_logs'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    alert_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('alerts.id', ondelete='SET NULL'), index=True)
    incident_type: Mapped[str] = mapped_column(String(100))  # "false_positive", "retraction", etc.
    reason: Mapped[str] = mapped_column(Text)
    corrective_action: Mapped[str] = mapped_column(Text)
    admin_user_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    extra_data: Mapped[Optional[Dict]] = mapped_column(JSON)  # Renamed from 'metadata'


class Comment(Base):
    """Comments on community posts and reports"""
    __tablename__ = 'comments'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey('users.id', ondelete='CASCADE'))
    post_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('community_posts.id', ondelete='CASCADE'), index=True)
    report_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('community_reports.id', ondelete='CASCADE'), index=True)
    parent_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('comments.id', ondelete='CASCADE'))  # For nested comments
    content: Mapped[str] = mapped_column(Text)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AILog(Base):
    """AI API call logs for token tracking and budget auditing"""
    __tablename__ = 'ai_logs'
    
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('users.id', ondelete='SET NULL'), index=True)
    endpoint: Mapped[str] = mapped_column(String(100), index=True)  # "chat", "whisper", "vision", "embeddings", "tts"
    model: Mapped[str] = mapped_column(String(50))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[Optional[str]] = mapped_column(String(50))
    tool_calls: Mapped[Optional[list]] = mapped_column(JSON)
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class DirectMessage(Base):
    """User-to-user direct messages linked to a community post."""
    __tablename__ = 'direct_messages'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    # Sender
    from_user_id: Mapped[str] = mapped_column(String(255), index=True)
    from_name: Mapped[str] = mapped_column(String(255))
    from_photo: Mapped[Optional[str]] = mapped_column(String(1000))
    # Recipient
    to_user_id: Mapped[str] = mapped_column(String(255), index=True)
    to_name: Mapped[str] = mapped_column(String(255))
    # Context post (optional but usually set)
    post_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey('community_posts.id', ondelete='SET NULL'), index=True)
    # Message body
    content: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class Notification(Base):
    """In-app notification for community activity (comments, likes, new posts)."""
    __tablename__ = 'notifications'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)       # recipient
    type: Mapped[str] = mapped_column(String(50))                       # 'comment','reply','like','new_help','new_offer','new_emergency','dm'
    title: Mapped[str] = mapped_column(String(500))
    message: Mapped[str] = mapped_column(Text)
    post_id: Mapped[Optional[str]] = mapped_column(
        String(255), ForeignKey('community_posts.id', ondelete='SET NULL'), nullable=True, index=True
    )
    from_user_id: Mapped[str] = mapped_column(String(255))
    from_name: Mapped[str] = mapped_column(String(255))
    from_photo: Mapped[Optional[str]] = mapped_column(String(1000))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )


class EarthquakeDataset(Base):
    """Dedicated earthquake dataset table for model training."""
    __tablename__ = 'earthquake_dataset'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    external_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(500))
    event_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    event_date: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    location: Mapped[Optional[str]] = mapped_column(String(500), index=True)
    severity: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    status: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    magnitude: Mapped[Optional[float]] = mapped_column(Float)
    depth_km: Mapped[Optional[float]] = mapped_column(Float)
    lat: Mapped[Optional[float]] = mapped_column(Float, index=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, index=True)
    casualties: Mapped[Optional[int]] = mapped_column(Integer)
    affected_population: Mapped[Optional[int]] = mapped_column(Integer)
    description: Mapped[Optional[str]] = mapped_column(Text)
    raw_payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class FloodDataset(Base):
    """Dedicated flood dataset table for model training."""
    __tablename__ = 'flood_dataset'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    external_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(500))
    event_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    event_date: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    location: Mapped[Optional[str]] = mapped_column(String(500), index=True)
    severity: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    status: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    lat: Mapped[Optional[float]] = mapped_column(Float, index=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, index=True)
    casualties: Mapped[Optional[int]] = mapped_column(Integer)
    affected_population: Mapped[Optional[int]] = mapped_column(Integer)
    description: Mapped[Optional[str]] = mapped_column(Text)
    raw_payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class HeatwaveDataset(Base):
    """Dedicated heatwave dataset table for model training."""
    __tablename__ = 'heatwave_dataset'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    external_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(500))
    event_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    event_date: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    location: Mapped[Optional[str]] = mapped_column(String(500), index=True)
    severity: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    status: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    max_temp_c: Mapped[Optional[float]] = mapped_column(Float)
    lat: Mapped[Optional[float]] = mapped_column(Float, index=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, index=True)
    casualties: Mapped[Optional[int]] = mapped_column(Integer)
    affected_population: Mapped[Optional[int]] = mapped_column(Integer)
    description: Mapped[Optional[str]] = mapped_column(Text)
    raw_payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class NearbyDisasterDataset(Base):
    """Nearby disaster observations captured from user-location queries."""
    __tablename__ = 'nearby_disaster_dataset'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    query_lat: Mapped[float] = mapped_column(Float, index=True)
    query_lon: Mapped[float] = mapped_column(Float, index=True)
    radius_km: Mapped[float] = mapped_column(Float, index=True)
    alert_id: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    alert_type: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    severity: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(500))
    location: Mapped[Optional[str]] = mapped_column(String(500))
    source: Mapped[Optional[str]] = mapped_column(String(100), index=True)
    alert_created_at: Mapped[Optional[str]] = mapped_column(String(100))
    raw_payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class WeatherDataset(Base):
    """Stored weather observations fetched from external sources."""
    __tablename__ = 'weather_dataset'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    city: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    lat: Mapped[float] = mapped_column(Float, index=True)
    lon: Mapped[float] = mapped_column(Float, index=True)
    observation_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float)
    humidity: Mapped[Optional[float]] = mapped_column(Float)
    wind_speed: Mapped[Optional[float]] = mapped_column(Float)
    pressure: Mapped[Optional[float]] = mapped_column(Float)
    rain: Mapped[Optional[float]] = mapped_column(Float)
    condition: Mapped[Optional[str]] = mapped_column(String(100), index=True)
    weather_code: Mapped[Optional[int]] = mapped_column(Integer, index=True)
    quality_score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    quality_status: Mapped[str] = mapped_column(String(30), default='unknown', index=True)
    raw_payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class AQIDataset(Base):
    """Stored AQI observations fetched from external sources."""
    __tablename__ = 'aqi_dataset'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    city: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    lat: Mapped[float] = mapped_column(Float, index=True)
    lon: Mapped[float] = mapped_column(Float, index=True)
    observation_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    aqi: Mapped[Optional[int]] = mapped_column(Integer, index=True)
    aqi_index: Mapped[Optional[int]] = mapped_column(Integer, index=True)
    aqi_label: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    pm25: Mapped[Optional[float]] = mapped_column(Float)
    pm10: Mapped[Optional[float]] = mapped_column(Float)
    no2: Mapped[Optional[float]] = mapped_column(Float)
    o3: Mapped[Optional[float]] = mapped_column(Float)
    so2: Mapped[Optional[float]] = mapped_column(Float)
    co: Mapped[Optional[float]] = mapped_column(Float)
    quality_score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    quality_status: Mapped[str] = mapped_column(String(30), default='unknown', index=True)
    raw_payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class SourceIngestionLog(Base):
    """Quality and retry tracking for all third-party source fetches."""
    __tablename__ = 'source_ingestion_logs'

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    source: Mapped[str] = mapped_column(String(100), index=True)
    dataset_type: Mapped[str] = mapped_column(String(100), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)  # success, low_quality, failed
    quality_score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    is_usable: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    lat: Mapped[Optional[float]] = mapped_column(Float, index=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, index=True)
    city: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    payload: Mapped[Optional[Dict]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


# ==================== DATABASE SESSION DEPENDENCY ====================

async def get_db() -> AsyncSession:
    """Dependency to get database session"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# ==================== DATABASE INITIALIZATION ====================

async def init_db():
    """Initialize database tables"""
    from sqlalchemy import text
    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        # Add new columns to existing tables if they don't exist (safe migrations)
        for stmt in [
            "ALTER TABLE community_posts ADD COLUMN is_resolved BOOLEAN DEFAULT FALSE",
            "ALTER TABLE community_posts ADD COLUMN resolved_at DATETIME",
            "ALTER TABLE push_subscriptions ADD COLUMN user_lat REAL",
            "ALTER TABLE push_subscriptions ADD COLUMN user_lon REAL",
            # Community notifications columns (for older DBs)
            "ALTER TABLE notifications ADD COLUMN message TEXT",
            "ALTER TABLE notifications ADD COLUMN from_name TEXT",
            "ALTER TABLE notifications ADD COLUMN from_photo TEXT",
            "ALTER TABLE notifications ADD COLUMN is_read BOOLEAN DEFAULT FALSE",
            # Profile & notification columns
            "ALTER TABLE users ADD COLUMN bio TEXT",
            "ALTER TABLE users ADD COLUMN phone TEXT",
            "ALTER TABLE users ADD COLUMN avatar_url TEXT",
            "ALTER TABLE users ADD COLUMN telegram_chat_id TEXT",
            "ALTER TABLE users ADD COLUMN telegram_username TEXT",
            "ALTER TABLE users ADD COLUMN notification_email TEXT",
            "ALTER TABLE users ADD COLUMN notification_radius_km REAL DEFAULT 50",
            "ALTER TABLE users ADD COLUMN notification_channels JSON",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # Column already exists
        print("[DB] Database tables created/updated successfully")


async def close_db():
    """Close database connections"""
    await engine.dispose()
    print("[DB] Database connections closed")
