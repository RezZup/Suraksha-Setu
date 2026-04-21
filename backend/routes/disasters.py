"""
Disasters API Route with MOSDAC Integration + USGS Earthquakes + GDACS
"""
from fastapi import APIRouter, Query, HTTPException
from typing import Optional
import logging
import httpx
import asyncio
import uuid
import os
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

disasters_router = APIRouter(prefix="/api", tags=["Disasters"])

DISASTER_CACHE_TTL_SECONDS = max(
    15,
    int(os.getenv("DISASTER_API_CACHE_TTL_SECONDS", "120")),
)
_DISASTER_CACHE: dict[str, object] = {
    "expires_at": datetime.fromtimestamp(0, tz=timezone.utc),
    "items": [],
}
_DISASTER_CACHE_LOCK = asyncio.Lock()


def _parse_event_datetime(event_date: Optional[str]) -> Optional[datetime]:
    if not event_date:
        return None
    try:
        if len(event_date) == 10:
            return datetime.strptime(event_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(event_date.replace("Z", "+00:00"))
    except Exception:
        return None


async def _persist_disaster_training_rows(disasters: list) -> None:
    """Persist earthquake/flood/heatwave events into dedicated training tables."""
    if not disasters:
        return

    from sqlalchemy import select
    from database import AsyncSessionLocal, EarthquakeDataset, FloodDataset, HeatwaveDataset

    async with AsyncSessionLocal() as db:
        for event in disasters:
            event_type = (event.get("type") or "").lower()
            if event_type not in {"earthquake", "flood", "heatwave"}:
                continue

            external_id = str(event.get("id") or f"{event_type}_{uuid.uuid4().hex[:12]}")
            model = (
                EarthquakeDataset if event_type == "earthquake"
                else FloodDataset if event_type == "flood"
                else HeatwaveDataset
            )

            existing = await db.execute(select(model).where(model.external_id == external_id))
            row = existing.scalar_one_or_none()

            values = {
                "source": event.get("source", "unknown"),
                "title": event.get("title"),
                "event_time": _parse_event_datetime(event.get("date")),
                "event_date": event.get("date"),
                "location": event.get("location"),
                "severity": event.get("severity"),
                "status": event.get("status"),
                "lat": event.get("lat"),
                "lon": event.get("lon"),
                "casualties": event.get("casualties"),
                "affected_population": event.get("affected_population"),
                "description": event.get("description"),
                "raw_payload": event,
            }

            if model is EarthquakeDataset:
                values["magnitude"] = event.get("magnitude")
                values["depth_km"] = event.get("depth_km")
            elif model is HeatwaveDataset:
                values["max_temp_c"] = event.get("max_temp_c")

            if row:
                for key, value in values.items():
                    setattr(row, key, value)
            else:
                db.add(model(id=str(uuid.uuid4()), external_id=external_id, **values))

        await db.commit()

# Historical disaster data baseline
HISTORICAL_DISASTERS = [
    {
        "id": "cyclone_amphan_2020",
        "type": "cyclone",
        "title": "Cyclone Amphan (2020)",
        "date": "2020-05-20",
        "location": "Odisha Coast",
        "severity": "extreme",
        "status": "past",
        "casualties": 26,
        "affected_population": 11000000,
        "damage": "$13.2 billion",
        "description": "Extremely severe cyclonic storm affecting Eastern India",
        "source": "Historical Record",
    },
    {
        "id": "flood_kerala_2023",
        "type": "flood",
        "title": "Kerala Floods 2023",
        "date": "2023-07-15",
        "location": "Kerala",
        "severity": "high",
        "status": "past",
        "casualties": 45,
        "affected_population": 1200000,
        "damage": "$2.8 billion",
        "description": "Severe flooding in Kerala due to heavy monsoon rains",
        "source": "Historical Record",
    },
    {
        "id": "earthquake_manipur_2023",
        "type": "earthquake",
        "title": "Manipur Earthquake 2023",
        "date": "2023-04-14",
        "location": "Kolkata",
        "severity": "severe",
        "status": "past",
        "casualties": 127,
        "affected_population": 500000,
        "damage": "$3.2 billion",
        "description": "Magnitude 6.4 earthquake causing widespread damage",
        "source": "Historical Record",
    },
    {
        "id": "cyclone_biparjoy_2023",
        "type": "cyclone",
        "title": "Cyclone Biparjoy (2023)",
        "date": "2023-06-15",
        "location": "Gujarat",
        "severity": "high",
        "status": "past",
        "casualties": 2,
        "affected_population": 900000,
        "damage": "$1.5 billion",
        "description": "Very severe cyclonic storm affecting Gujarat coast",
        "source": "Historical Record",
    },
    {
        "id": "flood_mumbai_2024",
        "type": "flood",
        "title": "Mumbai Urban Flooding 2024",
        "date": "2024-07-08",
        "location": "Mumbai",
        "severity": "high",
        "status": "past",
        "casualties": 12,
        "affected_population": 3000000,
        "damage": "$800 million",
        "description": "Heavy monsoon rains causing severe urban flooding in Mumbai",
        "source": "Historical Record",
    },
    {
        "id": "heatwave_delhi_2024",
        "type": "heatwave",
        "title": "Delhi NCR Heatwave 2024",
        "date": "2024-05-25",
        "location": "Delhi",
        "severity": "extreme",
        "status": "past",
        "casualties": 98,
        "affected_population": 25000000,
        "damage": "$500 million",
        "description": "Extreme heatwave with temperatures exceeding 49°C",
        "source": "Historical Record",
    },
]

# ─── USGS Earthquake helper ────────────────────────────────────────────────────
async def _fetch_usgs_earthquakes() -> list:
    """Fetch M≥4.0 earthquakes in/around India from USGS in the last 30 days."""
    try:
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=30)
        params = {
            "format": "geojson",
            "starttime": start.strftime("%Y-%m-%d"),
            "endtime": end.strftime("%Y-%m-%d"),
            "minlatitude": 6,
            "maxlatitude": 38,
            "minlongitude": 63,
            "maxlongitude": 100,
            "minmagnitude": 4.0,
            "orderby": "time",
            "limit": 20,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://earthquake.usgs.gov/fdsnws/event/1/query", params=params
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for feat in data.get("features", []):
            props = feat.get("properties", {})
            geo = feat.get("geometry", {}).get("coordinates", [None, None, None])
            mag = props.get("mag", 0) or 0
            place = props.get("place", "India Region")
            ts_ms = props.get("time")
            date_str = (
                datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                if ts_ms else end.strftime("%Y-%m-%d")
            )
            severity = (
                "extreme" if mag >= 7 else
                "high" if mag >= 6 else
                "moderate" if mag >= 5 else
                "low"
            )
            results.append({
                "id": f"usgs_{feat.get('id', '')}",
                "type": "earthquake",
                "title": f"M{mag:.1f} Earthquake – {place}",
                "date": date_str,
                "location": place,
                "lat": geo[1],
                "lon": geo[0],
                "severity": severity,
                "status": "active" if props.get("status") == "reviewed" else "monitoring",
                "casualties": None,
                "affected_population": None,
                "damage": None,
                "description": f"Magnitude {mag:.1f} earthquake at depth {geo[2] or 0:.0f} km. {place}.",
                "magnitude": mag,
                "depth_km": round(geo[2] or 0, 1),
                "source": "USGS",
                "source_raw": feat,
            })
        logger.info("Fetched %d earthquakes from USGS", len(results))
        return results
    except Exception as exc:
        logger.warning("USGS earthquake fetch failed: %s", exc)
        return []


# ─── GDACS real-time global alerts ────────────────────────────────────────────
async def _fetch_gdacs_disasters() -> list:
    """Fetch recent GDACS alerts (cyclones, floods, earthquakes) for South Asia."""
    try:
        async with httpx.AsyncClient(timeout=10, headers={"Accept": "application/json"}) as client:
            resp = await client.get(
                "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP",
                params={"eventtypes": "CY,FL,EQ,TC,DR", "fromdate": (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")},
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        type_map = {"CY": "cyclone", "TC": "cyclone", "FL": "flood", "EQ": "earthquake", "DR": "drought", "VO": "other"}
        severity_map = {"Green": "low", "Orange": "moderate", "Red": "high"}

        for feat in data.get("features", []):
            props = feat.get("properties", {})
            geo = feat.get("geometry", {})
            coords = geo.get("coordinates", [None, None]) if geo.get("type") == "Point" else [None, None]

            # Filter roughly to South Asia
            lat = coords[1] if coords[1] else None
            lon = coords[0] if coords[0] else None
            if lat is not None and (lat < -10 or lat > 40 or lon < 50 or lon > 110):
                continue

            evt_type = type_map.get(props.get("eventtype", ""), "other")
            alert_level = props.get("alertlevel", "Green")
            sev = severity_map.get(alert_level, "low")
            date_str = (props.get("fromdate") or "")[:10] or datetime.now(timezone.utc).strftime("%Y-%m-%d")

            results.append({
                "id": f"gdacs_{props.get('eventid', '')}_{props.get('episodeid', '')}",
                "type": evt_type,
                "title": props.get("eventname") or props.get("name") or f"GDACS {evt_type.title()} Alert",
                "date": date_str,
                "location": props.get("country") or "South Asia",
                "lat": lat,
                "lon": lon,
                "severity": sev,
                "status": "active",
                "casualties": props.get("severitydata", {}).get("deaths") if isinstance(props.get("severitydata"), dict) else None,
                "affected_population": props.get("population"),
                "damage": None,
                "description": props.get("description") or props.get("htmldescription") or "",
                "source": "GDACS",
                "source_raw": feat,
            })
        logger.info("Fetched %d events from GDACS", len(results))
        return results
    except Exception as exc:
        logger.warning("GDACS fetch failed: %s", exc)
        return []


async def _collect_disasters_from_sources() -> list:
    """Fetch, merge and de-duplicate disaster data from all active sources."""
    disasters = list(HISTORICAL_DISASTERS)

    # Fetch real-time data in parallel.
    real_time_results = await asyncio.gather(
        _fetch_usgs_earthquakes(),
        _fetch_gdacs_disasters(),
        return_exceptions=True,
    )

    for result in real_time_results:
        if isinstance(result, list):
            disasters.extend(result)

    # Try MOSDAC if available.
    try:
        from mosdac_service import get_mosdac_service
        from data_transformers import (
            transform_cyclone_data,
            transform_flood_data,
            merge_with_existing_disasters,
        )

        mosdac_service = get_mosdac_service()
        mosdac_disasters = []

        cyclone_entries = await mosdac_service.get_cyclone_data(days_back=14)
        mosdac_disasters.extend(transform_cyclone_data(cyclone_entries))

        flood_entries = await mosdac_service.get_flood_data(days_back=14)
        mosdac_disasters.extend(transform_flood_data(flood_entries))

        if mosdac_disasters:
            disasters = merge_with_existing_disasters(mosdac_disasters, disasters)
            logger.info("Merged %d MOSDAC disasters", len(mosdac_disasters))
    except Exception as e:
        logger.warning("MOSDAC unavailable: %s, using other sources", e)

    # De-duplicate by id.
    seen = set()
    unique = []
    for disaster in disasters:
        disaster_id = disaster.get("id", "")
        if disaster_id in seen:
            continue
        seen.add(disaster_id)
        unique.append(disaster)

    unique.sort(key=lambda x: x.get("date", ""), reverse=True)
    return unique


async def _get_cached_disasters() -> tuple[list, bool]:
    """Return cached disasters if fresh, otherwise refresh cache once."""
    now = datetime.now(timezone.utc)
    cache_items = _DISASTER_CACHE.get("items") or []
    cache_expires = _DISASTER_CACHE.get("expires_at")
    if cache_items and isinstance(cache_expires, datetime) and now < cache_expires:
        return list(cache_items), True

    async with _DISASTER_CACHE_LOCK:
        now = datetime.now(timezone.utc)
        cache_items = _DISASTER_CACHE.get("items") or []
        cache_expires = _DISASTER_CACHE.get("expires_at")
        if cache_items and isinstance(cache_expires, datetime) and now < cache_expires:
            return list(cache_items), True

        refreshed_items = await _collect_disasters_from_sources()
        _DISASTER_CACHE["items"] = refreshed_items
        _DISASTER_CACHE["expires_at"] = now + timedelta(seconds=DISASTER_CACHE_TTL_SECONDS)
        return list(refreshed_items), False


@disasters_router.get("/disasters")
async def get_disasters(
    disaster_type: Optional[str] = None,
    limit: int = Query(default=500, ge=1, le=5000),
    all_points: bool = Query(default=False),
):
    """Get disaster data combining USGS earthquakes, GDACS alerts and MOSDAC satellite data."""
    try:
        disasters, from_cache = await _get_cached_disasters()

        if disaster_type:
            disasters = [
                d for d in disasters if d.get("type", "").lower() == disaster_type.lower()
            ]

        disasters.sort(key=lambda x: x.get("date", ""), reverse=True)

        # Persist once when fresh data is collected, skip cache hits.
        if not from_cache:
            try:
                await _persist_disaster_training_rows(disasters)
            except Exception as persist_err:
                logger.warning("Dataset persistence skipped due to error: %s", persist_err)

        payload = disasters if all_points else disasters[:limit]
        return {
            "disasters": payload,
            "total": len(disasters),
            "returned": len(payload),
            "cached": from_cache,
            "cache_ttl_seconds": DISASTER_CACHE_TTL_SECONDS,
        }

    except Exception as e:
        logger.error(f"Error fetching disasters: {e}")
        raise HTTPException(status_code=500, detail="Unable to load disasters data")
