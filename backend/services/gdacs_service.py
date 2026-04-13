"""
GDACS (Global Disaster Alert & Coordination System) RSS ingest parser.
"""

import xml.etree.ElementTree as ET
from typing import List, Dict, Any

class GDACSAlertParser:
    def __init__(self):
        self.severity_map = {
            "Green": 1,
            "Orange": 2,
            "Red": 3
        }

    def parse_xml_feed(self, xml_content: str) -> List[Dict[str, Any]]:
        """Parse GDACS RSS XML feed items."""
        alerts = []
        try:
            root = ET.fromstring(xml_content)
            for item in root.findall(".//item"):
                title = item.findtext("title") or "Unknown Event"
                desc = item.findtext("description") or ""
                link = item.findtext("link") or ""
                
                # Determine severity color
                severity = "Green"
                if "Red" in title or "Red" in desc:
                    severity = "Red"
                elif "Orange" in title or "Orange" in desc:
                    severity = "Orange"
                    
                alerts.append({
                    "title": title,
                    "severity": severity,
                    "score": self.severity_map[severity],
                    "link": link
                })
        except ET.ParseError:
            pass
        return alerts
