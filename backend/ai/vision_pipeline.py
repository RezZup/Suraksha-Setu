"""
Vision Pipeline
Image upload → GPT-4o Vision analysis → severity classification → alert safeguard decision.
"""
import asyncio
import os
import uuid
import json
import logging
import random
from typing import Dict, Any
from pathlib import Path

from ai.openai_client import ai_client
from ai.free_model_router import free_model_router

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
VISION_TIMEOUT_SECONDS = float(os.getenv("VISION_TIMEOUT_SECONDS", "12"))
VISION_TEMP_RANDOMIZE_CONFIDENCE = os.getenv("VISION_TEMP_RANDOMIZE_CONFIDENCE", "true").strip().lower() in {"1", "true", "yes", "on"}
VISION_TEMP_CONFIDENCE_MAX = max(0.0, min(1.0, float(os.getenv("VISION_TEMP_CONFIDENCE_MAX", "0.15"))))

VISION_SYSTEM_PROMPT = """You are a disaster image analyst for Suraksha Setu.
Analyze the image and return ONLY valid JSON with these fields:
{
  "disaster_type": "flood"|"fire"|"earthquake"|"cyclone"|"landslide"|"none",
  "severity": "low"|"medium"|"high"|"critical",
  "confidence": 0.0-1.0,
  "description": "brief description of what you see",
  "self_generated_description": "1-2 sentence neutral post-ready description in plain language",
  "objects_detected": ["list", "of", "notable", "objects"],
  "requires_immediate_action": true|false,
  "authenticity": "likely_real"|"suspected_fake"|"uncertain",
  "synthetic_probability": 0.0-1.0,
  "manipulation_signals": ["list of visual clues if any"]
}
Do NOT include anything outside the JSON object."""


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_analysis(payload: Dict[str, Any], fallback_description: str = "") -> Dict[str, Any]:
    disaster_type = str(payload.get("disaster_type", "none") or "none").lower().strip()
    severity = str(payload.get("severity", "low") or "low").lower().strip()

    confidence = max(0.0, min(1.0, _safe_float(payload.get("confidence"), 0.3)))
    synthetic_probability = max(0.0, min(1.0, _safe_float(payload.get("synthetic_probability"), 0.5)))

    authenticity = str(payload.get("authenticity", "uncertain") or "uncertain").lower().strip()
    if authenticity not in {"likely_real", "suspected_fake", "uncertain"}:
        authenticity = "suspected_fake" if synthetic_probability >= 0.7 else "uncertain"

    description = str(payload.get("description") or fallback_description or "")
    generated = str(
        payload.get("self_generated_description")
        or payload.get("generated_description")
        or description
        or ""
    )

    objects_detected = payload.get("objects_detected") or []
    if not isinstance(objects_detected, list):
        objects_detected = []

    manipulation_signals = payload.get("manipulation_signals") or []
    if not isinstance(manipulation_signals, list):
        manipulation_signals = []

    return {
        "disaster_type": disaster_type if disaster_type else "none",
        "severity": severity if severity in {"low", "medium", "high", "critical"} else "low",
        "confidence": confidence,
        "description": description,
        "self_generated_description": generated,
        "objects_detected": objects_detected,
        "requires_immediate_action": bool(payload.get("requires_immediate_action", False)),
        "authenticity": authenticity,
        "synthetic_probability": synthetic_probability,
        "manipulation_signals": manipulation_signals,
    }


def _apply_disaster_guardrails(analysis: Dict[str, Any]) -> Dict[str, Any]:
    """Apply conservative post-processing to avoid over-triggering from weak image cues."""
    adjusted = dict(analysis or {})
    disaster_type = str(adjusted.get("disaster_type") or "none").lower().strip()
    confidence = _safe_float(adjusted.get("confidence"), 0.0)
    severity = str(adjusted.get("severity") or "low").lower().strip()

    description_text = " ".join(
        [
            str(adjusted.get("description") or ""),
            str(adjusted.get("self_generated_description") or ""),
            " ".join(str(x) for x in (adjusted.get("objects_detected") or [])),
        ]
    ).lower()

    fire_cues = ("fire", "flame", "smoke", "blaze", "burn", "burning", "sparks")
    has_fire_cue = any(cue in description_text for cue in fire_cues)

    # Fire false positives are common in low-light scenes. Require stronger evidence.
    if disaster_type == "fire":
        strong_fire_evidence = confidence >= 0.9 and severity in {"high", "critical"} and has_fire_cue
        if not strong_fire_evidence:
            signals = adjusted.get("manipulation_signals") or []
            if not isinstance(signals, list):
                signals = []
            signals.append("weak_fire_evidence")

            adjusted.update(
                {
                    "disaster_type": "none",
                    "severity": "low",
                    "confidence": min(confidence, 0.55),
                    "requires_immediate_action": False,
                    "manipulation_signals": signals,
                }
            )

    return adjusted


def _apply_temp_confidence_override(analysis: Dict[str, Any]) -> Dict[str, Any]:
    """Temporary confidence clamp while model calibration is being fixed."""
    adjusted = dict(analysis or {})
    if not VISION_TEMP_RANDOMIZE_CONFIDENCE:
        return adjusted

    adjusted["confidence"] = round(random.uniform(0.0, VISION_TEMP_CONFIDENCE_MAX), 4)
    adjusted["requires_immediate_action"] = False
    return adjusted


def _fallback_vision_response(
    reason: str,
    user_description: str = "",
    provider: str = "fallback",
    error: str | None = None,
) -> Dict[str, Any]:
    analysis = _normalize_analysis(
        {
            "disaster_type": "none",
            "severity": "low",
            "confidence": 0.0,
            "description": user_description or "Image uploaded. AI image analysis unavailable.",
            "self_generated_description": user_description or "Image shared by community member.",
            "authenticity": "uncertain",
            "synthetic_probability": 0.5,
            "manipulation_signals": ["analysis_unavailable"],
        }
    )
    return {
        "analysis": analysis,
        "decision": {
            "should_notify": False,
            "requires_review": True,
            "suspected_fake": False,
            "reason": reason,
        },
        "generated_description": analysis.get("self_generated_description") or analysis.get("description") or "",
        "usage": None,
        "provider": provider,
        "error": error,
    }


async def analyze_community_image(
    image_source: str,
    user_description: str = "",
) -> Dict[str, Any]:
    """
    Full vision pipeline:
    1. Call GPT-4o Vision on image
    2. Parse structured output
    3. Combine with user description
    4. Run through alert safeguards
    5. Return decision
    """
    # Step 1: Vision analysis
    prompt = VISION_SYSTEM_PROMPT
    if user_description:
        prompt += f"\n\nUser description of event: {user_description}"

    vision_result: Dict[str, Any] | None = None

    free_vision_first = os.getenv("FREE_VISION_FIRST", "false").strip().lower() in {"1", "true", "yes", "on"}
    if free_vision_first and free_model_router.enabled:
        try:
            free_result = await asyncio.wait_for(
                free_model_router.analyze_image(
                    image_source=image_source,
                    prompt=prompt,
                    detail="low",
                ),
                timeout=min(VISION_TIMEOUT_SECONDS, 10.0),
            )
            if not free_result.get("error") and free_result.get("content"):
                vision_result = free_result
                logger.info("Vision analysis served by free provider: %s", free_result.get("provider"))
            else:
                logger.info("Free vision provider unavailable, falling back to OpenAI: %s", free_result.get("error"))
        except asyncio.TimeoutError:
            logger.warning("Free vision provider timeout, falling back to OpenAI")

    if vision_result is None:
        try:
            vision_result = await asyncio.wait_for(
                ai_client.analyze_image(
                    image_source=image_source,
                    prompt=prompt,
                    detail="low",  # save tokens; use "high" for critical review
                ),
                timeout=VISION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return _fallback_vision_response(
                reason="Vision timeout - manual review recommended",
                user_description=user_description,
                provider="timeout",
                error="vision_timeout",
            )

    if vision_result.get("error"):
        logger.warning("Vision provider error: %s", vision_result.get("error"))
        return _fallback_vision_response(
            reason="Vision provider unavailable - manual review recommended",
            user_description=user_description,
            provider=vision_result.get("provider") or "fallback",
            error=vision_result.get("error"),
        )

    # Step 2: Parse JSON from response
    raw = vision_result.get("content", "")
    try:
        # Strip markdown fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        analysis = _normalize_analysis(json.loads(cleaned), fallback_description=raw)
    except json.JSONDecodeError:
        analysis = _normalize_analysis(
            {
                "disaster_type": "none",
                "severity": "low",
                "confidence": 0.3,
                "description": raw,
                "objects_detected": [],
                "requires_immediate_action": False,
                "authenticity": "uncertain",
                "synthetic_probability": 0.5,
                "manipulation_signals": ["unstructured_model_output"],
            }
        )

    analysis = _apply_disaster_guardrails(analysis)
    analysis = _apply_temp_confidence_override(analysis)

    # Step 3: Severity-based decision (inline safeguard)
    severity = analysis.get("severity", "low")
    confidence = _safe_float(analysis.get("confidence"), 0.0)
    authenticity = analysis.get("authenticity", "uncertain")
    synthetic_probability = _safe_float(analysis.get("synthetic_probability"), 0.5)
    suspected_fake = authenticity == "suspected_fake" and synthetic_probability >= 0.65
    has_corroboration = bool(user_description and len(user_description) > 20)

    risk_score = {"low": 0.2, "medium": 0.5, "high": 0.75, "critical": 0.95}.get(severity, 0.3)
    should_notify = (risk_score >= 0.5 and confidence >= 0.5) and not suspected_fake
    requires_review = (
        suspected_fake
        or (0.3 <= risk_score < 0.75)
        or (not has_corroboration and risk_score >= 0.5)
    )

    reason = (
        f"Severity={severity}, confidence={confidence:.2f}, "
        f"authenticity={authenticity}, synthetic_probability={synthetic_probability:.2f}, "
        f"corroboration={has_corroboration}"
    )

    return {
        "analysis": analysis,
        "decision": {
            "should_notify": should_notify,
            "requires_review": requires_review,
            "suspected_fake": suspected_fake,
            "reason": reason,
        },
        "generated_description": analysis.get("self_generated_description") or analysis.get("description") or "",
        "usage": vision_result.get("usage"),
        "provider": vision_result.get("provider") or "openai",
        "error": None,
    }


def save_upload(file_bytes: bytes, extension: str = ".jpg") -> str:
    """Save uploaded bytes and return local path."""
    name = f"{uuid.uuid4().hex}{extension}"
    path = UPLOAD_DIR / name
    path.write_bytes(file_bytes)
    return str(path)
