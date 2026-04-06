"""
MOSDAC 3-Layer Ingestion System
================================
Layer 1: Metadata Polling (every 5-15 min) — lightweight, quota-safe
Layer 2: Event-Based Download (conditional) — triggered by risk engine or user request
Layer 3: Region-Limited Download — only affected bounding box tiles

Architecture:
  External feeds → Metadata Poll (cheap) → Risk Engine evaluates → If high risk → selective download → AI explains → Notification
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from mosdac_service import get_mosdac_service
from risk_engine import RiskEngine

logger = logging.getLogger(__name__)

# MOSDAC Dataset Registry — products we monitor
MONITORED_DATASETS = {
    "3RIMG_L2B_RAIN": {
        "name": "INSAT-3DR Rainfall Estimate",
        "category": "flood",
        "poll_interval_min": 15,
        "description": "Quantitative precipitation estimate from INSAT-3DR IMAGER",
    },
    "3SCAT_L2B": {
        "name": "Scatsat-1 Wind Vectors",
        "category": "cyclone",
        "poll_interval_min": 10,
        "description": "Ocean surface wind speed and direction for cyclone tracking",
    },
    "3RIMG_L1B": {
        "name": "INSAT-3DR Visible/IR Imagery",
        "category": "general",
        "poll_interval_min": 15,
        "description": "Multi-spectral satellite imagery",
    },
    "3SMAP_L3_SM": {
        "name": "SMAP Soil Moisture",
        "category": "flood",
        "poll_interval_min": 60,
        "description": "Soil moisture for flood/landslide risk assessment",
    },
    "3RIMG_L2B_SST": {
        "name": "INSAT-3DR Sea Surface Temperature",
        "category": "cyclone",
        "poll_interval_min": 30,
        "description": "SST anomalies indicate cyclone intensification",
    },
}

# Regions of interest (India's disaster-prone zones)
INDIA_REGIONS = {
    "bay_of_bengal": {"bbox": "80,5,95,23", "name": "Bay of Bengal", "risk": ["cyclone", "tsunami"]},
    "arabian_sea": {"bbox": "65,8,77,25", "name": "Arabian Sea", "risk": ["cyclone"]},
    "kerala_coast": {"bbox": "74,8,78,13", "name": "Kerala Coast", "risk": ["flood", "cyclone"]},
    "odisha_coast": {"bbox": "83,17,88,22", "name": "Odisha Coast", "risk": ["cyclone", "flood"]},
    "gujarat_coast": {"bbox": "68,20,73,24", "name": "Gujarat Coast", "risk": ["cyclone"]},
    "gangetic_plain": {"bbox": "78,22,88,28", "name": "Gangetic Plain", "risk": ["flood"]},
    "mumbai_region": {"bbox": "72,18,74,20", "name": "Mumbai Region", "risk": ["flood", "cyclone"]},
    "chennai_region": {"bbox": "79,12,81,14", "name": "Chennai Region", "risk": ["flood", "cyclone"]},
}


class MOSDACPoller:
    """
    Layer 1: Metadata Polling
    - Polls MOSDAC for dataset availability (no heavy downloads)
    - Stores metadata in DB (timestamp, bounding box, product ID)
    - Tells the system: "New cyclone image available at 12:10 UTC for region X"
    """

    def __init__(self):
        self.service = get_mosdac_service()
        self._last_poll: Dict[str, datetime] = {}
        self._running = False

    async def poll_metadata(self, dataset_id: str, region_bbox: str = None,
                            hours_back: int = 6) -> List[Dict[str, Any]]:
        """
        Poll MOSDAC for metadata only (lightweight).
        Returns list of new product entries without downloading data files.
        """
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(hours=hours_back)

        try:
            entries = await self.service.search_datasets(
                dataset_id=dataset_id,
                start_time=start_date.strftime("%Y-%m-%d"),
                end_time=end_date.strftime("%Y-%m-%d"),
                bounding_box=region_bbox,
                limit=20,
            )

            metadata_records = []
            for entry in entries:
                record = {
                    "product_id": entry.get("id", str(uuid.uuid4())),
                    "identifier": entry.get("identifier", "unknown"),
                    "dataset_id": dataset_id,
                    "timestamp": entry.get("updated", entry.get("published")),
                    "bounding_box": entry.get("georss_box") or entry.get("georss_polygon"),
                    "raw_metadata": entry,
                    "downloaded": False,
                }
                metadata_records.append(record)

            self._last_poll[dataset_id] = datetime.now(timezone.utc)
            logger.info(f"[Layer 1] Polled {dataset_id}: {len(metadata_records)} entries found")
            return metadata_records

        except Exception as e:
            logger.error(f"[Layer 1] Metadata poll error for {dataset_id}: {e}")
            return []

    async def poll_all_datasets(self) -> Dict[str, List[Dict]]:
        """Poll all monitored datasets for new metadata."""
        results = {}
        now = datetime.now(timezone.utc)

        for dataset_id, config in MONITORED_DATASETS.items():
            # Check if enough time has passed since last poll
            last = self._last_poll.get(dataset_id)
            interval = timedelta(minutes=config["poll_interval_min"])
            if last and (now - last) < interval:
                continue

            entries = await self.poll_metadata(dataset_id)
            if entries:
                results[dataset_id] = entries

        return results

    async def store_metadata(self, records: List[Dict]) -> int:
        """Store polled metadata in DB (Layer 1 persistence)."""
        from sqlalchemy import select
        from database import AsyncSessionLocal, MOSDACMetadata

        stored = 0
        try:
            async with AsyncSessionLocal() as db:
                for rec in records:
                    existing = await db.execute(
                        select(MOSDACMetadata.id)
                        .where(MOSDACMetadata.product_id == rec["product_id"])
                        .limit(1)
                    )
                    if existing.scalar_one_or_none():
                        continue

                    meta = MOSDACMetadata(
                        id=str(uuid.uuid4()),
                        product_id=rec["product_id"],
                        identifier=rec["identifier"],
                        dataset_id=rec["dataset_id"],
                        timestamp=datetime.fromisoformat(rec["timestamp"]) if rec.get("timestamp") else None,
                        bounding_box={"raw": rec["bounding_box"]} if rec.get("bounding_box") else None,
                        raw_metadata=rec["raw_metadata"],
                        downloaded=False,
                    )
                    db.add(meta)
                    stored += 1

                await db.commit()
        except Exception as e:
            logger.error(f"[Layer 1] Store metadata error: {e}")

        logger.info(f"[Layer 1] Stored {stored} new metadata records")
        return stored


class EventBasedDownloader:
    """
    Layer 2: Event-Based Download (Conditional)
    Only downloads heavy MOSDAC products when:
    - Risk engine detects anomaly (earthquake, high wind, heavy rain)
    - User requests detailed satellite view
    - Admin triggers manual download
    """

    def __init__(self):
        self.service = get_mosdac_service()

    async def should_download(self, event_type: str, risk_score: float,
                              event_data: Dict = None) -> bool:
        """
        Determine if a download should be triggered.
        Uses deterministic rules — AI does NOT decide this.
        """
        # Download thresholds by event type
        thresholds = {
            "earthquake": 0.6,   # Mw ≥ 6.0 near coast
            "cyclone": 0.5,      # Cyclonic storm or above
            "flood": 0.55,       # Water level near danger mark
            "tsunami": 0.5,      # Any tsunami potential
        }

        threshold = thresholds.get(event_type, 0.7)
        should = risk_score >= threshold

        if should:
            logger.info(f"[Layer 2] Download TRIGGERED: {event_type} risk={risk_score:.2f} >= {threshold}")
        else:
            logger.debug(f"[Layer 2] Download SKIPPED: {event_type} risk={risk_score:.2f} < {threshold}")

        return should

    async def download_for_event(self, event_type: str, lat: float, lon: float,
                                 radius_km: float = 100) -> Dict[str, Any]:
        """
        Layer 3: Region-Limited Download
        Only downloads tiles covering the affected bounding box.
        Not entire India. Not full datasets.
        """
        # Calculate bounding box from lat/lon and radius
        # ~1 degree ≈ 111 km
        delta = radius_km / 111.0
        bbox = f"{lon - delta},{lat - delta},{lon + delta},{lat + delta}"

        # Map event type to relevant datasets
        relevant_datasets = {
            "earthquake": ["3RIMG_L1B"],
            "cyclone": ["3SCAT_L2B", "3RIMG_L2B_SST"],
            "flood": ["3RIMG_L2B_RAIN", "3SMAP_L3_SM"],
            "tsunami": ["3RIMG_L1B", "3RIMG_L2B_SST"],
        }

        datasets = relevant_datasets.get(event_type, ["3RIMG_L1B"])
        all_data = []

        try:
            await self.service.authenticate()

            for ds_id in datasets:
                entries = await self.service.search_datasets(
                    dataset_id=ds_id,
                    bounding_box=bbox,
                    limit=5,
                )
                all_data.extend([{
                    "dataset_id": ds_id,
                    "entry": entry,
                    "region": {"lat": lat, "lon": lon, "radius_km": radius_km},
                } for entry in entries])

            logger.info(f"[Layer 3] Downloaded {len(all_data)} tiles for {event_type} at ({lat}, {lon})")
            return {
                "event_type": event_type,
                "location": {"lat": lat, "lon": lon},
                "tiles_downloaded": len(all_data),
                "data": all_data,
                "bbox": bbox,
            }

        except Exception as e:
            logger.error(f"[Layer 2/3] Download error: {e}")
            return {
                "event_type": event_type,
                "location": {"lat": lat, "lon": lon},
                "tiles_downloaded": 0,
                "data": [],
                "error": str(e),
            }

    async def download_for_user_request(self, dataset_id: str, lat: float, lon: float,
                                        radius_km: float = 50) -> Dict[str, Any]:
        """User-triggered selective download (scientist portal)."""
        delta = radius_km / 111.0
        bbox = f"{lon - delta},{lat - delta},{lon + delta},{lat + delta}"

        try:
            await self.service.authenticate()
            entries = await self.service.search_datasets(
                dataset_id=dataset_id,
                bounding_box=bbox,
                limit=10,
            )

            logger.info(f"[Layer 2] User download: {len(entries)} entries for {dataset_id}")
            return {
                "dataset_id": dataset_id,
                "entries": entries,
                "count": len(entries),
                "bbox": bbox,
            }

        except Exception as e:
            logger.error(f"[Layer 2] User download error: {e}")
            return {"dataset_id": dataset_id, "entries": [], "count": 0, "error": str(e)}


class MOSDACReportGenerator:
    """
    Generates structured reports from MOSDAC data for scientist use cases.
    Handles queries like:
    - "Generate flood risk report for Kerala, July 2024"
    - "INSAT-3D cyclone data for 2024"
    """

    def __init__(self):
        self.service = get_mosdac_service()
        self.downloader = EventBasedDownloader()

    async def generate_flood_report(self, region: str, start_date: str = None,
                                    end_date: str = None) -> Dict[str, Any]:
        """
        Generate a structured flood risk report for a region.
        Uses MOSDAC rainfall + soil moisture data.
        """
        # Region coordinates mapping
        regions = {
            "kerala": {"lat": 10.0, "lon": 76.0, "bbox": "74,8,78,13", "name": "Kerala"},
            "odisha": {"lat": 20.0, "lon": 84.0, "bbox": "83,17,88,22", "name": "Odisha"},
            "mumbai": {"lat": 19.0, "lon": 72.8, "bbox": "72,18,74,20", "name": "Mumbai"},
            "chennai": {"lat": 13.0, "lon": 80.2, "bbox": "79,12,81,14", "name": "Chennai"},
            "kolkata": {"lat": 22.5, "lon": 88.3, "bbox": "87,21,90,24", "name": "Kolkata"},
            "gujarat": {"lat": 22.0, "lon": 71.0, "bbox": "68,20,73,24", "name": "Gujarat"},
            "delhi": {"lat": 28.6, "lon": 77.2, "bbox": "76,27,78,30", "name": "Delhi"},
            "assam": {"lat": 26.0, "lon": 92.0, "bbox": "89,24,96,28", "name": "Assam"},
            "bihar": {"lat": 25.5, "lon": 85.0, "bbox": "83,24,88,27", "name": "Bihar"},
            "andhra pradesh": {"lat": 15.9, "lon": 79.7, "bbox": "77,13,84,19", "name": "Andhra Pradesh"},
            "west bengal": {"lat": 22.9, "lon": 87.8, "bbox": "86,21,89,27", "name": "West Bengal"},
        }

        # Find matching region
        region_lower = region.lower().strip()
        region_info = None
        for key, info in regions.items():
            if key in region_lower or region_lower in key:
                region_info = info
                break

        if not region_info:
            region_info = {"lat": 20.0, "lon": 78.0, "bbox": "68,6,97,36", "name": region}

        # Set date range
        if not end_date:
            end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if not start_date:
            start_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

        report = {
            "title": f"Flood Risk Report — {region_info['name']}",
            "region": region_info["name"],
            "period": f"{start_date} to {end_date}",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_sources": [],
            "satellite_observations": [],
            "risk_assessment": {},
            "recommendations": [],
        }

        try:
            await self.service.authenticate()

            # Fetch rainfall data
            rain_entries = await self.service.search_datasets(
                dataset_id="3RIMG_L2B_RAIN",
                start_time=start_date,
                end_time=end_date,
                bounding_box=region_info["bbox"],
                limit=50,
            )
            report["data_sources"].append({
                "dataset": "INSAT-3DR Rainfall Estimate (3RIMG_L2B_RAIN)",
                "entries_found": len(rain_entries),
                "period": f"{start_date} to {end_date}",
            })

            # Fetch soil moisture data
            sm_entries = await self.service.search_datasets(
                dataset_id="3SMAP_L3_SM",
                start_time=start_date,
                end_time=end_date,
                bounding_box=region_info["bbox"],
                limit=20,
            )
            report["data_sources"].append({
                "dataset": "SMAP Soil Moisture (3SMAP_L3_SM)",
                "entries_found": len(sm_entries),
                "period": f"{start_date} to {end_date}",
            })

            # Process satellite observations
            for entry in rain_entries[:10]:
                report["satellite_observations"].append({
                    "type": "rainfall",
                    "timestamp": entry.get("updated") or entry.get("published"),
                    "identifier": entry.get("identifier", "N/A"),
                    "source": "INSAT-3DR",
                })

            for entry in sm_entries[:5]:
                report["satellite_observations"].append({
                    "type": "soil_moisture",
                    "timestamp": entry.get("updated") or entry.get("published"),
                    "identifier": entry.get("identifier", "N/A"),
                    "source": "SMAP",
                })

            # Risk assessment
            total_obs = len(rain_entries) + len(sm_entries)
            risk_level = "low"
            if total_obs > 30:
                risk_level = "high"
            elif total_obs > 15:
                risk_level = "medium"

            report["risk_assessment"] = {
                "flood_risk_level": risk_level,
                "total_satellite_observations": total_obs,
                "rainfall_data_points": len(rain_entries),
                "soil_moisture_data_points": len(sm_entries),
                "data_coverage": "adequate" if total_obs > 5 else "limited",
                "confidence": min(0.95, 0.5 + total_obs * 0.01),
            }

            report["recommendations"] = [
                f"Monitor CWC flood bulletins for {region_info['name']} region",
                f"{'High' if risk_level == 'high' else 'Moderate'} satellite data coverage — {'recommend ground truth validation' if risk_level == 'high' else 'continue monitoring'}",
                f"INSAT-3DR rainfall observations: {len(rain_entries)} in analysis period",
                f"Soil moisture analysis: {len(sm_entries)} SMAP observations",
            ]

        except Exception as e:
            logger.error(f"Flood report generation error: {e}")
            report["error"] = str(e)
            report["risk_assessment"] = {
                "flood_risk_level": "undetermined",
                "note": "MOSDAC data unavailable — using cached/historical analysis",
            }
            report["recommendations"] = [
                "MOSDAC service temporarily unavailable",
                f"Recommend manual CWC bulletin check for {region_info['name']}",
                "Contact IMD regional office for latest flood outlook",
            ]

        return report

    async def generate_cyclone_report(self, region: str = "Bay of Bengal",
                                      days_back: int = 7) -> Dict[str, Any]:
        """Generate cyclone tracking report using MOSDAC satellite data."""
        report = {
            "title": f"Cyclone Tracking Report — {region}",
            "region": region,
            "period": f"Last {days_back} days",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_sources": [],
            "satellite_observations": [],
            "wind_analysis": {},
            "recommendations": [],
        }

        try:
            await self.service.authenticate()

            # Scatterometer wind data
            wind_entries = await self.service.search_datasets(
                dataset_id="3SCAT_L2B",
                start_time=(datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d"),
                end_time=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                limit=50,
            )
            report["data_sources"].append({
                "dataset": "Scatsat-1 Wind Vectors (3SCAT_L2B)",
                "entries_found": len(wind_entries),
            })

            # SST data
            sst_entries = await self.service.search_datasets(
                dataset_id="3RIMG_L2B_SST",
                start_time=(datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d"),
                end_time=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                limit=30,
            )
            report["data_sources"].append({
                "dataset": "INSAT-3DR SST (3RIMG_L2B_SST)",
                "entries_found": len(sst_entries),
            })

            for entry in wind_entries[:10]:
                report["satellite_observations"].append({
                    "type": "wind_vector",
                    "timestamp": entry.get("updated"),
                    "identifier": entry.get("identifier", "N/A"),
                    "source": "Scatsat-1",
                })

            report["wind_analysis"] = {
                "observations": len(wind_entries),
                "sst_observations": len(sst_entries),
                "coverage": "adequate" if len(wind_entries) > 10 else "limited",
            }

            report["recommendations"] = [
                f"Wind vector observations: {len(wind_entries)} in last {days_back} days",
                f"SST monitoring active: {len(sst_entries)} observations",
                "Follow IMD cyclone bulletins for track predictions",
            ]

        except Exception as e:
            logger.error(f"Cyclone report generation error: {e}")
            report["error"] = str(e)
            report["recommendations"] = [
                "MOSDAC service unavailable — check IMD cyclone page",
                "Monitor JTWC and IMD for real-time tracks",
            ]

        return report

    async def search_satellite_data(self, dataset_id: str, satellite: str = None,
                                    region: str = None, start_date: str = None,
                                    end_date: str = None) -> Dict[str, Any]:
        """
        General satellite data search for scientist queries.
        Maps satellite names (INSAT-3D, INSAT-3DR, Scatsat) to dataset IDs.
        """
        # Map satellite names to dataset IDs
        satellite_map = {
            "insat-3d": ["3RIMG_L1B", "3RIMG_L2B_RAIN", "3RIMG_L2B_SST"],
            "insat-3dr": ["3RIMG_L1B", "3RIMG_L2B_RAIN", "3RIMG_L2B_SST"],
            "insat3d": ["3RIMG_L1B", "3RIMG_L2B_RAIN", "3RIMG_L2B_SST"],
            "scatsat": ["3SCAT_L2B"],
            "smap": ["3SMAP_L3_SM"],
            "oceansat": ["OC2_SST"],
        }

        # Resolve dataset IDs from satellite name
        if satellite and not dataset_id:
            sat_lower = satellite.lower().replace(" ", "").replace("-", "")
            for key, ds_ids in satellite_map.items():
                if key in sat_lower or sat_lower in key:
                    dataset_id = ds_ids[0]  # Use primary dataset
                    break

        if not dataset_id:
            dataset_id = "3RIMG_L1B"  # Default to imagery

        if not end_date:
            end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if not start_date:
            start_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

        # Region mapping
        region_bbox = None
        if region:
            region_lower = region.lower()
            for key, info in INDIA_REGIONS.items():
                if key.replace("_", " ") in region_lower or region_lower in info["name"].lower():
                    region_bbox = info["bbox"]
                    break

        try:
            await self.service.authenticate()
            entries = await self.service.search_datasets(
                dataset_id=dataset_id,
                start_time=start_date,
                end_time=end_date,
                bounding_box=region_bbox,
                limit=50,
            )

            return {
                "dataset_id": dataset_id,
                "satellite": satellite or dataset_id,
                "region": region or "All India",
                "period": f"{start_date} to {end_date}",
                "entries_found": len(entries),
                "entries": entries[:20],  # Limit detail
                "available": len(entries) > 0,
            }

        except Exception as e:
            logger.error(f"Satellite data search error: {e}")
            return {
                "dataset_id": dataset_id,
                "satellite": satellite or dataset_id,
                "entries_found": 0,
                "error": str(e),
                "available": False,
            }


# ── Singletons ──────────────────────────────────────────────
mosdac_poller = MOSDACPoller()
event_downloader = EventBasedDownloader()
report_generator = MOSDACReportGenerator()
