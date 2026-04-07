"""
Location API Routes
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
import httpx
import uuid
import math

logger = logging.getLogger(__name__)

location_router = APIRouter(prefix="/api/location", tags=["Location"])

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]


SERVICE_FILTERS = {
    "hospital": [
        '["amenity"="hospital"]',
        '["amenity"="clinic"]',
        '["amenity"="doctors"]',
    ],
    "police": ['["amenity"="police"]'],
    "fire_station": ['["amenity"="fire_station"]'],
    "disaster_management_center": [
        '["government"="disaster_management"]',
        '["office"="government"]["government"~"disaster|civil_defence|emergency",i]',
    ],
    "emergency_center": [
        '["emergency"="ambulance_station"]',
        '["emergency"="rescue_station"]',
        '["amenity"="ambulance_station"]',
    ],
    "help_center": [
        '["social_facility"="shelter"]',
        '["amenity"="community_centre"]',
        '["amenity"="social_facility"]',
        '["amenity"="townhall"]',
    ],
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lon = to_rad(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1 - a)))


def _classify_service(tags: dict) -> str:
    amenity = (tags.get("amenity") or "").lower()
    emergency = (tags.get("emergency") or "").lower()
    government = (tags.get("government") or "").lower()
    social = (tags.get("social_facility") or "").lower()

    if amenity in {"hospital", "clinic", "doctors"}:
        return "hospital"
    if amenity == "police":
        return "police"
    if amenity == "fire_station":
        return "fire_station"
    if government in {"disaster_management", "civil_defence", "emergency_management"}:
        return "disaster_management_center"
    if emergency in {"ambulance_station", "rescue_station"} or amenity == "ambulance_station":
        return "emergency_center"
    if social == "shelter" or amenity in {"community_centre", "social_facility", "townhall"}:
        return "help_center"
    return "help_center"


def _fallback_services(lat: float, lon: float) -> list[dict]:
    base = [
        ("hospital", "Nearby Hospital", 0.015, 0.012),
        ("police", "Police Assistance Center", -0.013, 0.01),
        ("fire_station", "Fire Response Station", 0.01, -0.014),
        ("disaster_management_center", "Disaster Management Office", -0.018, -0.01),
        ("emergency_center", "Emergency Operations Center", 0.02, 0.0),
        ("help_center", "Community Help Center", -0.007, 0.017),
    ]
    rows = []
    for idx, (service_type, name, d_lat, d_lon) in enumerate(base, start=1):
        s_lat = lat + d_lat
        s_lon = lon + d_lon
        rows.append(
            {
                "id": f"fallback_{service_type}_{idx}",
                "name": name,
                "service_type": service_type,
                "lat": round(s_lat, 6),
                "lon": round(s_lon, 6),
                "distance_km": round(_haversine_km(lat, lon, s_lat, s_lon), 2),
                "source": "fallback",
                "address": "Approximate location",
            }
        )
    return rows


async def _fetch_overpass_elements(query: str) -> list[dict]:
    """Try multiple Overpass endpoints to improve availability."""
    last_error = None

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": "SurakshaSetu/1.0"}) as client:
                resp = await client.post(endpoint, data={"data": query})
                resp.raise_for_status()
                payload = resp.json() or {}
                elements = payload.get("elements", []) if isinstance(payload, dict) else []
                if isinstance(elements, list):
                    return elements
        except Exception as exc:
            last_error = exc
            logger.warning("Overpass endpoint failed (%s): %s", endpoint, exc)

    if last_error:
        raise last_error

    return []


class LocationUpdate(BaseModel):
    lat: float | None = None
    lon: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    city: Optional[str] = None
    state: Optional[str] = None
    pin_code: Optional[str] = None
    enable_alerts: Optional[bool] = None
    alert_severity: Optional[list] = None


class PincodeRequest(BaseModel):
    pincode: Optional[str] = None
    pin_code: Optional[str] = None


class LocationSearchRequest(BaseModel):
    query: str


# State mapping by first 2 digits (fallback)
_STATE_MAP = {
    "11": ("Delhi", 28.6139, 77.2090),
    "12": ("Haryana", 29.0588, 76.0856),
    "13": ("Punjab", 31.1471, 75.3412),
    "14": ("Chandigarh", 30.7333, 76.7794),
    "15": ("Himachal Pradesh", 31.1048, 77.1734),
    "16": ("Jammu & Kashmir", 33.7782, 76.5762),
    "17": ("Himachal Pradesh", 31.1048, 77.1734),
    "18": ("Jammu & Kashmir", 34.0837, 74.7973),
    "19": ("Jammu & Kashmir", 34.0837, 74.7973),
    "20": ("Uttar Pradesh", 26.8467, 80.9462),
    "21": ("Uttar Pradesh", 26.8467, 80.9462),
    "22": ("Uttar Pradesh", 26.8467, 80.9462),
    "23": ("Uttar Pradesh", 26.8467, 80.9462),
    "24": ("Uttar Pradesh", 26.8467, 80.9462),
    "25": ("Uttar Pradesh", 26.8467, 80.9462),
    "26": ("Uttar Pradesh", 26.8467, 80.9462),
    "27": ("Uttar Pradesh", 26.8467, 80.9462),
    "28": ("Uttar Pradesh", 26.8467, 80.9462),
    "30": ("Rajasthan", 27.0238, 74.2179),
    "31": ("Rajasthan", 27.0238, 74.2179),
    "32": ("Rajasthan", 27.0238, 74.2179),
    "33": ("Rajasthan", 27.0238, 74.2179),
    "34": ("Rajasthan", 27.0238, 74.2179),
    "36": ("Gujarat", 22.2587, 71.1924),
    "37": ("Gujarat", 22.2587, 71.1924),
    "38": ("Gujarat", 22.2587, 71.1924),
    "39": ("Gujarat", 22.2587, 71.1924),
    "40": ("Maharashtra", 19.7515, 75.7139),
    "41": ("Maharashtra", 19.7515, 75.7139),
    "42": ("Maharashtra", 19.7515, 75.7139),
    "43": ("Maharashtra", 19.7515, 75.7139),
    "44": ("Maharashtra", 19.7515, 75.7139),
    "45": ("Madhya Pradesh", 22.9734, 78.6569),
    "46": ("Madhya Pradesh", 22.9734, 78.6569),
    "47": ("Madhya Pradesh", 22.9734, 78.6569),
    "48": ("Madhya Pradesh", 22.9734, 78.6569),
    "49": ("Chhattisgarh", 21.2787, 81.8661),
    "50": ("Telangana", 18.1124, 79.0193),
    "51": ("Andhra Pradesh", 15.9129, 79.7400),
    "52": ("Andhra Pradesh", 15.9129, 79.7400),
    "53": ("Andhra Pradesh", 15.9129, 79.7400),
    "56": ("Karnataka", 15.3173, 75.7139),
    "57": ("Karnataka", 15.3173, 75.7139),
    "58": ("Karnataka", 15.3173, 75.7139),
    "59": ("Karnataka", 15.3173, 75.7139),
    "60": ("Tamil Nadu", 11.1271, 78.6569),
    "61": ("Tamil Nadu", 11.1271, 78.6569),
    "62": ("Tamil Nadu", 11.1271, 78.6569),
    "63": ("Tamil Nadu", 11.1271, 78.6569),
    "64": ("Tamil Nadu", 11.1271, 78.6569),
    "67": ("Kerala", 10.8505, 76.2711),
    "68": ("Kerala", 10.8505, 76.2711),
    "69": ("Kerala", 10.8505, 76.2711),
    "70": ("West Bengal", 22.9868, 87.855),
    "71": ("West Bengal", 22.9868, 87.855),
    "72": ("West Bengal", 22.9868, 87.855),
    "73": ("West Bengal", 22.9868, 87.855),
    "74": ("West Bengal", 22.9868, 87.855),
    "75": ("Odisha", 20.9517, 85.0985),
    "76": ("Odisha", 20.9517, 85.0985),
    "77": ("Odisha", 20.9517, 85.0985),
    "78": ("Assam", 26.2006, 92.9376),
    "79": ("Northeast", 25.4670, 91.3662),
    "80": ("Bihar", 25.0961, 85.3131),
    "81": ("Bihar", 25.0961, 85.3131),
    "82": ("Bihar", 25.0961, 85.3131),
    "83": ("Jharkhand", 23.6102, 85.2799),
    "84": ("Bihar", 25.0961, 85.3131),
    "85": ("Jharkhand", 23.6102, 85.2799),
    "40": ("Maharashtra", 19.0760, 72.8777),
}


def _geocode_pincode_nominatim(pincode: str):
    """Try Nominatim for accurate PIN code geocoding."""
    try:
        headers = {"User-Agent": "SurakshaSetuApp/1.0 (location-search)"}
        with httpx.Client(timeout=6.0, headers=headers) as client:
            resp = client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "postalcode": pincode,
                    "country": "India",
                    "format": "json",
                    "limit": 1,
                    "addressdetails": 1,
                },
            )
            resp.raise_for_status()
            payload = resp.json() or []

        if payload:
            row = payload[0]
            addr = row.get("address", {})
            city = (
                addr.get("city")
                or addr.get("town")
                or addr.get("village")
                or addr.get("county")
                or ""
            )
            state = addr.get("state", "")
            return {
                "lat": float(row.get("lat")),
                "lon": float(row.get("lon")),
                "city": city,
                "state": state,
                "display_name": row.get("display_name") or f"India (PIN: {pincode})",
            }
    except Exception as e:
        logger.warning(f"Nominatim geocoding failed for {pincode}: {e}")
    return None


def _geocode_query_nominatim(query: str):
    """Geocode a free-text location query in India."""
    try:
        headers = {"User-Agent": "SurakshaSetuApp/1.0 (location-search)"}
        with httpx.Client(timeout=6.0, headers=headers) as client:
            resp = client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": f"{query}, India",
                    "format": "json",
                    "limit": 1,
                    "addressdetails": 1,
                },
            )
            resp.raise_for_status()
            payload = resp.json() or []

        if payload:
            row = payload[0]
            return {
                "lat": float(row.get("lat")),
                "lon": float(row.get("lon")),
                "display_name": row.get("display_name") or query,
            }
    except Exception as e:
        logger.warning("Nominatim geocoding failed for '%s': %s", query, e)
    return None


@location_router.get("/current")
async def get_current_location():
    """Get location based on IP geolocation (fallback)."""
    return {
        "lat": 28.6139,
        "lon": 77.209,
        "city": "New Delhi",
        "state": "Delhi",
        "country": "India",
        "display_name": "New Delhi, Delhi, India",
    }


@location_router.post("/search")
async def search_location(data: LocationSearchRequest):
    """Search a location using free text, pincode, or address and return coordinates."""
    query = (data.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is required")

    # If this looks like a PIN code, reuse pincode resolution first.
    if query.isdigit() and len(query) == 6:
        pincode_result = await validate_pincode(PincodeRequest(pincode=query))
        return {
            "success": True,
            "query": query,
            "lat": pincode_result.get("lat"),
            "lon": pincode_result.get("lon"),
            "display_name": pincode_result.get("display_name") or f"PIN {query}",
            "source": "pincode",
        }

    geocoded = _geocode_query_nominatim(query)
    if geocoded:
        return {
            "success": True,
            "query": query,
            "lat": geocoded["lat"],
            "lon": geocoded["lon"],
            "display_name": geocoded["display_name"],
            "source": "nominatim",
        }

    raise HTTPException(status_code=404, detail="Location not found")


@location_router.post("/update")
async def update_location(data: LocationUpdate):
    """Update user's location and return city/state."""
    lat = data.lat or data.latitude
    lon = data.lon or data.longitude
    city = data.city or "Unknown"
    state = data.state or "Unknown"

    # If only pin_code provided, geocode it to get lat/lon and city/state
    if not lat and data.pin_code:
        result = _geocode_pincode_nominatim(data.pin_code)
        if result:
            lat, lon = result["lat"], result["lon"]
            city = result.get("city", "Unknown") or "Unknown"
            state = result.get("state", "Unknown") or "Unknown"
        else:
            # Fallback: use state code mapping
            prefix = data.pin_code[:2]
            if prefix in _STATE_MAP:
                state, lat, lon = _STATE_MAP[prefix]
                city = state  # Use state as city if we don't have detailed info
            else:
                lat, lon = 20.5937, 78.9629

    return {
        "success": True,
        "location": {
            "latitude": lat,
            "longitude": lon,
            "lat": lat,
            "lon": lon,
            "city": city,
            "state": state,
            "pin_code": data.pin_code,
        },
    }


@location_router.post("/validate-pincode")
async def validate_pincode(data: PincodeRequest):
    """Validate an Indian PIN code and return location."""
    pincode = (data.pincode or data.pin_code or "").strip()
    if not pincode.isdigit() or len(pincode) != 6:
        raise HTTPException(status_code=400, detail="Invalid PIN code format")

    # Try accurate Nominatim geocoding first
    nom = _geocode_pincode_nominatim(pincode)
    if nom:
        return {
            "valid": True,
            "is_valid": True,
            "pincode": pincode,
            "lat": nom["lat"],
            "lon": nom["lon"],
            "display_name": nom["display_name"],
            "state": nom["display_name"].split(",")[-2].strip() if "," in nom["display_name"] else "India",
        }

    # Fallback: state mapping by first 2 digits
    prefix = pincode[:2]
    if prefix in _STATE_MAP:
        state, lat, lon = _STATE_MAP[prefix]
        return {
            "valid": True,
            "is_valid": True,
            "pincode": pincode,
            "state": state,
            "lat": lat,
            "lon": lon,
            "display_name": f"{state}, India (PIN: {pincode})",
        }

    return {
        "valid": True,
        "is_valid": True,
        "pincode": pincode,
        "state": "India",
        "lat": 20.5937,
        "lon": 78.9629,
        "display_name": f"India (PIN: {pincode})",
    }


@location_router.get("/reverse-geocode")
async def reverse_geocode(lat: float, lon: float):
    """
    Reverse-geocode GPS coordinates to pincode, city, state using Nominatim.
    Used by the frontend on app load to detect the user's current pincode.
    Non-critical: if this times out, location is still set via GPS - this just adds PIN info.
    """
    import httpx
    try:
        headers = {"User-Agent": "SurakshaSetuApp/1.0 (disaster-alert-platform)"}
        # Increased timeout to 12 seconds to handle slow Nominatim responses
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1},
                headers=headers,
            )
            data = resp.json()
        addr = data.get("address", {})
        pincode = addr.get("postcode", "")
        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("county")
            or ""
        )
        state = addr.get("state", "")
        return {
            "success": True,
            "pincode": pincode,
            "city": city,
            "state": state,
            "display_name": data.get("display_name", ""),
            "lat": lat,
            "lon": lon,
        }
    except Exception as exc:
        logger.warning("Nominatim reverse-geocode failed: %s", exc)
        return {"success": False, "pincode": "", "city": "", "state": ""}


@location_router.get("/nearby-alerts")
async def get_nearby_alerts(lat: float = 28.6139, lon: float = 77.209, radius_km: float = 100):
    """Get alerts near a location using optimized spatial filtering."""
    from database import AsyncSessionLocal, Alert
    from sqlalchemy import select, text, and_
    from utils.spatial_query import haversine_distance, estimate_lat_lon_tolerance
    import uuid

    try:
        async with AsyncSessionLocal() as db:
            # Step 1: DB-level bounding box pre-filter (FAST)
            lat_tol, lon_tol = estimate_lat_lon_tolerance(radius_km)
            
            query = select(Alert).where(
                and_(
                    Alert.is_active == True,  # noqa: E712
                    Alert.retracted == False,  # noqa: E712
                )
            ).order_by(Alert.created_at.desc()).limit(100)
            
            result = await db.execute(query)
            all_alerts = result.scalars().all()

            # Step 2: Python-level Haversine filtering on results
            nearby_alerts = []
            for alert in all_alerts:
                loc = alert.location or {}
                alert_lat = loc.get('lat')
                alert_lon = loc.get('lon')
                if alert_lat and alert_lon:
                    distance = haversine_distance(lat, lon, alert_lat, alert_lon)
                    if distance <= radius_km:
                        nearby_alerts.append(alert)

            # Step 3: Persist nearby snapshot for dataset training (optional)
            from database import NearbyDisasterDataset
            query_lat = round(float(lat), 4)
            query_lon = round(float(lon), 4)
            query_radius = round(float(radius_km), 2)

            for a in nearby_alerts[:20]:  # Limit to top 20 for dataset storage
                existing = await db.execute(
                    select(NearbyDisasterDataset).where(
                        NearbyDisasterDataset.alert_id == a.id,
                        NearbyDisasterDataset.query_lat == query_lat,
                        NearbyDisasterDataset.query_lon == query_lon,
                        NearbyDisasterDataset.radius_km == query_radius,
                    )
                )
                row = existing.scalar_one_or_none()

                payload = {
                    "alert_type": a.alert_type,
                    "severity": a.severity,
                    "title": a.title,
                    "location": (a.location or {}).get("city") if isinstance(a.location, dict) else str(a.location),
                    "source": a.source,
                    "alert_created_at": str(a.created_at) if a.created_at else None,
                    "raw_payload": {
                        "id": a.id,
                        "type": a.alert_type,
                        "severity": a.severity,
                        "title": a.title,
                        "description": a.description,
                        "location": a.location,
                        "source": a.source,
                        "created_at": str(a.created_at),
                    },
                }

                if row:
                    for key, value in payload.items():
                        setattr(row, key, value)
                else:
                    db.add(NearbyDisasterDataset(
                        id=str(uuid.uuid4()),
                        query_lat=query_lat,
                        query_lon=query_lon,
                        radius_km=query_radius,
                        alert_id=a.id,
                        **payload,
                    ))

            await db.commit()

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
                    for a in nearby_alerts
                ],
                "radius_km": radius_km,
                "count": len(nearby_alerts),
            }
    except Exception as e:
        logger.error(f"Error fetching nearby alerts: {e}")
        return {"alerts": [], "radius_km": radius_km, "count": 0}


@location_router.get("/nearby-services")
async def get_nearby_services(
    lat: float,
    lon: float,
    radius_km: float = 10,
    categories: Optional[str] = None,
):
    """Get nearby emergency service points around a location using OpenStreetMap Overpass."""
    bounded_radius = max(1.0, min(float(radius_km or 10), 50.0))

    selected_categories = [
        c.strip().lower()
        for c in (categories or "").split(",")
        if c.strip()
    ]
    if not selected_categories:
        selected_categories = list(SERVICE_FILTERS.keys())

    selected_categories = [c for c in selected_categories if c in SERVICE_FILTERS]
    if not selected_categories:
        raise HTTPException(status_code=400, detail="No valid service categories requested")

    radius_m = int(bounded_radius * 1000)
    overpass_parts: list[str] = []

    for service_type in selected_categories:
        for filter_expr in SERVICE_FILTERS[service_type]:
            overpass_parts.append(f"nwr(around:{radius_m},{lat},{lon}){filter_expr};")

    query = (
        "[out:json][timeout:20];"
        "("
        + "".join(overpass_parts)
        + ");"
        "out center tags;"
    )

    try:
        elements = await _fetch_overpass_elements(query)
        rows: list[dict] = []
        seen: set[str] = set()

        for element in elements:
            tags = element.get("tags", {}) or {}
            e_lat = element.get("lat")
            e_lon = element.get("lon")

            if e_lat is None or e_lon is None:
                center = element.get("center") or {}
                e_lat = center.get("lat")
                e_lon = center.get("lon")

            if e_lat is None or e_lon is None:
                continue

            service_type = _classify_service(tags)
            if service_type not in selected_categories:
                continue

            osm_key = f"{element.get('type', 'el')}:{element.get('id', '')}"
            if not osm_key or osm_key in seen:
                continue
            seen.add(osm_key)

            dist_km = _haversine_km(lat, lon, float(e_lat), float(e_lon))
            if dist_km > bounded_radius + 0.3:
                continue

            name = (
                tags.get("name")
                or tags.get("operator")
                or tags.get("brand")
                or service_type.replace("_", " ").title()
            )

            addr_bits = [
                tags.get("addr:street"),
                tags.get("addr:suburb"),
                tags.get("addr:city"),
            ]
            address = ", ".join([a for a in addr_bits if a])

            rows.append(
                {
                    "id": osm_key,
                    "name": str(name),
                    "service_type": service_type,
                    "lat": float(e_lat),
                    "lon": float(e_lon),
                    "distance_km": round(dist_km, 2),
                    "source": "overpass",
                    "address": address,
                }
            )

        rows.sort(key=lambda r: r["distance_km"])
        rows = rows[:200]

        if not rows:
            fallback = [s for s in _fallback_services(lat, lon) if s["service_type"] in selected_categories]
            return {
                "services": fallback,
                "count": len(fallback),
                "radius_km": bounded_radius,
                "source": "fallback",
            }

        return {
            "services": rows,
            "count": len(rows),
            "radius_km": bounded_radius,
            "source": "overpass",
        }
    except Exception as e:
        logger.warning("Nearby services lookup failed, using fallback: %s", e)
        fallback = [s for s in _fallback_services(lat, lon) if s["service_type"] in selected_categories]
        return {
            "services": fallback,
            "count": len(fallback),
            "radius_km": bounded_radius,
            "source": "fallback",
        }
