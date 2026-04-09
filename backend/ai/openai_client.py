
import os
import io
import logging
import hashlib
import json
import uuid
import base64
import mimetypes
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from pathlib import Path

from openai import AsyncOpenAI, APIError, RateLimitError
from utils.redis_client import redis_client

logger = logging.getLogger(__name__)

# ─── Configuration ──────────────────────────────────────────
MODEL_MINI = os.getenv("OPENAI_MODEL_MINI", "gpt-4o-mini")
MODEL_HEAVY = os.getenv("OPENAI_MODEL_HEAVY", "gpt-4o")
EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
MAX_TOKENS_PER_REQ = int(os.getenv("OPENAI_MAX_TOKENS_PER_REQUEST", "1000"))
TOTAL_TOKEN_LIMIT = int(os.getenv("OPENAI_TOTAL_TOKEN_LIMIT", "500000"))
REDIS_TOKEN_KEY = "openai:total_tokens_used"
GOOGLE_BASE_URL = os.getenv("GOOGLE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
GOOGLE_MODEL_CHAT = os.getenv("GOOGLE_MODEL_CHAT", "gemini-2.0-flash")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_VISION_MODEL = os.getenv("OPENROUTER_MODEL_VISION", "openai/gpt-4o-mini")
OPENROUTER_CHAT_MODEL = os.getenv("OPENROUTER_MODEL_CHAT", "openai/gpt-4o-mini")
OPENROUTER_SITE_URL = os.getenv("OPENROUTER_SITE_URL", "")
OPENROUTER_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "Suraksha Setu")


class OpenAIClient:
    """
    Unified OpenAI wrapper with:
    - Chat completions (mini & heavy models)
    - Function Calling with structured JSON
    - Whisper speech-to-text
    - GPT-4o Vision image analysis
    - text-embedding-3-small embeddings
    - TTS text-to-speech
    - Redis caching + token budget enforcement
    """

    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key or self.api_key.startswith("mock"):
            logger.warning("⚠️  OPENAI_API_KEY not set or mock. OpenAI endpoints are disabled.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=self.api_key)
            logger.info("✅ OpenAI Client Initialized")

        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
        self.openrouter_client = None
        if self.openrouter_api_key and not self.openrouter_api_key.startswith("mock"):
            try:
                extra_headers = {}
                if OPENROUTER_SITE_URL:
                    extra_headers["HTTP-Referer"] = OPENROUTER_SITE_URL
                if OPENROUTER_APP_NAME:
                    extra_headers["X-Title"] = OPENROUTER_APP_NAME

                self.openrouter_client = AsyncOpenAI(
                    api_key=self.openrouter_api_key,
                    base_url=OPENROUTER_BASE_URL,
                    default_headers=extra_headers,
                )
                logger.info("✅ OpenRouter Vision client initialized")
            except Exception as e:
                logger.warning("⚠️  OpenRouter client init failed: %s", e)

        self.google_api_key = os.getenv("GOOGLE_API_KEY")
        self.google_client = None
        if self.google_api_key and not self.google_api_key.startswith("mock"):
            try:
                self.google_client = AsyncOpenAI(
                    api_key=self.google_api_key,
                    base_url=GOOGLE_BASE_URL,
                )
                logger.info("✅ Google Gemini chat client initialized")
            except Exception as e:
                logger.warning("⚠️  Google client init failed: %s", e)

        if not self.client and not self.openrouter_client and not self.google_client:
            logger.warning(
                "⚠️  No AI provider keys configured. Set OPENAI_API_KEY, OPENROUTER_API_KEY, or GOOGLE_API_KEY."
            )

    # ═══════════════════════════════════════════════════════════
    #  TOKEN BUDGET
    # ═══════════════════════════════════════════════════════════
    async def _check_budget(self, estimated_tokens: int = 500) -> bool:
        """Check if we have enough budget remaining."""
        try:
            r = await redis_client.get_client()
            if r:
                used = int(await r.get(REDIS_TOKEN_KEY) or 0)
                if used + estimated_tokens > TOTAL_TOKEN_LIMIT:
                    logger.error(f"🚨 TOKEN BUDGET EXCEEDED: {used}/{TOTAL_TOKEN_LIMIT}")
                    return False
                return True
        except Exception:
            pass
        return True  # allow if Redis is down

    async def _record_usage(self, tokens: int, model: str, endpoint: str,
                            user_id: str = None, cached: bool = False):
        """Increment Redis counter and log to DB."""
        try:
            r = await redis_client.get_client()
            if r:
                await r.incrby(REDIS_TOKEN_KEY, tokens)
        except Exception:
            pass
        # DB logging handled by caller or orchestrator
        logger.info(f"📊 Tokens: +{tokens} | model={model} | endpoint={endpoint}")

    # ═══════════════════════════════════════════════════════════
    #  CHAT COMPLETIONS (mini / heavy)
    # ═══════════════════════════════════════════════════════════
    async def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = None,
        max_tokens: int = None,
        temperature: float = 0.7,
        tools: List[Dict] = None,
        json_mode: bool = False,
        use_heavy: bool = False,
    ) -> Dict[str, Any]:
        """
        Core chat completion.
        - model defaults to MODEL_MINI or MODEL_HEAVY when use_heavy=True
        - max_tokens capped by MAX_TOKENS_PER_REQ
        """
        if not self.client:
            return {"error": "OpenAI client not initialized", "content": None}

        model = model or (MODEL_HEAVY if use_heavy else MODEL_MINI)
        max_tokens = min(max_tokens or MAX_TOKENS_PER_REQ, MAX_TOKENS_PER_REQ)

        # Budget check
        if not await self._check_budget(max_tokens):
            return {"error": "Token budget exceeded", "content": None}

        # Cache check
        cache_key = self._cache_key(system_prompt, user_prompt, model)
        cached = await self._cache_get(cache_key)
        if cached:
            return cached

        try:
            kwargs: Dict[str, Any] = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = await self.client.chat.completions.create(**kwargs)
            msg = response.choices[0].message
            usage = response.usage

            result = {
                "content": msg.content,
                "tool_calls": [
                    {"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in (msg.tool_calls or [])
                ] or None,
                "usage": {
                    "prompt": usage.prompt_tokens,
                    "completion": usage.completion_tokens,
                    "total": usage.total_tokens,
                },
                "model": model,
                "error": None,
            }

            await self._record_usage(usage.total_tokens, model, "chat")
            if not result["tool_calls"]:
                await self._cache_set(cache_key, result)
            return result

        except RateLimitError:
            logger.error("🚫 OpenAI rate-limit hit")
            return {"error": "Rate limit exceeded. Please try again shortly.", "content": None}
        except APIError as e:
            logger.error(f"OpenAI API error: {e}")
            return {"error": str(e), "content": None}
        except Exception as e:
            logger.error(f"Unexpected OpenAI error: {e}")
            return {"error": "Internal AI error", "content": None}

    # back-compat alias
    async def chat_completion(self, system_prompt, user_prompt, **kw):
        return await self.chat(system_prompt, user_prompt, **kw)

    async def chat_openrouter(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = None,
        max_tokens: int = 800,
        temperature: float = 0.4,
        json_mode: bool = False,
    ) -> Dict[str, Any]:
        """OpenRouter-only chat helper used for admin-safe public messaging flows."""
        if not self.openrouter_client:
            return {
                "error": "OpenRouter client not initialized. Set OPENROUTER_API_KEY.",
                "content": None,
            }

        model_name = model or OPENROUTER_CHAT_MODEL
        capped_max_tokens = min(max_tokens or MAX_TOKENS_PER_REQ, 1200)

        if not await self._check_budget(capped_max_tokens):
            return {"error": "Token budget exceeded", "content": None}

        try:
            kwargs: Dict[str, Any] = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": capped_max_tokens,
                "temperature": temperature,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = await self.openrouter_client.chat.completions.create(**kwargs)
            msg = response.choices[0].message
            usage = getattr(response, "usage", None)

            prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if total_tokens > 0:
                await self._record_usage(total_tokens, model_name, "chat:openrouter")

            return {
                "content": self._stringify_message_content(msg.content),
                "usage": {
                    "prompt": prompt_tokens,
                    "completion": completion_tokens,
                    "total": total_tokens,
                } if total_tokens > 0 else None,
                "model": model_name,
                "provider": "openrouter",
                "error": None,
            }
        except RateLimitError:
            logger.error("🚫 OpenRouter rate-limit hit")
            return {"error": "OpenRouter rate limit exceeded. Please try again shortly.", "content": None}
        except APIError as e:
            logger.error("OpenRouter API error: %s", e)
            return {"error": str(e), "content": None}
        except Exception as e:
            logger.error("Unexpected OpenRouter error: %s", e)
            return {"error": "Internal OpenRouter error", "content": None}

    async def chat_google(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = None,
        max_tokens: int = 800,
        temperature: float = 0.4,
        json_mode: bool = False,
    ) -> Dict[str, Any]:
        """Google Gemini chat via OpenAI-compatible endpoint."""
        if not self.google_client:
            return {
                "error": "Google client not initialized. Set GOOGLE_API_KEY.",
                "content": None,
            }

        model_name = model or GOOGLE_MODEL_CHAT
        capped_max_tokens = min(max_tokens or MAX_TOKENS_PER_REQ, 1200)

        if not await self._check_budget(capped_max_tokens):
            return {"error": "Token budget exceeded", "content": None}

        try:
            kwargs: Dict[str, Any] = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": capped_max_tokens,
                "temperature": temperature,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = await self.google_client.chat.completions.create(**kwargs)
            msg = response.choices[0].message
            usage = getattr(response, "usage", None)

            prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if total_tokens > 0:
                await self._record_usage(total_tokens, model_name, "chat:google")

            return {
                "content": self._stringify_message_content(msg.content),
                "usage": {
                    "prompt": prompt_tokens,
                    "completion": completion_tokens,
                    "total": total_tokens,
                } if total_tokens > 0 else None,
                "model": model_name,
                "provider": "google",
                "error": None,
            }
        except RateLimitError:
            logger.error("🚫 Google rate-limit hit")
            return {"error": "Google rate limit exceeded. Please try again shortly.", "content": None}
        except APIError as e:
            logger.error("Google API error: %s", e)
            return {"error": str(e), "content": None}
        except Exception as e:
            logger.error("Unexpected Google error: %s", e)
            return {"error": "Internal Google AI error", "content": None}

    # ═══════════════════════════════════════════════════════════
    #  FUNCTION CALLING  (structured JSON output)
    # ═══════════════════════════════════════════════════════════
    async def chat_with_functions(
        self,
        system_prompt: str,
        user_prompt: str,
        functions: List[Dict],
        model: str = None,
    ) -> Dict[str, Any]:
        """Chat with explicit function schemas for structured output."""
        tools = [{"type": "function", "function": f} for f in functions]
        return await self.chat(system_prompt, user_prompt, model=model, tools=tools)

    # ═══════════════════════════════════════════════════════════
    #  WHISPER  (speech → text)
    # ═══════════════════════════════════════════════════════════
    async def transcribe_audio(
        self, file_path: str, language: str = None
    ) -> Dict[str, Any]:
        """
        Transcribe audio via Whisper.
        Returns: {text, language, duration, error}
        """
        if not self.client:
            return {"error": "Client not initialized", "text": None}
        if not await self._check_budget(500):
            return {"error": "Token budget exceeded", "text": None}
        try:
            with open(file_path, "rb") as f:
                kwargs: Dict[str, Any] = {
                    "model": "whisper-1",
                    "file": f,
                    "response_format": "verbose_json",
                    "prompt": "Disaster safety, weather, earthquake, cyclone, flood, India.",
                }
                if language:
                    kwargs["language"] = language
                transcript = await self.client.audio.transcriptions.create(**kwargs)
            await self._record_usage(500, "whisper-1", "whisper")
            if isinstance(transcript, str):
                return {"text": transcript, "language": language or "unknown", "error": None}

            text = getattr(transcript, "text", None) or ""
            detected_language = getattr(transcript, "language", None) or language or "unknown"
            duration = getattr(transcript, "duration", None)
            return {
                "text": text,
                "language": detected_language,
                "duration": duration,
                "error": None,
            }
        except Exception as e:
            logger.error(f"Whisper error: {e}")
            return {"error": str(e), "text": None}

    # ═══════════════════════════════════════════════════════════
    #  VISION  (image analysis)
    # ═══════════════════════════════════════════════════════════
    async def analyze_image(
        self,
        image_source: str,
        prompt: str = "Analyze this image for disaster-related content. Identify disaster type, severity, and notable features.",
        detail: str = "low",
    ) -> Dict[str, Any]:
        """
        Analyse an image using OpenRouter (preferred) or OpenAI vision.
        image_source: URL, local path, or base64 data URI
        """
        if not self.client and not self.openrouter_client:
            return {"error": "No AI vision client initialized", "content": None}
        if not await self._check_budget(800):
            return {"error": "Token budget exceeded", "content": None}

        provider = "openrouter" if self.openrouter_client else "openai"
        vision_client = self.openrouter_client or self.client
        vision_model = OPENROUTER_VISION_MODEL if self.openrouter_client else MODEL_HEAVY

        try:
            prepared_source = self._normalize_image_source(image_source)
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": prepared_source, "detail": detail}},
                    ],
                }
            ]
            response = await vision_client.chat.completions.create(
                model=vision_model,
                messages=messages,
                max_tokens=500,
            )

            usage = getattr(response, "usage", None)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if total_tokens > 0:
                await self._record_usage(total_tokens, vision_model, f"vision:{provider}")

            return {
                "content": self._stringify_message_content(response.choices[0].message.content),
                "usage": {"total": total_tokens} if total_tokens > 0 else None,
                "provider": provider,
                "model": vision_model,
                "error": None,
            }
        except Exception as e:
            logger.error(f"Vision error: {e}")
            return {"error": str(e), "content": None, "provider": provider, "model": vision_model}

    # ═══════════════════════════════════════════════════════════
    #  EMBEDDINGS
    # ═══════════════════════════════════════════════════════════
    async def get_embeddings(
        self, texts: List[str]
    ) -> Dict[str, Any]:
        """
        Generate embeddings using text-embedding-3-small.
        Returns: {embeddings: [[float,...]], usage, error}
        """
        if not self.client:
            return {"error": "Client not initialized", "embeddings": None}
        if not await self._check_budget(len(texts) * 50):
            return {"error": "Token budget exceeded", "embeddings": None}
        try:
            response = await self.client.embeddings.create(
                model=EMBEDDING_MODEL, input=texts
            )
            vecs = [d.embedding for d in response.data]
            total = response.usage.total_tokens
            await self._record_usage(total, EMBEDDING_MODEL, "embeddings")
            return {"embeddings": vecs, "usage": {"total": total}, "error": None}
        except Exception as e:
            logger.error(f"Embeddings error: {e}")
            return {"error": str(e), "embeddings": None}

    # ═══════════════════════════════════════════════════════════
    #  TEXT-TO-SPEECH (optional)
    # ═══════════════════════════════════════════════════════════
    async def text_to_speech(
        self, text: str, voice: str = "alloy", speed: float = 1.0
    ) -> Dict[str, Any]:
        """
        Convert text to speech using OpenAI TTS.
        Returns: {audio_bytes, error}
        """
        if not self.client:
            return {"error": "Client not initialized", "audio_bytes": None}
        try:
            response = await self.client.audio.speech.create(
                model="tts-1", voice=voice, input=text, speed=speed
            )
            audio = response.read()
            await self._record_usage(len(text), "tts-1", "tts")
            return {"audio_bytes": audio, "error": None}
        except Exception as e:
            logger.error(f"TTS error: {e}")
            return {"error": str(e), "audio_bytes": None}

    # ═══════════════════════════════════════════════════════════
    #  CACHE HELPERS
    # ═══════════════════════════════════════════════════════════
    @staticmethod
    def _cache_key(system: str, user: str, model: str) -> str:
        raw = f"{model}:{system}:{user}"
        return f"ai_cache:{hashlib.sha256(raw.encode()).hexdigest()}"

    async def _cache_get(self, key: str) -> Optional[Dict]:
        try:
            r = await redis_client.get_client()
            if r:
                data = await r.get(key)
                if data:
                    logger.info("✅ AI Cache HIT")
                    return json.loads(data)
        except Exception:
            pass
        return None

    async def _cache_set(self, key: str, data: Dict, ttl: int = 3600):
        try:
            r = await redis_client.get_client()
            if r:
                await r.setex(key, ttl, json.dumps(data, default=str))
        except Exception:
            pass

    @staticmethod
    def _stringify_message_content(content: Any) -> str:
        """Normalize SDK content payloads (string or blocks) into plain text."""
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            chunks: List[str] = []
            for item in content:
                text = None
                if isinstance(item, dict):
                    text = item.get("text")
                else:
                    text = getattr(item, "text", None)
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())
            return "\n".join(chunks)

        return str(content or "")

    @staticmethod
    def _normalize_image_source(image_source: str) -> str:
        """Accept URL/data URI/local file path and return an image_url-compatible source."""
        source = (image_source or "").strip()
        if not source:
            return source

        lower = source.lower()
        if lower.startswith("http://") or lower.startswith("https://") or lower.startswith("data:image"):
            return source

        path = Path(source)
        if path.exists() and path.is_file():
            data = path.read_bytes()
            mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
            b64 = base64.b64encode(data).decode("ascii")
            return f"data:{mime};base64,{b64}"

        return source


# ── Singleton ──────────────────────────────────────────────
ai_client = OpenAIClient()
