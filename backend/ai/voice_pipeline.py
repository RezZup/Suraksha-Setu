"""
Voice Pipeline
Audio upload ? optional FFmpeg normalisation ? STT (Sarvam first, Whisper fallback) ? orchestrator.
"""
import os
import uuid
import shutil
import asyncio
import logging
from typing import Dict, Any
from pathlib import Path

from ai.openai_client import ai_client
from ai.sarvam_client import sarvam_client

logger = logging.getLogger(__name__)

TEMP_AUDIO_DIR = Path(os.getenv("TEMP_AUDIO_DIR", "./temp_audio"))
TEMP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None


async def _normalize_audio(input_path: str) -> str:
    """Normalize audio to mono 16 kHz WAV via FFmpeg (if available)."""
    if not FFMPEG_AVAILABLE:
        logger.warning("FFmpeg not found -- skipping normalisation")
        return input_path

    output_path = str(Path(input_path).with_suffix(".norm.wav"))
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-ar", "16000", "-ac", "1",
        "-acodec", "pcm_s16le",
        output_path,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
    )
    await proc.wait()
    if proc.returncode == 0 and os.path.exists(output_path):
        return output_path
    logger.warning("FFmpeg normalisation failed -- using raw file")
    return input_path


async def process_voice_query(
    audio_bytes: bytes,
    filename: str = "voice.wav",
    role: str = "citizen",
    context: dict = None,
    language: str = None,
) -> Dict[str, Any]:
    """
    Full voice pipeline:
    1. Save temp file
    2. Normalise with FFmpeg
    3. STT: Sarvam Saarika first (no OpenAI token cost), Whisper as fallback
    4. Route transcript through AI orchestrator
    5. Cleanup temp files
    """
    ext = Path(filename).suffix or ".wav"
    temp_path = str(TEMP_AUDIO_DIR / f"{uuid.uuid4().hex}{ext}")
    with open(temp_path, "wb") as f:
        f.write(audio_bytes)

    try:
        # 2. Normalise
        normalised = await _normalize_audio(temp_path)

        # 3. Transcribe -- Sarvam Saarika first (cheap), Whisper fallback
        transcript_result = None
        detected_language = language or "unknown"

        if sarvam_client.enabled:
            try:
                sarvam_result = await asyncio.wait_for(
                    sarvam_client.speech_to_text(normalised, language=language),
                    timeout=10.0,
                )
            except asyncio.TimeoutError:
                sarvam_result = {"error": "Sarvam STT timeout", "text": None}
            if not sarvam_result.get("error") and sarvam_result.get("text"):
                transcript_result = {
                    "text": sarvam_result["text"],
                    "language": sarvam_result.get("language") or language or "hi-IN",
                    "error": None,
                }
                logger.info("STT via Sarvam Saarika")

        if not transcript_result:
            logger.info("Sarvam STT unavailable/failed -- falling back to Whisper")
            try:
                transcript_result = await asyncio.wait_for(
                    ai_client.transcribe_audio(normalised, language=language),
                    timeout=25.0,
                )
            except asyncio.TimeoutError:
                transcript_result = {"error": "Whisper timeout", "text": None}
            if transcript_result.get("error"):
                return {
                    "error": transcript_result["error"],
                    "transcript": None,
                    "response": None,
                }

        transcript = transcript_result["text"]
        detected_language = transcript_result.get("language") or language or "unknown"
        logger.info(f"Transcript: {transcript[:120]}...")

        # 5. Route to orchestrator
        from ai.orchestrator import orchestrator

        ctx = dict(context or {})
        if detected_language and detected_language != "unknown":
            ctx["locale"] = detected_language
            ctx["language"] = detected_language

        try:
            ai_response = await asyncio.wait_for(
                orchestrator.route_request(role, transcript, ctx),
                timeout=25.0,
            )
        except asyncio.TimeoutError:
            ai_response = {
                "message": "I heard you, but AI response took too long. Please try again with a shorter voice query.",
                "usage": None,
            }

        return {
            "transcript": transcript,
            "detected_language": detected_language,
            "response": ai_response.get("message", ""),
            "usage": ai_response.get("usage"),
            "error": None,
        }
    finally:
        # 6. Cleanup
        for p in (temp_path, temp_path.replace(ext, ".norm.wav")):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
