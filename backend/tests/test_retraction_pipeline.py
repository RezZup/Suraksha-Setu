"""Tests for alert retraction safety pipeline."""
from backend.risk_engine/retraction_pipeline import AlertRetractionManager

def test_alert_retraction_flow():
    mgr = AlertRetractionManager()
    mgr.register_alert("ALT-001", {"event": "Tsunami Warning", "zone": "Coastal Odisha"})
    assert mgr.active_alerts["ALT-001"]["status"] == "ACTIVE"
    
    notice = mgr.retract_alert("ALT-001", operator_id="admin_01", justification="Sensor calibration false positive")
    assert notice["type"] == "RETRACTION_NOTICE"
    assert mgr.active_alerts["ALT-001"]["status"] == "RETRACTED"
    assert len(mgr.retraction_log) == 1
