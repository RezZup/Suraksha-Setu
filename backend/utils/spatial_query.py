"""
Optimized Spatial Query Utilities
Uses database-level filtering with Haversine distance formula.
MUCH LIGHTER & FASTER than in-memory Python loops.
"""
from sqlalchemy import select, func, and_
from typing import List, Optional, Tuple
import math


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate great circle distance between two points in kilometers using Haversine formula.
    More accurate than Euclidean for geographic coordinates.
    
    Args:
        lat1, lon1: First point coordinates (degrees)
        lat2, lon2: Second point coordinates (degrees)
    
    Returns:
        Distance in kilometers
    """
    R = 6371  # Earth radius in km
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def estimate_lat_lon_tolerance(radius_km: float) -> Tuple[float, float]:
    """
    Estimate tolerance in degrees for faster database filtering.
    Pre-filter records before applying Haversine distance (optimization).
    
    Args:
        radius_km: Search radius in kilometers
    
    Returns:
        (lat_tolerance, lon_tolerance) in degrees
    """
    lat_tolerance = radius_km / 111.0  # 1 degree latitude ≈ 111 km
    lon_tolerance = radius_km / 60.0   # rough estimate (varies by latitude)
    return lat_tolerance, lon_tolerance


async def find_nearby_push_subscriptions(
    db_session,
    alert_lat: float,
    alert_lon: float,
    radius_km: float = 15.0,
    limit: int = 1000
) -> List[dict]:
    """
    OPTIMIZED: Find push subscriptions near alert location using spatial filtering.
    
    Database-level filtering bypasses loading all 10,000+ records into Python.
    
    Args:
        db_session: AsyncSession
        alert_lat, alert_lon: Alert coordinates
        radius_km: Search radius (default 15km)
        limit: Max results to return
    
    Returns:
        List of push subscriptions within radius_km
    """
    from database import PushSubscription
    
    lat_tol, lon_tol = estimate_lat_lon_tolerance(radius_km)
    
    # Step 1: DB-level pre-filter by bounding box (FAST)
    query = select(PushSubscription).where(
        and_(
            PushSubscription.is_active == True,  # noqa: E712
            PushSubscription.user_lat.isnot(None),
            PushSubscription.user_lon.isnot(None),
            PushSubscription.user_lat.between(alert_lat - lat_tol, alert_lat + lat_tol),
            PushSubscription.user_lon.between(alert_lon - lon_tol, alert_lon + lon_tol),
        )
    ).limit(limit)
    
    result = await db_session.execute(query)
    subscriptions = result.scalars().all()
    
    # Step 2: Python-level Haversine filter (only on pre-filtered set, not all records)
    nearby = []
    for sub in subscriptions:
        distance_km = haversine_distance(
            alert_lat, alert_lon,
            sub.user_lat, sub.user_lon
        )
        if distance_km <= radius_km:
            nearby.append(sub)
    
    return nearby


async def find_pincode_users(
    db_session,
    pincode: str,
    exclude_notified: Optional[set] = None
) -> List:
    """
    OPTIMIZED: Find users matching a pincode using indexed database query.
    
    Instead of fetching ALL users and looping, uses a single targeted query.
    Requires: database index on user.location->>'home_pincode'
    
    Args:
        db_session: AsyncSession
        pincode: Target pincode
        exclude_notified: Set of user_ids to skip (already notified)
    
    Returns:
        List of User objects with matching pincodes
    """
    from database import User
    from sqlalchemy import or_, text
    
    # For PostgreSQL with JSON indexing:
    if exclude_notified:
        query = select(User).where(
            and_(
                User.is_active == True,  # noqa: E712
                User.telegram_chat_id.isnot(None),
                User.id.notin_(exclude_notified),
                # Requires: CREATE INDEX idx_user_home_pincode ON users USING GIN ((location->>'home_pincode'));
                or_(
                    text(f"(location->>'home_pincode') = '{pincode}'"),
                    text(f"(location->>'gps_pincode') = '{pincode}'"),
                )
            )
        )
    else:
        query = select(User).where(
            and_(
                User.is_active == True,  # noqa: E712
                User.telegram_chat_id.isnot(None),
                or_(
                    text(f"(location->>'home_pincode') = '{pincode}'"),
                    text(f"(location->>'gps_pincode') = '{pincode}'"),
                )
            )
        )
    
    result = await db_session.execute(query)
    return result.scalars().all()


async def find_nearby_users_with_pincodes(
    db_session,
    alert_lat: float,
    alert_lon: float,
    alert_pincodes: Optional[List[str]] = None,
    radius_km: float = 50.0,
    limit: int = 5000
) -> Tuple[List, List]:
    """
    OPTIMIZED: Get both GPS-nearby users AND pincode-matching users (deduped).
    
    Two queries → single result set (avoids overlap notifications).
    
    Args:
        db_session: AsyncSession
        alert_lat, alert_lon: Alert coordinates
        alert_pincodes: Pincodes to match
        radius_km: GPS search radius
        limit: Max results
    
    Returns:
        (gps_nearby_users, pincode_matched_users)
    """
    from database import User
    from sqlalchemy import or_, text
    
    lat_tol, lon_tol = estimate_lat_lon_tolerance(radius_km)
    
    # Query 1: GPS-based proximity
    gps_query = select(User).where(
        and_(
            User.is_active == True,  # noqa: E712
            User.geom.isnot(None),
            # If using lat/lon columns:
            # User.latitude.between(alert_lat - lat_tol, alert_lat + lat_tol),
            # User.longitude.between(alert_lon - lon_tol, alert_lon + lon_tol)
        )
    ).limit(limit)
    
    gps_result = await db_session.execute(gps_query)
    gps_users = gps_result.scalars().all()
    
    # Python-level haversine filter on location field
    gps_nearby = []
    if hasattr(gps_users[0] if gps_users else None, 'location'):
        for user in gps_users:
            loc = user.location or {}
            lat = loc.get('lat')
            lon = loc.get('lon')
            if lat and lon:
                dist = haversine_distance(alert_lat, alert_lon, lat, lon)
                if dist <= radius_km:
                    gps_nearby.append(user)
    
    # Query 2: Pincode-based matching
    pincode_users = []
    notified_ids = {u.id for u in gps_nearby}
    
    if alert_pincodes:
        for pincode in alert_pincodes:
            pcode_result = await find_pincode_users(db_session, pincode, notified_ids)
            pincode_users.extend(pcode_result)
            notified_ids.update(u.id for u in pcode_result)
    
    return gps_nearby, pincode_users


# ========== MIGRATION & INDEXING HELPERS ==========

SQL_INDEX_CREATION = """
-- Create indexes for optimal spatial queries in PostgreSQL

-- 1. Index on user GPS coordinates (for proximity searches)
CREATE INDEX IF NOT EXISTS idx_user_location_geo ON users (geom) USING GIST;

-- 2. Index on pincode fields within JSON location
CREATE INDEX IF NOT EXISTS idx_user_home_pincode ON users USING GIN ((location->>'home_pincode'));
CREATE INDEX IF NOT EXISTS idx_user_gps_pincode ON users USING GIN ((location->>'gps_pincode'));

-- 3. Index on push subscription coordinates (for spatial joins)
CREATE INDEX IF NOT EXISTS idx_pushsub_location 
    ON push_subscriptions (user_lat, user_lon) WHERE is_active = true;

-- 4. Index on alert coordinates
CREATE INDEX IF NOT EXISTS idx_alert_geo ON alerts (geom) USING GIST WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_alert_pincodes ON alerts USING GIN ((location->'pin_codes'));

-- 5. Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_alert_active_time 
    ON alerts (is_active, created_at DESC) WHERE is_active = true;

-- For SQLite (if not migrating to PostgreSQL):
-- SQLite doesn't support spatial indexes, but you can use triggers + rtree for optimization
-- This is NOT recommended — consider migrating to PostgreSQL for large datasets.
"""

def get_index_migration_sql():
    """Returns SQL to create optimal indexes for PostgreSQL."""
    return SQL_INDEX_CREATION
