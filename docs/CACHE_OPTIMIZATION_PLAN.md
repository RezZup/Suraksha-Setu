"""
Global Disaster Cache Strategy
Store disaster data once, reuse for all users (filter by distance)
"""

# Current architecture (inefficient):
# User 1 requests -> API call to GDACS -> Get 100 earthquakes
# User 2 requests -> API call to GDACS -> Get same 100 earthquakes (DUPLICATE!)
# User 3 requests -> API call to GDACS -> Get same 100 earthquakes (DUPLICATE!)

# Optimized architecture:
# Backend cron job (every 30 min) -> API call to GDACS once -> store in DB
# User 1 requests -> Query DB, filter by their location distance
# User 2 requests -> Query DB, filter by their location distance (instant!)
# User 3 requests -> Query DB, filter by their location distance (instant!)

# ═══════════════════════════════════════════════════════════════════════

# PROPOSED DATABASE TABLES:

# 1. disaster_cache (Global, shared by all users)
#    id, type (earthquake|flood|cyclone|heatwave), lat, lon, magnitude/intensity
#    source (GDACS|USGS|MOSDAC), raw_data (JSON), updated_at, ttl

# 2. user_disaster_alerts (User-specific, filtered by distance)
#    user_id, disaster_id, distance_km, severity, notified, created_at

# ═══════════════════════════════════════════════════════════════════════

# IMPLEMENTATION PLAN:

# Step 1: Add cron job to fetch disasters once (not per-user)
# Step 2: Store raw disaster data in database
# Step 3: Query only by distance when user requests
# Step 4: Cache in browser localStorage (JSON)
# Step 5: Update only every 30 minutes (not per request)

# ═══════════════════════════════════════════════════════════════════════

# BROWSER CACHING STRATEGY (localStorage):

BROWSER_CACHE = {
    "disasters": {
        "earthquakes": [...],      # Updated every 30 min
        "floods": [...],           # Updated every 30 min
        "cyclones": [...],         # Updated every 30 min
        "heatwaves": [...]         # Updated every 30 min
        "timestamp": 1234567890    # Check if > 30 min old
    },
    "user_location": {
        "lat": 28.6139,
        "lon": 77.2090,
        "timestamp": 1234567890
    }
}

# Frontend does:
# 1. Load disasters from localStorage
# 2. Calculate distance to each
# 3. Filter by user's notification_radius_km
# 4. Show results instantly (no API call!)
# 5. Every 30 min, fetch fresh data from /api/disasters/cache

# ═══════════════════════════════════════════════════════════════════════
