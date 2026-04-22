
import logging
from typing import Dict, Any, List, Optional

from ai.openai_client import ai_client, MODEL_MINI, MODEL_HEAVY
from ai.prompts import PROMPTS
from ai.tools import (
    PLAYBOOK_SCHEMA, DB_QUERY_SCHEMA, NOTIFICATION_SCHEMA,
    MOSDAC_DOWNLOAD_SCHEMA, PUBLISH_ADVISORY_SCHEMA, QUIZ_SCHEMA,
    FLOOD_REPORT_SCHEMA, CYCLONE_REPORT_SCHEMA, SATELLITE_SEARCH_SCHEMA,
)

logger = logging.getLogger(__name__)


class BaseAgent:
    """Base agent with shared processing logic."""

    name: str = "base"
    model: str = MODEL_MINI
    temperature: float = 0.7
    max_tokens: int = 600
    tool_schemas: List[Dict] = []

    @property
    def tools(self) -> Optional[List[Dict]]:
        """Return tool_schemas wrapped in OpenAI function-calling format."""
        if not self.tool_schemas:
            return None
        return [{"type": "function", "function": s} for s in self.tool_schemas]

    def system_prompt(self, context: dict = None) -> str:
        return PROMPTS.get(self.name, PROMPTS["citizen"])

    async def process(self, message: str, context: dict = None) -> Dict[str, Any]:
        tools = [{"type": "function", "function": s} for s in self.tool_schemas] or None
        result = await ai_client.chat(
            system_prompt=self.system_prompt(context),
            user_prompt=message,
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            tools=tools,
        )
        return result


class CitizenAgent(BaseAgent):
    """
    Safety-focused agent for citizens.
    Injects playbook actions into context for authoritative responses.
    Lower temperature for consistency.
    Has access to satellite data search for farmers requesting MOSDAC data.
    """
    name = "citizen"
    temperature = 0.55   # increased from 0.3
    max_tokens = 550
    tool_schemas = [PLAYBOOK_SCHEMA, DB_QUERY_SCHEMA, SATELLITE_SEARCH_SCHEMA]

    def system_prompt(self, context: dict = None) -> str:
        base = PROMPTS["citizen"]
        if context:
            playbook_actions = context.get("playbook_actions")
            if playbook_actions:
                base += f"\n\n[OFFICIAL ACTIONS — relay these first]:\n{playbook_actions}"
            location = context.get("location")
            if location:
                if isinstance(location, dict):
                    city = location.get("city")
                    state = location.get("state")
                    pin_code = location.get("pin_code")
                    lat = location.get("lat")
                    lon = location.get("lon")
                    base += (
                        "\n[USER LOCATION CONTEXT]"
                        f"\n- City: {city or 'unknown'}"
                        f"\n- State: {state or 'unknown'}"
                        f"\n- PIN: {pin_code or 'unknown'}"
                        f"\n- Latitude: {lat if lat is not None else 'unknown'}"
                        f"\n- Longitude: {lon if lon is not None else 'unknown'}"
                    )
                else:
                    base += f"\nUser location: {location}"

            weather_snapshot = context.get("weather_snapshot")
            if isinstance(weather_snapshot, dict):
                base += (
                    "\n[WEATHER SNAPSHOT]"
                    f"\n- Condition: {weather_snapshot.get('condition') or 'unknown'}"
                    f"\n- Temperature C: {weather_snapshot.get('temperature_c') if weather_snapshot.get('temperature_c') is not None else 'unknown'}"
                    f"\n- AQI: {weather_snapshot.get('aqi') if weather_snapshot.get('aqi') is not None else 'unknown'}"
                    f"\n- Humidity: {weather_snapshot.get('humidity') if weather_snapshot.get('humidity') is not None else 'unknown'}"
                    f"\n- Wind kph: {weather_snapshot.get('wind_kph') if weather_snapshot.get('wind_kph') is not None else 'unknown'}"
                )

            nearby_alerts = context.get("nearby_alerts")
            if isinstance(nearby_alerts, list) and nearby_alerts:
                base += "\n[NEARBY ALERT SNAPSHOT]"
                for item in nearby_alerts[:5]:
                    if not isinstance(item, dict):
                        continue
                    base += (
                        f"\n- {item.get('title') or 'Alert'}"
                        f" | severity={item.get('severity') or 'unknown'}"
                        f" | type={item.get('alert_type') or 'general'}"
                        f" | location={item.get('location') or 'nearby'}"
                    )

            base += (
                "\n\nCONTEXT USAGE RULES:"
                "\n- Treat the provided location/weather/alerts snapshot as current app context."
                "\n- Do not ask user for location again if city/state/pin or coordinates are already present."
                "\n- Prefer answering directly from this snapshot plus your safety knowledge."
            )
        return base


class StudentAgent(BaseAgent):
    """
    Educational agent for students.
    Higher temperature for creative, engaging replies.
    """
    name = "student"
    temperature = 0.75   # slightly lower to avoid hallucination
    max_tokens = 600
    tool_schemas = [PLAYBOOK_SCHEMA, QUIZ_SCHEMA]


class ScientistAgent(BaseAgent):
    """
    Data-driven agent for researchers and authorities.
    Uses heavy model and RAG retrieval for context-rich answers.
    Has access to MOSDAC satellite data tools for flood/cyclone reports.
    """
    name = "scientist"
    model = MODEL_HEAVY
    temperature = 0.4
    max_tokens = 1000
    tool_schemas = [
        DB_QUERY_SCHEMA, MOSDAC_DOWNLOAD_SCHEMA, PUBLISH_ADVISORY_SCHEMA,
        FLOOD_REPORT_SCHEMA, CYCLONE_REPORT_SCHEMA, SATELLITE_SEARCH_SCHEMA,
    ]

    def system_prompt(self, context: dict = None) -> str:
        base = PROMPTS["scientist"]
        if context:
            rag_chunks = context.get("rag_context")
            if rag_chunks:
                base += "\n\n[RETRIEVED RESEARCH CONTEXT]:\n"
                for chunk in rag_chunks:
                    base += f"\n--- {chunk['title']} (relevance: {chunk['score']}) ---\n{chunk['content']}\n"
        return base

    async def process(self, message: str, context: dict = None) -> Dict[str, Any]:
        # RAG retrieval
        from ai.rag_system import rag_system
        rag_chunks = await rag_system.retrieve(message, top_k=3)
        ctx = dict(context) if context else {}
        ctx["rag_context"] = rag_chunks

        return await super().process(message, ctx)


class AdminAgent(BaseAgent):
    """
    Admin/authority agent with full tool access.
    Can trigger notifications, publish advisories, download satellite data,
    generate reports. AI explains — never triggers alerts.
    """
    name = "scientist"  # reuses scientist prompt, full tool access
    model = MODEL_HEAVY
    temperature = 0.3
    max_tokens = 800
    tool_schemas = [
        DB_QUERY_SCHEMA, NOTIFICATION_SCHEMA, PLAYBOOK_SCHEMA,
        MOSDAC_DOWNLOAD_SCHEMA, PUBLISH_ADVISORY_SCHEMA,
        FLOOD_REPORT_SCHEMA, CYCLONE_REPORT_SCHEMA, SATELLITE_SEARCH_SCHEMA,
    ]


# ── Agent Registry ─────────────────────────────────────────
AGENTS = {
    "citizen": CitizenAgent(),
    "student": StudentAgent(),
    "scientist": ScientistAgent(),
    "admin": AdminAgent(),
}
