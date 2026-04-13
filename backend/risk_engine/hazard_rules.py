"""
Deterministic hazard evaluation rules.
"""

from typing import Dict, Any, Tuple

def evaluate_earthquake_hazard(magnitude: float, depth_km: float) -> Tuple[str, str]:
    """Return (SeverityLevel, RecommendedAction)."""
    if magnitude >= 7.0 or (magnitude >= 6.2 and depth_km < 15.0):
        return "CRITICAL", "Immediate structural evacuation and open space convergence."
    elif magnitude >= 5.5:
        return "HIGH", "Drop, cover, and hold on; prepare emergency kits."
    elif magnitude >= 4.5:
        return "MODERATE", "Monitor updates; secure unstable hanging items."
    return "LOW", "Routine seismic tremor detected; no immediate danger."

def evaluate_flood_hazard(rainfall_rate_mm_hr: float, river_level_m: float, danger_mark_m: float) -> Tuple[str, str]:
    """Return flood risk severity assessment."""
    if river_level_m >= danger_mark_m or rainfall_rate_mm_hr >= 75.0:
        return "CRITICAL", "Immediate low-lying area evacuation to designated shelter."
    elif river_level_m >= (danger_mark_m - 0.5) or rainfall_rate_mm_hr >= 50.0:
        return "HIGH", "Prepare water barriers and move valuables to upper levels."
    return "LOW", "Normal hydrology parameters."
