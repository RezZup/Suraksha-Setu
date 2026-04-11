# Suraksha Setu Deterministic Risk Engine Specification

Suraksha Setu utilizes a deterministic multi-hazard assessment engine combined with threshold gating to evaluate raw incoming telemetry from USGS, GDACS, and CPCB.

```mermaid
graph TD
    USGS[USGS Earthquake Feed] --> Ingest[Telemetry Ingestion Normalizer]
    GDACS[GDACS RSS Alerts] --> Ingest
    CPCB[CPCB / Weather Sensors] --> Ingest
    Ingest --> RuleEngine[Deterministic Threshold Evaluator]
    RuleEngine --> Scorer[Confidence & Sensor Consensus Engine]
    Scorer --> Gating{Confidence >= 0.85 & Severity >= Moderate?}
    Gating -- Yes --> Broadcast[WebSocket & Push Notification Dispatcher]
    Gating -- No --> HumanLoop[Human-in-the-Loop Review Queue]
    Broadcast --> Retract{False Positive Flagged?}
    Retract -- Yes --> RetractSOP[Automated Retraction Pipeline]
```

## 1. Hazard Scoring Thresholds

- **Earthquake:** Magnitude $\ge 6.0$ OR Depth $\le 20\text{ km}$ triggers Immediate Advisory.
- **Tsunami Warning:** Oceanic epicenter $\text{Magnitude} \ge 7.0$ triggers Red Zone evacuation.
- **Cyclone:** Sustained wind speed $\ge 65\text{ knots}$ (Category 1+).
- **Urban Flood:** Precipitation rate $\ge 65\text{ mm/hr}$ sustained over 3 hours.
