"""
AI Orchestrator v3.0
Central router: auth check → budget check → agent selection → function execution → logging.
Adds: confidence scoring, token cost tracking, chat history limiting.
"""
import logging
import json
import hashlib
import os
import re
from typing import Dict, Any
from datetime import datetime, timezone

from ai.openai_client import ai_client
from ai.sarvam_client import sarvam_client
from ai.free_model_router import free_model_router
from ai.agents import AGENTS, CitizenAgent
from ai.function_executor import execute_tool_calls

logger = logging.getLogger(__name__)

# ── Simple in-memory cache for student common queries ──
_query_cache: Dict[str, dict] = {}
_CACHE_TTL_SECONDS = 300  
_MAX_CHAT_HISTORY = 2
_FREE_CHAT_MIN_CHARS = int(os.getenv("FREE_CHAT_MIN_CHARS", "40"))
_GOOGLE_CHAT_FIRST = os.getenv("GOOGLE_CHAT_FIRST", "true").strip().lower() in {"1", "true", "yes", "on"}
_GOOGLE_CHAT_MODEL = os.getenv("GOOGLE_MODEL_CHAT", "gemini-2.0-flash")


def _likely_needs_tools(message: str) -> bool:
    """Heuristic guard: keep tool-reliant queries on primary orchestrated path."""
    if not message:
        return False
    lower = message.lower()
    hints = (
        "playbook", "sop", "notify", "send alert", "publish", "broadcast", "mosdac",
        "download", "dataset", "quiz", "db", "database", "analysis report", "admin",
        "retract", "approve", "community report", "risk score",
    )
    return any(h in lower for h in hints)


def _is_usable_free_answer(text: str) -> bool:
    if not text:
        return False
    cleaned = text.strip()
    if len(cleaned) < _FREE_CHAT_MIN_CHARS:
        return False

    low = cleaned.lower()
    weak_patterns = (
        "i am just a language model",
        "cannot access real-time",
        "i do not have access",
        "sorry, i can't",
        "i can't assist with that",
    )
    return not any(p in low for p in weak_patterns)


def _sanitize_content(text: str) -> str:
    """Remove provider reasoning tags before sending content to UI."""
    if not text:
        return ""
    cleaned = text
    # Strip raw URLs to discourage link-only answers.
    cleaned = re.sub(r"https?://\S+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"www\.\S+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[\w\-./?%&=]*)?\b", "", cleaned, flags=re.IGNORECASE)
    # Strip a dangling leading think tag if provider omits closing tag.
    if cleaned.lstrip().startswith("<think>") and "</think>" not in cleaned:
        first_newline = cleaned.find("\n")
        cleaned = cleaned[first_newline + 1:] if first_newline != -1 else ""
    while "<think>" in cleaned and "</think>" in cleaned:
        start = cleaned.find("<think>")
        end = cleaned.find("</think>", start)
        cleaned = (cleaned[:start] + cleaned[end + len("</think>"):]).strip()

    # Handle malformed/variant closing tags and keep only user-facing answer.
    cleaned = re.sub(r"(?is)^.*?</(?:think|ink)>\s*", "", cleaned).strip()

    # Drop leaked chain-of-thought style preambles when they appear untagged.
    if re.match(r"(?is)^\s*(okay|alright|hmm|the user|i need to|let me|need to|user asked)\b", cleaned):
        meta_hints = (
            "the user", "i need to", "let me", "i should", "make sure",
            "double-check", "keep it", "avoid any markdown", "use devanagari",
            "severity level", "recommended precautions", "source", "citations",
        )
        parts = re.split(r"(?<=[.!?।])\s+|\n+", cleaned)
        filtered_parts = []
        dropping = True
        for part in parts:
            seg = part.strip()
            if not seg:
                continue
            low = seg.lower()
            is_meta = low.startswith(("okay", "alright", "hmm")) or any(h in low for h in meta_hints)
            if dropping and is_meta:
                continue
            dropping = False
            filtered_parts.append(seg)
        if filtered_parts:
            cleaned = " ".join(filtered_parts)

    # Remove repetitive generic advisory that users asked to avoid.
    cleaned = re.sub(
        r"\s*for\s+real[- ]?time\s+alerts,?\s*check\s+imd(?:['’]s)?\s+website\s+or\s+(?:their|the)\s+app\.?\s*stay\s+safe!?\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*(?:for\s+real[- ]?time\s+alerts,?\s*)?(?:please\s+)?check\s+imd(?:['’]s)?\s+(?:website|site)(?:\s+or\s+(?:their|the)\s+app)?\.?\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*(?:please\s+)?(?:visit|check|see|refer\s+to)\s+(?:the\s+)?(?:official\s+)?(?:website|site|app|portal)\s*(?:for\s+more\s+info|for\s+details)?\.?\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*(?:you\s+can\s+)?(?:google\s+it|search\s+online)\.?\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*(?:track|follow|monitor)\s+(?:updates?|alerts?)\s+from\s+(?:imd|ndma|sdma|local\s+authorit(?:y|ies))\.?\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*(?:you\s+can\s+)?(?:contact|call|reach\s+out\s+to)\s+(?:ndma\s+helpline\s*1078|local\s+authorit(?:y|ies))\.?\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*(?:safe\s+rahne\s+ke\s+liye\s+)?(?:ndma|imd|sdma)(?:\s+ki|\s+ke)?\s+(?:website|site|portal|updates?|update)\s+\S*\s*(?:check|dekh(?:en|o)|follow|track)\s*",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Remove source/citation lines unless explicitly requested by caller.
    kept_lines = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        low = stripped.lower()
        if low.startswith(("source:", "sources:", "citation:", "citations:", "[source")):
            continue
        kept_lines.append(line)
    cleaned = "\n".join(kept_lines)

    # Convert markdown-ish formatting to plain text.
    cleaned = cleaned.replace("**", "").replace("__", "").replace("`", "")
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*[-*•]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)

    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"\s+([,.;!?])", r"\1", cleaned)
    return cleaned.strip()


def _cache_key(role: str, message: str) -> str:
    """Generate a cache key from role + normalized message."""
    return hashlib.md5(f"{role}:{message.strip().lower()}".encode()).hexdigest()


def _compute_confidence(result: dict, tool_calls_executed: list = None) -> float:
    """
    Heuristic confidence score based on:
    - Whether tool calls succeeded (grounded in data → higher confidence)
    - Whether the response is short/long enough
    - Whether playbook/quiz tools were used (deterministic → highest confidence)
    """
    base = 0.65  # baseline for LLM-only response

    if tool_calls_executed:
        base = 0.8
        if any("playbook" in t for t in tool_calls_executed):
            base = 0.95  # deterministic playbook = highest confidence
        if any("quiz" in t for t in tool_calls_executed):
            base = 0.92  # structured quiz = high confidence

    content = result.get("content", result.get("message", ""))
    if content and len(content) > 50:
        base = min(base + 0.03, 0.99)  # longer, detailed responses slightly more confident

    return round(base, 2)


def _limit_chat_history(messages: list, max_messages: int = _MAX_CHAT_HISTORY) -> list:
    """Keep only the system prompt + last N user/assistant messages."""
    if len(messages) <= max_messages + 1:  # +1 for system prompt
        return messages
    system = [m for m in messages if m.get("role") == "system"]
    others = [m for m in messages if m.get("role") != "system"]
    return system + others[-max_messages:]


# Romanized Hindi keyword list – expanded for common short-form / WhatsApp style
_HINGLISH_KEYWORDS = [
    "kya", "kaise", "barish", "mausam", "kal", "kl", "aaj", "abhi",
    "hoga", "hogi", "hain", "hai", "nahi", "nhi", "bhi", "toh", "to",
    "yaar", "bhai", "bc", "haha", "karo", "karo", "sahi", "sach",
    "achha", "accha", "theek", "thik", "pata", "chal", "bata",
    "kitna", "kab", "kahan", "kyun", "kyunki", "lekin", "aur",
    "mujhe", "mera", "meri", "hum", "tum", "aap", "woh", "yeh",
    "namaste", "shukriya", "dhanyawad", "bas", "bohot", "bahut",
    "sayd", "shayad", "zaroor", "bilkul", "agar", "ager",
    "ho", "ho sakta", "ho skta", "skta", "skti",
]


def _detect_language_from_text(text: str) -> str:
    """Return BCP-47-style language code.
    Returns 'hi-rom' for Romanized Hindi (Hinglish, Latin script),
    'hi' for Devanagari Hindi, other codes for remaining languages."""
    if not text:
        return ""
    # Devanagari script → formal Hindi
    if any('\u0900' <= ch <= '\u097F' for ch in text):
        return "hi"
    if any('\u0B80' <= ch <= '\u0BFF' for ch in text):
        return "ta"
    if any('\u0C00' <= ch <= '\u0C7F' for ch in text):
        return "te"
    if any('\u0980' <= ch <= '\u09FF' for ch in text):
        return "bn"
    if any('\u0A80' <= ch <= '\u0AFF' for ch in text):
        return "gu"
    if any('\u0C80' <= ch <= '\u0CFF' for ch in text):
        return "kn"
    if any('\u0D00' <= ch <= '\u0D7F' for ch in text):
        return "ml"
    if any('\u0A00' <= ch <= '\u0A7F' for ch in text):
        return "pa"
    # Roman-script Hindi / Hinglish detection
    lower = text.lower()
    matched = sum(1 for w in _HINGLISH_KEYWORDS if w in lower.split() or (" " + w + " ") in (" " + lower + " "))
    # Require minimum 1 keyword match; whole-word match avoids false positives
    if matched >= 1:
        return "hi-rom"
    return "en"


def _preferred_language_code(locale: str = None, language: str = None, message: str = "") -> str:
    detected = _detect_language_from_text(message)
    # Always prefer what the message itself says — stale UI locale loses
    if detected:
        return detected
    code = (locale or language or "").lower().strip()
    if code:
        return code.split('-')[0]
    return "en"


def _translation_target_desc(lang_code: str) -> str:
    """Human-readable translation target for the AI translation call."""
    mapping = {
        "hi-rom": (
            "Hinglish (casual Roman-script Hindi mixed with English, WhatsApp style, "
            "no Devanagari characters)"
        ),
        "hi": "Hindi using Devanagari script",
        "ta": "Tamil", "te": "Telugu", "bn": "Bengali",
        "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada",
        "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu",
    }
    return mapping.get(lang_code, "English")


def _language_instruction(locale: str = None, language: str = None, message: str = "") -> str:
    code = _preferred_language_code(locale, language, message)

    if code == "hi-rom":
        return (
            "Respond in casual Hinglish — Roman-script Hindi mixed naturally with English, "
            "exactly like a WhatsApp message. "
            "Use short, friendly sentences. Abbreviations like 'kl', 'hogi', 'skta', 'nhi' are fine. "
            "Do NOT use Devanagari script at all. "
            "Example tone: 'sayd kal barish ho sakti hai, thoda risk lag raha hai, "
            "chhata rakh lena bhai!'"
        )
    if code == "hi":
        return "Respond in Hindi using Devanagari script."
    if code.startswith("ta"):
        return "Respond in Tamil."
    if code.startswith("te"):
        return "Respond in Telugu."
    if code.startswith("bn"):
        return "Respond in Bengali."
    if code.startswith("mr"):
        return "Respond in Marathi."
    if code.startswith("gu"):
        return "Respond in Gujarati."
    if code.startswith("kn"):
        return "Respond in Kannada."
    if code.startswith("ml"):
        return "Respond in Malayalam."
    if code.startswith("pa"):
        return "Respond in Punjabi."
    if code.startswith("ur"):
        return "Respond in Urdu."
    return "Respond in English."


class AIOrchestrator:
    """
    Routes user requests to the correct agent and manages tool-call loops.
    """

    async def route_request(
        self, role: str, message: str, context: dict = None
    ) -> Dict[str, Any]:
        """
        Full pipeline (Multi-step Agent Loop):
        1. Check cache (student queries)
        2. Select agent by role
        3. Initial processing (User -> Model)
        4. WHILE tool_calls present (max 5 loops):
             a. Execute tool_calls
             b. Append results to history
             c. Model -> Followup (may return content OR more tool_calls)
        5. Compute confidence + token cost
        6. Cache if applicable
        7. Return response
        """
        context = context or {}
        cached = False

        # 1. Cache check for student common queries
        if role == "student":
            key = _cache_key(role, message)
            if key in _query_cache:
                entry = _query_cache[key]
                age = (datetime.now(timezone.utc) - entry["timestamp"]).total_seconds()
                if age < _CACHE_TTL_SECONDS:
                    logger.info(f"Cache HIT for student query (age={age:.0f}s)")
                    return {**entry["response"], "cached": True}
                else:
                    del _query_cache[key]

        # 2. Select agent
        agent = AGENTS.get(role, AGENTS["citizen"])
        logger.info(f"Routing '{role}' -> {agent.__class__.__name__}")

        # 3. Initial processing
        # We need to manually construct the messages history to support the loop
        preferred_lang = _preferred_language_code(context.get("locale"), context.get("language"), message)
        system_prompt = agent.system_prompt(context)
        lang_rule = _language_instruction(context.get("locale"), context.get("language"), message)
        if lang_rule:
            system_prompt = f"{system_prompt}\n\nLANGUAGE RULE:\n- {lang_rule}\n- Use the same language/script as the user message."

        system_prompt = (
            f"{system_prompt}\n\n"
            "FINAL ANSWER RULES:\n"
            "- Return only the final user-facing answer.\n"
            "- Never include internal reasoning, planning, or meta text (example: 'the user is asking...').\n"
            "- Do not include source/citation text unless the user explicitly asks for sources.\n"
            "- Do not mention departments/agencies/helplines unless the user asks for source or contact details.\n"
            "- Provide a complete direct answer in-chat.\n"
            "- Do not tell users to visit websites/apps/links instead of answering.\n"
            "- Do not use Markdown. Return plain text only."
        )

        # 3.a Free-model fast path (Ollama) for simple conversational traffic.
        free_chat_first = os.getenv("FREE_CHAT_FIRST", "false").strip().lower() in {"1", "true", "yes", "on"}
        free_roles = {"citizen", "student"}
        if (
            free_chat_first
            and free_model_router.enabled
            and role in free_roles
            and not context.get("force_primary_llm")
            and not _likely_needs_tools(message)
        ):
            free_result = await free_model_router.chat(
                system_prompt=system_prompt,
                user_prompt=message,
                max_tokens=min(agent.max_tokens, 500),
                temperature=agent.temperature,
            )
            free_text = _sanitize_content(free_result.get("content") or "")

            if not free_result.get("error") and _is_usable_free_answer(free_text):
                confidence = _compute_confidence({"content": free_text}, [])
                provider = free_result.get("provider") or "free"
                model = free_result.get("model") or provider

                response = {
                    "success": True,
                    "message": free_text,
                    "role": role,
                    "tool_calls_executed": [],
                    "usage": {
                        "model": model,
                        "prompt": 0,
                        "completion": 0,
                        "total": 0,
                        "total_tokens": 0,
                    },
                    "confidence": confidence,
                    "token_cost": 0,
                    "sources": [],
                    "cached": False,
                    "providers_used": [provider],
                    "provider": provider,
                }

                if role == "student":
                    _query_cache[_cache_key(role, message)] = {
                        "response": response,
                        "timestamp": datetime.now(timezone.utc),
                    }

                return response

            logger.info(
                "Free-model fast path skipped (provider_error=%s, usable=%s). Falling back to primary provider.",
                free_result.get("error"),
                _is_usable_free_answer(free_text),
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ]
        
        # Limit history before first call
        messages = _limit_chat_history(messages)

        primary_provider = "openai"
        primary_model = agent.model
        primary_client = ai_client.client

        if (
            _GOOGLE_CHAT_FIRST
            and ai_client.google_client
            and not context.get("force_primary_llm")
        ):
            primary_provider = "google"
            primary_model = _GOOGLE_CHAT_MODEL
            primary_client = ai_client.google_client

        try:
            if not primary_client:
                raise RuntimeError("Primary AI provider unavailable")

            response = await primary_client.chat.completions.create(
                model=primary_model,
                messages=messages,
                tools=agent.tools,
                tool_choice="auto" if agent.tools else None,
                max_tokens=agent.max_tokens,
                temperature=agent.temperature,
            )
            result_msg = response.choices[0].message
            current_tool_calls = result_msg.tool_calls
            content = result_msg.content

            # Add assistant response to history
            messages.append(result_msg)

            usage = getattr(response, "usage", None)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if total_tokens > 0:
                await ai_client._record_usage(
                    total_tokens, primary_model, f"chat_{role}_init:{primary_provider}"
                )

        except Exception as e:
            logger.error("Agent initial error (provider=%s, model=%s): %s", primary_provider, primary_model, e)

            # Backup provider path (OpenAI)
            if primary_provider != "openai" and ai_client.client:
                try:
                    openai_backup = await ai_client.chat(
                        system_prompt=system_prompt,
                        user_prompt=message,
                        model=agent.model,
                        max_tokens=min(agent.max_tokens, 700),
                        temperature=agent.temperature,
                    )
                    if openai_backup and not openai_backup.get("error") and openai_backup.get("content"):
                        openai_text = _sanitize_content(openai_backup["content"])
                        return {
                            "success": True,
                            "message": openai_text,
                            "role": role,
                            "confidence": 0.62,
                            "token_cost": int(((openai_backup.get("usage") or {}).get("total", 0) or 0)),
                            "sources": [],
                            "cached": False,
                            "providers_used": ["openai"],
                            "provider": "openai",
                        }
                except Exception as backup_exc:
                    logger.error("OpenAI backup provider failed: %s", backup_exc)

            # Backup provider path (Google Gemini)
            if primary_provider != "google":
                try:
                    google_backup = await ai_client.chat_google(
                        system_prompt=system_prompt,
                        user_prompt=message,
                        model=_GOOGLE_CHAT_MODEL,
                        max_tokens=min(agent.max_tokens, 700),
                        temperature=agent.temperature,
                    )
                    if google_backup and not google_backup.get("error") and google_backup.get("content"):
                        google_text = _sanitize_content(google_backup["content"])
                        return {
                            "success": True,
                            "message": google_text,
                            "role": role,
                            "confidence": 0.62,
                            "token_cost": int(((google_backup.get("usage") or {}).get("total", 0) or 0)),
                            "sources": [],
                            "cached": False,
                            "providers_used": ["google"],
                            "provider": "google",
                        }
                except Exception as backup_exc:
                    logger.error("Google backup provider failed: %s", backup_exc)

            # Backup provider path (Sarvam)
            try:
                backup = await sarvam_client.chat(message=message, system_prompt=system_prompt)
                if backup and not backup.get("error") and backup.get("content"):
                    backup_text = _sanitize_content(backup["content"])
                    if preferred_lang not in ("en", "") and backup_text and ai_client.client:
                        _tgt = _translation_target_desc(preferred_lang)
                        translated = await ai_client.chat(
                            system_prompt="Translate the text exactly into the requested style/language. Return only the translated text.",
                            user_prompt=f"Target: {_tgt}\nText: {backup_text}",
                            model=agent.model,
                            max_tokens=min(agent.max_tokens, 500),
                            temperature=0.1,
                        )
                        if translated and not translated.get("error") and translated.get("content"):
                            backup_text = _sanitize_content(translated.get("content"))
                    return {
                        "success": True,
                        "message": backup_text,
                        "role": role,
                        "confidence": 0.6,
                        "token_cost": 0,
                        "sources": [],
                        "cached": False,
                        "providers_used": ["sarvam"],
                        "provider": "sarvam",
                    }
            except Exception as backup_exc:
                logger.error("Backup provider failed: %s", backup_exc)

            # Final graceful fallback so dashboards never crash
            return {
                "success": True,
                "message": (
                    "I am temporarily unable to reach live AI services. "
                    "Please retry in a moment. If this is urgent, call 112 for immediate help."
                ),
                "role": role,
                "confidence": 0.2,
                "token_cost": 0,
                "sources": [],
                "cached": False,
                "providers_used": ["fallback"],
                "provider": "fallback",
            }

        # 4. Agent Loop (Max 5 turns)
        params = {
            "tool_calls_executed": [],
            "sources": [],
            "quiz_data": None
        }
        
        loop_count = 0
        final_content = content

        while current_tool_calls and loop_count < 5:
            loop_count += 1
            tool_names = [tc.function.name for tc in current_tool_calls]
            logger.info(f"Loop {loop_count}: Executing {len(current_tool_calls)} tools: {tool_names}")
            params["tool_calls_executed"].extend(tool_names)

            # Execute tools
            # Convert internal tool_calls objects to dicts for executor if needed, 
            # but our executor handles the list format usually. 
            # Let's verify executor expects dicts or objects. 
            # execute_tool_calls expects dicts usually. Pydantic objects need .status/dict.
            # Convert to dicts for the executor:
            tool_calls_dicts = [
                {
                    "id": tc.id,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    },
                    "type": tc.type
                } for tc in current_tool_calls
            ]
            
            tool_results = await execute_tool_calls(tool_calls_dicts)

            # Process results for next turn
            for tr in tool_results:
                messages.append({
                    "role": "tool",
                    "tool_call_id": tr["tool_call_id"],
                    "content": tr["content"],
                })

                # Extract sources/quiz data
                try:
                    data = json.loads(tr["content"]) if isinstance(tr["content"], str) else tr["content"]
                    if isinstance(data, dict):
                        if data.get("questions"):
                            params["quiz_data"] = data
                        for action in data.get("actions", []):
                            if isinstance(action, dict) and action.get("source"):
                                params["sources"].append(action["source"])
                except:
                    pass

            # Follow-up call
            try:
                followup = await primary_client.chat.completions.create(
                    model=primary_model,
                    messages=messages,
                    tools=agent.tools,
                    tool_choice="auto", # Allow more tools
                    max_tokens=agent.max_tokens,
                    temperature=agent.temperature,
                )
                result_msg = followup.choices[0].message
                current_tool_calls = result_msg.tool_calls
                final_content = result_msg.content
                
                messages.append(result_msg)
                
                usage = getattr(followup, "usage", None)
                loop_tokens = int(getattr(usage, "total_tokens", 0) or 0)
                total_tokens += loop_tokens
                if loop_tokens > 0:
                    await ai_client._record_usage(
                        loop_tokens, primary_model, f"chat_loop_{loop_count}:{primary_provider}"
                    )
            except Exception as e:
                logger.error(f"Loop error: {e}")
                final_content = "I encountered an error processing the tool results."
                break

        # 5. Final Response Construction
        final_content = _sanitize_content(final_content)

        # If target language is non-English but output is mostly English, translate.
        if preferred_lang not in ("en", "") and final_content:
            ascii_letters = sum(1 for c in final_content if ('a' <= c.lower() <= 'z'))
            ratio = ascii_letters / max(len(final_content), 1)
            # For hi-rom the response is normally already Roman-script; skip translation
            # unless strikingly formal (contains Devanagari or ratio very high).
            has_devanagari = any('\u0900' <= ch <= '\u097F' for ch in final_content)
            needs_translation = (
                (preferred_lang == "hi-rom" and has_devanagari)
                or (preferred_lang != "hi-rom" and ratio > 0.55)
            )
            if needs_translation and ai_client.client:
                _tgt = _translation_target_desc(preferred_lang)
                translated = await ai_client.chat(
                    system_prompt="Translate the text exactly into the requested style/language. Return only the translated text.",
                    user_prompt=f"Target: {_tgt}\nText: {final_content}",
                    model=agent.model,
                    max_tokens=min(agent.max_tokens, 500),
                    temperature=0.1,
                )
                if translated and not translated.get("error") and translated.get("content"):
                    final_content = _sanitize_content(translated.get("content"))

        confidence = _compute_confidence({"content": final_content}, params["tool_calls_executed"])

        response = {
            "success": True,
            "message": final_content or "Action completed.",
            "role": role,
            "tool_calls_executed": params["tool_calls_executed"],
            "usage": {
                "model": primary_model,
                "prompt": 0,
                "completion": 0,
                "total": total_tokens,
                "total_tokens": total_tokens,
            },
            "confidence": confidence,
            "token_cost": total_tokens,
            "sources": params["sources"][:5],
            "cached": cached,
            "providers_used": [primary_provider],
            "provider": primary_provider,
        }
        
        if params["quiz_data"]:
            response["quiz"] = params["quiz_data"]

        # Cache student queries
        if role == "student":
            _query_cache[_cache_key(role, message)] = {
                "response": response,
                "timestamp": datetime.now(timezone.utc),
            }

        return response


# ── Singleton ──────────────────────────────────────────────
orchestrator = AIOrchestrator()
