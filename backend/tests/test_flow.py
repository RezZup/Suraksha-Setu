from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ingest.manager import IngestionManager


@pytest.mark.asyncio
async def test_end_to_end_flow():
    mock_quake = {
        "magnitude": 7.5,
        "depth_km": 10.0,
        "lat": 10.0,
        "lon": 80.0,
        "place": "Test Location",
        "time": 1234567890,
    }

    fake_db = MagicMock()
    fake_db.commit = AsyncMock()

    with (
        patch("ingest.manager.fetch_earthquakes", new=AsyncMock(return_value=[mock_quake])) as mock_fetch,
        patch("ingest.manager.alert_dispatcher.dispatch", new=AsyncMock()) as mock_dispatch,
        patch("ingest.manager.grid_risk_service.invalidate_region", return_value=None),
        patch(
            "ingest.manager.AlertDecisionEngine.evaluate_event",
            return_value={
                "should_notify": True,
                "event_type": "tsunami",
                "severity": "critical",
                "action": "auto_alert",
                "risk_score": 0.95,
                "ensemble": {"ensemble_score": 0.95},
            },
        ),
    ):
        await IngestionManager.run_ingest_cycle(fake_db)

    mock_fetch.assert_awaited_once()
    assert fake_db.add.called
    fake_db.commit.assert_awaited_once()
    mock_dispatch.assert_awaited_once()
