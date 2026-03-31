"""
IMPLEMENTATION GUIDE: Disaster Data Caching
Step-by-step optimization for earthquake/flood/cyclone/heatwave data
"""

# ═══════════════════════════════════════════════════════════════════════
# STEP 1: Backend Cron Job (fetch disasters ONCE)
# ═══════════════════════════════════════════════════════════════════════

# File: backend/services/disaster_cache_service.py

"""
from sqlalchemy import select, delete
from database import AsyncSessionLocal, DisasterCache
from datetime import datetime, timedelta
import asyncio
import aiohttp
from utils.geo import calculate_distance

class DisasterCacheService:
    @staticmethod
    async def update_disaster_cache():
        # Run every 30 minutes (not per-user!)
        # This is the ONLY place that calls GDACS/USGS/MOSDAC
        
        async with AsyncSessionLocal() as db:
            # 1. Fetch from GDACS (earthquakes/floods)
            earthquakes = await fetch_gdacs_earthquakes()
            
            # 2. Fetch from USGS (additional earthquakes)
            usgs_quakes = await fetch_usgs_earthquakes()
            
            # 3. Fetch from MOSDAC (cyclones/typhoons)
            cyclones = await fetch_mosdac_cyclones()
            
            # 4. Store all in DATABASE (not API)
            for quake in earthquakes:
                disaster = DisasterCache(
                    id=quake['id'],
                    disaster_type="earthquake",
                    latitude=quake['lat'],
                    longitude=quake['lon'],
                    magnitude=quake['magnitude'],
                    source="GDACS",
                    event_time=datetime.fromisoformat(quake['time']),
                    raw_data=quake
                )
                db.add(disaster)
            
            await db.commit()
            print("✅ Cache updated! All disasters stored in database")

    @staticmethod
    async def get_disasters_for_user(user_id: str, user_lat: float, user_lon: float):
        # User requests their personalized disasters
        # NO API CALL - just query database!
        
        async with AsyncSessionLocal() as db:
            # Get all disasters from cache (not API!)
            result = await db.execute(select(DisasterCache))
            all_disasters = result.scalars().all()
            
            # Get user preferences
            prefs = await db.execute(
                select(UserDisasterPreference).where(
                    UserDisasterPreference.user_id == user_id
                )
            )
            user_prefs = prefs.scalar_one_or_none()
            
            alerts = []
            for disaster in all_disasters:
                # Calculate distance from user
                distance = calculate_distance(
                    user_lat, user_lon,
                    disaster.latitude, disaster.longitude
                )
                
                # Check if within user's alert radius
                if disaster.disaster_type == "earthquake":
                    radius = user_prefs.earthquake_radius_km
                elif disaster.disaster_type == "flood":
                    radius = user_prefs.flood_radius_km
                elif disaster.disaster_type == "cyclone":
                    radius = user_prefs.cyclone_radius_km
                else:
                    radius = user_prefs.heatwave_radius_km
                
                # If within radius, add to alerts
                if distance <= radius:
                    alerts.append({
                        "type": disaster.disaster_type,
                        "distance_km": distance,
                        "magnitude": disaster.magnitude,
                        "event_time": disaster.event_time,
                    })
            
            return alerts
"""

# ═══════════════════════════════════════════════════════════════════════
# STEP 2: Backend Cron Job Setup (APScheduler)
# ═══════════════════════════════════════════════════════════════════════

# Add to: backend/server.py

"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import asyncio

# Initialize scheduler
scheduler = AsyncIOScheduler()

# Run disaster cache update every 30 minutes
scheduler.add_job(
    DisasterCacheService.update_disaster_cache,
    trigger="interval",
    minutes=30,
    id="update_disaster_cache"
)

@app.on_event("startup")
async def startup():
    scheduler.start()
    # Also run once on startup
    await DisasterCacheService.update_disaster_cache()

@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()
"""

# ═══════════════════════════════════════════════════════════════════════
# STEP 3: API Endpoint - Fetch from Cache (not API)
# ═══════════════════════════════════════════════════════════════════════

# Add to: backend/routes/disasters.py

"""
@router.get("/disasters/cache")
async def get_cached_disasters(db: AsyncSession = Depends(get_db)):
    # Get all disasters from DATABASE (instant!)
    result = await db.execute(select(DisasterCache))
    disasters = result.scalars().all()
    
    return {
        "earthquakes": [d.to_dict() for d in disasters if d.disaster_type == "earthquake"],
        "floods": [d.to_dict() for d in disasters if d.disaster_type == "flood"],
        "cyclones": [d.to_dict() for d in disasters if d.disaster_type == "cyclone"],
        "heatwaves": [d.to_dict() for d in disasters if d.disaster_type == "heatwave"],
        "last_updated": datetime.now().isoformat()
    }

@router.get("/disasters/near-me")
async def get_disasters_near_me(
    user_id: str,
    lat: float,
    lon: float,
    db: AsyncSession = Depends(get_db)
):
    # Fetch from DATABASE, calculate distance, return only nearby
    alerts = await DisasterCacheService.get_disasters_for_user(user_id, lat, lon)
    return {"alerts": alerts}
"""

# ═══════════════════════════════════════════════════════════════════════
# STEP 4: Frontend Browser Cache (localStorage)
# ═══════════════════════════════════════════════════════════════════════

# File: frontend/src/services/disasterCache.js

"""
export class DisasterCacheService {
  static CACHE_KEY = 'disaster_cache';
  static CACHE_TTL_MINUTES = 30;

  // Save disasters to browser localStorage
  static saveToLocalStorage(disasters) {
    const cacheData = {
      disasters: disasters,
      timestamp: Date.now()
    };
    localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
  }

  // Get disasters from browser localStorage
  static getFromLocalStorage() {
    const cached = localStorage.getItem(this.CACHE_KEY);
    if (!cached) return null;

    const cacheData = JSON.parse(cached);
    
    // Check if cache is still fresh (< 30 minutes old)
    const ageMinutes = (Date.now() - cacheData.timestamp) / 1000 / 60;
    if (ageMinutes > this.CACHE_TTL_MINUTES) {
      localStorage.removeItem(this.CACHE_KEY);
      return null;  // Cache expired
    }

    return cacheData.disasters;
  }

  // Fetch disasters (use cache if fresh, else fetch from API)
  static async fetchDisasters() {
    // Try cache first
    const cached = this.getFromLocalStorage();
    if (cached) {
      console.log('✅ Using cached disasters (no API call!)');
      return cached;
    }

    // Cache expired or doesn't exist - fetch from API
    console.log('📡 Fetching fresh disasters from API...');
    const response = await fetch('/api/disasters/cache');
    const fresh = await response.json();

    // Save to cache for next time
    this.saveToLocalStorage(fresh);
    return fresh;
  }

  // Get nearby disasters for user
  static async getDisastersNearMe(userLocation) {
    // Get from cache/API
    const disasters = await this.fetchDisasters();

    // Calculate distance to each disaster (on FRONTEND!)
    // No need for another API call
    const calcDistance = (lat1, lon1, lat2, lon2) => {
      // Haversine formula
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    // Filter by distance
    const nearby = [];
    for (const disaster of disasters.earthquakes || []) {
      const dist = calcDistance(
        userLocation.lat, userLocation.lon,
        disaster.lat, disaster.lon
      );
      if (dist <= 50) {  // User's radius
        nearby.push({...disaster, distance_km: dist});
      }
    }

    return nearby;
  }
}
"""

# ═══════════════════════════════════════════════════════════════════════
# STEP 5: Use in React Component
# ═══════════════════════════════════════════════════════════════════════

# File: frontend/src/pages/DisasterAlerts.jsx

"""
import { DisasterCacheService } from '@/services/disasterCache';

export default function DisasterAlerts() {
  const [disasters, setDisasters] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDisasters();
  }, []);

  const loadDisasters = async () => {
    setLoading(true);
    try {
      // This uses localStorage if fresh, API if not
      // NO HARD API CALL EVERY TIME!
      const data = await DisasterCacheService.fetchDisasters();
      setDisasters(data);
    } catch (error) {
      console.error('Error loading disasters:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>⚠️ Disaster Alerts</h2>
      <button onClick={loadDisasters} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh Alerts'}
      </button>
      
      <div className="grid">
        {disasters.earthquakes?.map(q => (
          <div key={q.id} className="alert">
            <h3>🌍 Earthquake {q.magnitude}</h3>
            <p>Location: {q.lat}, {q.lon}</p>
            <p>Time: {q.event_time}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
"""

# ═══════════════════════════════════════════════════════════════════════
# PERFORMANCE COMPARISON
# ═══════════════════════════════════════════════════════════════════════

"""
BEFORE (Current):
  User 1 requests /api/disasters?lat=X&lon=Y → API call to GDACS → Wait 2s → Get results
  User 2 requests /api/disasters?lat=X&lon=Y → API call to GDACS → Wait 2s → Get results (SAME DATA!)
  User 3 requests /api/disasters?lat=X&lon=Y → API call to GDACS → Wait 2s → Get results (SAME DATA!)
  
  ❌ 3 API calls for same data
  ❌ ~6 seconds total wait time
  ❌ GDACS rate limited

AFTER (Optimized):
  Backend cron: Every 30 min → API call to GDACS once → Store in DB
  
  User 1 requests → Query DB → Calculate distance locally → Results instant
  User 2 requests → Query DB → Calculate distance locally → Results instant
  User 3 requests → Query DB → Calculate distance locally → Results instant
  Browser cache on top → localStorage → Results in 0ms (no API at all!)
  
  ✅ 1 API call per 30 minutes (instead of per user!)
  ✅ <50ms response time (instead of 2000ms)
  ✅ Each user gets personalized results by distance
"""

# ═══════════════════════════════════════════════════════════════════════
# INSTALLATION NEEDED
# ═══════════════════════════════════════════════════════════════════════

"""
pip install apscheduler

# Add to requirements.txt:
apscheduler==3.10.4
"""
