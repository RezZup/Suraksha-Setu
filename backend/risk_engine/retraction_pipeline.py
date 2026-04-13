"""
Emergency alert retraction and false-positive mitigation pipeline.
"""

import time
from typing import Dict, Any, List

class AlertRetractionManager:
    def __init__(self):
        self.active_alerts = {}
        self.retraction_log = []

    def register_alert(self, alert_id: str, payload: Dict[str, Any]):
        self.active_alerts[alert_id] = {
            "payload": payload,
            "dispatched_at": time.time(),
            "status": "ACTIVE"
        }

    def retract_alert(self, alert_id: str, operator_id: str, justification: str) -> Dict[str, Any]:
        """Cancel active alert and dispatch immediate retraction broadcast."""
        if alert_id not in self.active_alerts:
            raise KeyError(f"Alert {alert_id} not found in active registry")
            
        record = self.active_alerts[alert_id]
        record["status"] = "RETRACTED"
        record["retracted_by"] = operator_id
        record["retracted_at"] = time.time()
        record["justification"] = justification
        
        broadcast_msg = {
            "type": "RETRACTION_NOTICE",
            "alert_id": alert_id,
            "message": f"CORRECTION NOTICE: Alert {alert_id} was issued in error and is hereby canceled. {justification}",
            "severity": "NORMAL"
        }
        self.retraction_log.append(record)
        return broadcast_msg
