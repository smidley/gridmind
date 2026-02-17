"""AI-powered energy insights and anomaly detection using OpenAI."""

import logging
import json
import time
from datetime import datetime, date, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from services import setup_store


def _local_now() -> datetime:
    try:
        return datetime.now(ZoneInfo(setup_store.get_timezone()))
    except Exception:
        return datetime.now(ZoneInfo("America/New_York"))

logger = logging.getLogger(__name__)

# Cache insights to avoid repeated API calls
_insights_cache: dict = {}
_insights_cache_time: float = 0
INSIGHTS_CACHE_TTL = 3600  # 1 hour

_anomalies_cache: dict = {}
_anomalies_cache_time: float = 0
ANOMALIES_CACHE_TTL = 1800  # 30 minutes


def _get_openai_client():
    """Get an OpenAI client if configured."""
    api_key = setup_store.get("openai_api_key", "")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        return OpenAI(api_key=api_key)
    except ImportError:
        logger.error("openai package not installed")
        return None


def is_configured() -> bool:
    """Check if OpenAI API key is set."""
    return bool(setup_store.get("openai_api_key", ""))


async def generate_insights(energy_data: list[dict], today_data: dict, forecast: dict | None = None) -> dict:
    """Generate AI insights from recent energy data.

    Args:
        energy_data: Last 7 days of daily energy summaries
        today_data: Today's energy totals
        forecast: Solar forecast for today/tomorrow
    """
    global _insights_cache, _insights_cache_time

    now = time.time()
    if _insights_cache and (now - _insights_cache_time) < INSIGHTS_CACHE_TTL:
        return _insights_cache

    client = _get_openai_client()
    if not client:
        return {"insights": [], "error": "OpenAI not configured"}

    # Build context for the AI
    context = "You are an energy advisor for a home with Tesla Powerwall and solar panels.\n"
    context += "Analyze this energy data and provide 3-5 concise, actionable insights.\n"
    context += "Focus on patterns, achievements, and optimization opportunities.\n"
    context += "Keep each insight to 1-2 sentences. Be specific with numbers.\n\n"

    context += "=== Today's Energy ===\n"
    context += json.dumps(today_data, indent=2, default=str) + "\n\n"

    if energy_data:
        context += "=== Last 7 Days (daily summaries) ===\n"
        for d in energy_data[-7:]:
            context += json.dumps(d, indent=2, default=str) + "\n"
        context += "\n"

    if forecast:
        context += "=== Solar Forecast ===\n"
        context += json.dumps(forecast, indent=2, default=str) + "\n\n"

    context += "Respond with a JSON array of insight objects: [{\"title\": \"...\", \"body\": \"...\", \"type\": \"achievement|tip|warning|info\"}]"

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise home energy advisor. Always respond with valid JSON only."},
                {"role": "user", "content": context},
            ],
            temperature=0.7,
            max_tokens=800,
        )

        text = response.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        insights = json.loads(text)
        result = {
            "insights": insights,
            "generated_at": _local_now().isoformat(),
            "model": "gpt-4o-mini",
        }

        _insights_cache = result
        _insights_cache_time = now
        return result

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse AI insights JSON: %s", e)
        return {"insights": [], "error": "Failed to parse AI response"}
    except Exception as e:
        logger.error("OpenAI insights error: %s", e)
        return {"insights": [], "error": str(e)}


async def detect_anomalies(readings: list[dict], daily_summaries: list[dict]) -> dict:
    """Detect anomalies in energy data using AI.

    Args:
        readings: Recent readings (last 24h)
        daily_summaries: Last 30 days of daily data for baseline
    """
    global _anomalies_cache, _anomalies_cache_time

    now = time.time()
    if _anomalies_cache and (now - _anomalies_cache_time) < ANOMALIES_CACHE_TTL:
        return _anomalies_cache

    client = _get_openai_client()
    if not client:
        return {"anomalies": [], "error": "OpenAI not configured"}

    # Calculate baselines from daily summaries
    if not daily_summaries:
        return {"anomalies": [], "error": "Not enough historical data"}

    # Compute averages for baseline
    n = len(daily_summaries)
    avg_solar = sum(d.get("solar_generated_kwh", 0) or 0 for d in daily_summaries) / n if n else 0
    avg_import = sum(d.get("grid_imported_kwh", 0) or 0 for d in daily_summaries) / n if n else 0
    avg_export = sum(d.get("grid_exported_kwh", 0) or 0 for d in daily_summaries) / n if n else 0
    avg_consumed = sum(d.get("home_consumed_kwh", 0) or 0 for d in daily_summaries) / n if n else 0

    # Build context
    context = "You are an energy anomaly detector for a home with Tesla Powerwall and solar.\n"
    context += "Compare today's data against the historical baseline and recent readings.\n"
    context += "Flag any unusual patterns, spikes, or deviations. Only report genuine anomalies.\n"
    context += "If nothing is unusual, return an empty array.\n\n"

    context += f"=== Baseline (avg over {n} days) ===\n"
    context += f"Avg solar: {avg_solar:.1f} kWh/day\n"
    context += f"Avg import: {avg_import:.1f} kWh/day\n"
    context += f"Avg export: {avg_export:.1f} kWh/day\n"
    context += f"Avg consumed: {avg_consumed:.1f} kWh/day\n\n"

    if daily_summaries:
        context += "=== Recent Days ===\n"
        for d in daily_summaries[-5:]:
            context += json.dumps(d, default=str) + "\n"
        context += "\n"

    # Sample recent readings (every 10th to keep token count down)
    if readings:
        sampled = readings[::10][:30]
        context += "=== Recent Readings (sampled) ===\n"
        for r in sampled:
            context += json.dumps(r, default=str) + "\n"
        context += "\n"

    context += 'Respond with a JSON array: [{"title": "...", "description": "...", "severity": "info|warning|critical", "metric": "solar|grid|battery|home"}]'

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise energy anomaly detector. Respond with valid JSON only. Only flag genuine anomalies."},
                {"role": "user", "content": context},
            ],
            temperature=0.3,
            max_tokens=600,
        )

        text = response.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        anomalies = json.loads(text)
        result = {
            "anomalies": anomalies,
            "baseline": {
                "avg_solar_kwh": round(avg_solar, 1),
                "avg_import_kwh": round(avg_import, 1),
                "avg_export_kwh": round(avg_export, 1),
                "avg_consumed_kwh": round(avg_consumed, 1),
                "days_analyzed": n,
            },
            "checked_at": _local_now().isoformat(),
            "model": "gpt-4o-mini",
        }

        _anomalies_cache = result
        _anomalies_cache_time = now
        return result

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse AI anomalies JSON: %s", e)
        return {"anomalies": [], "error": "Failed to parse AI response"}
    except Exception as e:
        logger.error("OpenAI anomaly detection error: %s", e)
        return {"anomalies": [], "error": str(e)}
