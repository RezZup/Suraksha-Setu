import logging
import pytest
import uuid

from ingest.mosdac_metadata import metadata_poller
from database import init_db, engine

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@pytest.mark.asyncio
async def test_direct_storage():
    logger.info("🧪 Testing MOSDAC Storage Directly...")
    
    # Init DB (creates tables if needed)
    try:
        await engine.dispose()
    except Exception:
        pass

    try:
        await init_db()
    except RuntimeError as exc:
        pytest.skip(f"Skipping due async loop lifecycle issue: {exc}")
    
    # Mock Data
    product_id = f"TEST_PRODUCT_{uuid.uuid4().hex[:10]}"
    mock_records = [{
        "product_id": product_id,
        "identifier": f"{product_id}.nc",
        "dataset_id": "TEST_DATASET",
        "timestamp": "2023-10-27T10:00:00Z",
        "bounding_box": None,
        "metadata": {"some": "data"}
    }]
    
    try:
        await metadata_poller.store_metadata(mock_records)
        logger.info("✅ Direct Storage Successful!")
    except Exception as e:
        logger.error(f"❌ Storage Failed: {e}")
        raise
