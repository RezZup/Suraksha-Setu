"""
MOSDAC Metadata Service
Layer 1: Lightweight metadata polling (5-15 min intervals)
Stores metadata in DB without downloading heavy files.
"""
import asyncio
import logging
from typing import Dict, List, Optional
from datetime import datetime, timezone
import uuid
import aiohttp
from database import AsyncSessionLocal, MOSDACMetadata
import os
from sqlalchemy import text, select

logger = logging.getLogger(__name__)

# MOSDAC API Endpoints
SEARCH_URL = "https://mosdac.gov.in/apios/datasets.json"
TOKEN_URL = "https://mosdac.gov.in/download_api/gettoken"

class MOSDACMetadataPoller:
    """
    Layer 1: Polls MOSDAC for metadata only (no file downloads).
    Quota-safe: ~100 requests/day (well under 5000 limit).
    """
    
    def __init__(self):
        self.username = os.getenv("MOSDAC_USERNAME")
        self.password = os.getenv("MOSDAC_PASSWORD")
        self.access_token = None
        
    async def get_token(self) -> Optional[str]:
        """Fetch access token from MOSDAC."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    TOKEN_URL,
                    json={"username": self.username, "password": self.password}
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        self.access_token = data.get("access_token")
                        logger.info("✅ MOSDAC token obtained")
                        return self.access_token
                    else:
                        logger.error(f"❌ MOSDAC auth failed: {response.status}")
                        return None
        except Exception as e:
            logger.error(f"❌ MOSDAC token fetch error: {e}")
            return None
    
    async def poll_metadata(
        self,
        dataset_id: str,
        bounding_box: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None
    ) -> List[Dict]:
        """
        Poll MOSDAC for metadata only.
        Returns list of metadata records (product_id, timestamp, bbox, size).
        """
        params = {"datasetId": dataset_id}
        
        if bounding_box:
            params["boundingBox"] = bounding_box
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(SEARCH_URL, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        entries = data.get("entries", [])
                        
                        metadata_records = []
                        for entry in entries:
                            metadata_records.append({
                                "product_id": entry.get("id"),
                                "identifier": entry.get("identifier"),
                                "dataset_id": dataset_id,
                                "timestamp": entry.get("updated"),
                                "bounding_box": entry.get("geometry", {}).get("coordinates"),
                                "metadata": entry
                            })
                        
                        logger.info(f"📦 Polled {len(metadata_records)} metadata records for {dataset_id}")
                        return metadata_records
                    else:
                        logger.error(f"❌ Metadata poll failed: {response.status}")
                        return []
        except Exception as e:
            logger.error(f"❌ Metadata poll error: {e}")
            return []
    
    async def store_metadata(self, metadata_records: List[Dict]):
        """Store metadata in database."""
        async with AsyncSessionLocal() as db:
            for record in metadata_records:
                # Check if already exists
                stmt = select(MOSDACMetadata).where(MOSDACMetadata.product_id == record['product_id'])
                existing = await db.execute(stmt)
                if existing.first():
                    continue
                
                metadata_entry = MOSDACMetadata(
                    id=str(uuid.uuid4()),
                    product_id=record["product_id"],
                    identifier=record["identifier"],
                    dataset_id=record["dataset_id"],
                    timestamp=datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00")) if record["timestamp"] else None,
                    bounding_box=record["bounding_box"],
                    raw_metadata=record["metadata"],
                    downloaded=False
                )
                db.add(metadata_entry)
            
            await db.commit()
            logger.info(f"💾 Stored {len(metadata_records)} new metadata entries")

# Singleton
metadata_poller = MOSDACMetadataPoller()
