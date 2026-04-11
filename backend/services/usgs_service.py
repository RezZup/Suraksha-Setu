"""
USGS Earthquake real-time GeoJSON feed collector.
"""

import requests
import json
from typing import List, Dict, Any

USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"

class USGSEarthquakeCollector:
    def __init__(self, min_magnitude: float = 4.5):
        self.min_magnitude = min_magnitude
        
    def parse_features(self, geojson_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract relevant earthquake events filtering by magnitude."""
        events = []
        features = geojson_data.get("features", [])
        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            mag = props.get("mag") or 0.0
            
            if mag >= self.min_magnitude:
                coords = geom.get("coordinates", [0, 0, 0])
                events.append({
                    "id": feat.get("id"),
                    "title": props.get("title"),
                    "magnitude": mag,
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "longitude": coords[0],
                    "latitude": coords[1],
                    "depth_km": coords[2],
                    "alert_level": props.get("alert") or "green"
                })
        return events
