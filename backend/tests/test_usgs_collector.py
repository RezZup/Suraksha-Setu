"""Tests for USGS GeoJSON collector."""
from backend.services.usgs_service import USGSEarthquakeCollector

def test_collector_filters_low_magnitudes():
    collector = USGSEarthquakeCollector(min_magnitude=5.0)
    mock_geojson = {
        "features": [
            {"id": "eq1", "properties": {"title": "M 4.2 - Test", "mag": 4.2}, "geometry": {"coordinates": [75.0, 20.0, 10]}},
            {"id": "eq2", "properties": {"title": "M 6.1 - Major", "mag": 6.1}, "geometry": {"coordinates": [85.0, 18.0, 15]}}
        ]
    }
    results = collector.parse_features(mock_geojson)
    assert len(results) == 1
    assert results[0]["id"] == "eq2"
    assert results[0]["magnitude"] == 6.1
