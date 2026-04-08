"""
Free model router.

Provides low-cost/free-first AI inference via:
- Local Ollama models (fully free on your machine)

All methods mirror existing OpenAI client return shape as much as possible
so we can plug this in with minimal changes.
"""

import base64
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, str(default)).strip().lower()
    return raw in {"1", "true", "yes", "on"}


class FreeModelRouter:
    def __init__(self) -> None:
        # Disabled by default to avoid requiring local free-model runtimes.
        self.enabled = _env_flag("FREE_AI_ENABLED", False)

        self.provider_order = [
            p.strip().lower()
            for p in os.getenv("FREE_AI_PROVIDER_ORDER", "ollama").split(",")
            if p.strip()
        ]

        self.ollama_base = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
        self.ollama_timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "15"))
        self.ollama_chat_model = os.getenv("OLLAMA_MODEL_CHAT", "llama3.1:8b-instruct-q4_K_M")
        self.ollama_vision_model = os.getenv("OLLAMA_MODEL_VISION", "llava:7b")

        self.max_image_bytes = int(os.getenv("FREE_AI_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))

    async def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 400,
        temperature: float = 0.4,
    ) -> Dict[str, Any]:
        if not self.enabled:
            return {"error": "free_ai_disabled", "content": None}

        last_error = "No free chat providers configured"

        for provider in self.provider_order:
            if provider == "ollama":
                res = await self._ollama_chat(system_prompt, user_prompt, max_tokens, temperature)
            else:
                continue

            if not res.get("error") and res.get("content"):
                return res
            last_error = res.get("error") or last_error

        return {"error": last_error, "content": None}

    async def analyze_image(
        self,
        image_source: str,
        prompt: str,
        detail: str = "low",
    ) -> Dict[str, Any]:
        if not self.enabled:
            return {"error": "free_ai_disabled", "content": None}

        last_error = "No free vision providers configured"

        for provider in self.provider_order:
            if provider == "ollama":
                res = await self._ollama_vision(image_source=image_source, prompt=prompt)
            else:
                continue

            if not res.get("error") and res.get("content"):
                return res
            last_error = res.get("error") or last_error

        return {"error": last_error, "content": None}

    async def transcribe_audio(self, file_path: str, language: Optional[str] = None) -> Dict[str, Any]:
        """No local free STT provider is currently configured in this router."""
        if not self.enabled:
            return {"error": "free_ai_disabled", "text": None}
        _ = file_path
        _ = language
        return {"error": "free_stt_not_configured", "text": None}

    async def _ollama_chat(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> Dict[str, Any]:
        url = f"{self.ollama_base}/api/chat"
        payload = {
            "model": self.ollama_chat_model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.ollama_timeout) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code >= 400:
                    return {"error": f"ollama_chat_http_{resp.status_code}", "content": None}
                data = resp.json() if resp.text else {}
                msg = data.get("message") or {}
                content = msg.get("content") if isinstance(msg, dict) else None
                if not content:
                    return {"error": "ollama_chat_empty", "content": None}
                return {
                    "error": None,
                    "content": str(content),
                    "provider": "ollama",
                    "model": self.ollama_chat_model,
                    "usage": {"total": 0},
                }
        except Exception as exc:
            return {"error": f"ollama_chat_error:{exc}", "content": None}

    async def _ollama_vision(self, image_source: str, prompt: str) -> Dict[str, Any]:
        image_b64 = await self._image_source_to_base64(image_source)
        if not image_b64:
            return {"error": "ollama_vision_image_not_supported", "content": None}

        url = f"{self.ollama_base}/api/chat"
        payload = {
            "model": self.ollama_vision_model,
            "stream": False,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": [image_b64],
                }
            ],
            "options": {
                "temperature": 0.2,
                "num_predict": 500,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.ollama_timeout) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code >= 400:
                    return {"error": f"ollama_vision_http_{resp.status_code}", "content": None}
                data = resp.json() if resp.text else {}
                msg = data.get("message") or {}
                content = msg.get("content") if isinstance(msg, dict) else None
                if not content:
                    return {"error": "ollama_vision_empty", "content": None}
                return {
                    "error": None,
                    "content": str(content),
                    "provider": "ollama",
                    "model": self.ollama_vision_model,
                    "usage": {"total": 0},
                }
        except Exception as exc:
            return {"error": f"ollama_vision_error:{exc}", "content": None}

    async def _image_source_to_base64(self, image_source: str) -> Optional[str]:
        if not image_source:
            return None

        source = image_source.strip()

        # data:image/...;base64,...
        if source.startswith("data:image") and "," in source:
            return source.split(",", 1)[1]

        # local path
        p = Path(source)
        if p.exists() and p.is_file():
            data = p.read_bytes()
            if len(data) > self.max_image_bytes:
                logger.warning("Image too large for free vision provider (%s bytes)", len(data))
                return None
            return base64.b64encode(data).decode("utf-8")

        # remote URL
        if source.startswith("http://") or source.startswith("https://"):
            try:
                async with httpx.AsyncClient(timeout=min(self.ollama_timeout, 12.0)) as client:
                    resp = await client.get(source)
                    if resp.status_code >= 400:
                        return None
                    data = resp.content
                    if len(data) > self.max_image_bytes:
                        logger.warning("Remote image too large for free vision provider (%s bytes)", len(data))
                        return None
                    return base64.b64encode(data).decode("utf-8")
            except Exception:
                return None

        return None


free_model_router = FreeModelRouter()
