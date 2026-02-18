"""AI-powered energy insights, anomaly detection, and bill estimation.

Supports multiple AI providers (OpenAI, Google Gemini, Groq) via the
OpenAI-compatible API format. Only one provider is active at a time.
"""

import logging
import json
import time
from datetime import datetime, date, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from services import setup_store

logger = logging.getLogger(__name__)


def _local_now() -> datetime:
    try:
        return datetime.now(ZoneInfo(setup_store.get_timezone()))
    except Exception:
        return datetime.now(ZoneInfo("America/New_York"))


# --- Provider configuration ---

PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "base_url": None,
        "model": "gpt-4o-mini",
        "key_prefix": "sk-",
        "free_tier": False,
        "key_url": "https://platform.openai.com/api-keys",
    },
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-2.0-flash",
        "key_prefix": "AI",
        "free_tier": True,
        "key_url": "https://aistudio.google.com/apikey",
    },
    "groq": {
        "name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.1-8b-instant",
        "key_prefix": "gsk_",
        "free_tier": True,
        "key_url": "https://console.groq.com/keys",
    },
}


def _get_ai_client():
    """Get an AI client and model for the configured provider.

    Returns (client, model) tuple, or (None, None) if not configured.
    Automatically migrates old openai_api_key if present.
    """
    provider = setup_store.get("ai_provider", "")
    api_key = setup_store.get("ai_api_key", "")

    # Migrate old openai_api_key if new config not set
    if not provider or not api_key:
        old_key = setup_store.get("openai_api_key", "")
        if old_key:
            setup_store.set("ai_provider", "openai")
            setup_store.set("ai_api_key", old_key)
            setup_store.set("openai_api_key", "")
            provider, api_key = "openai", old_key
            logger.info("Migrated old openai_api_key to new ai_provider/ai_api_key format")
        else:
            return None, None

    config = PROVIDERS.get(provider)
    if not config:
        return None, None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=config["base_url"])
        return client, config["model"]
    except ImportError:
        logger.error("openai package not installed")
        return None, None


def is_configured() -> bool:
    """Check if an AI provider is configured."""
    provider = setup_store.get("ai_provider", "")
    api_key = setup_store.get("ai_api_key", "")
    if provider and api_key:
        return True
    # Check old key too
    return bool(setup_store.get("openai_api_key", ""))


def get_provider_info() -> dict:
    """Get info about the currently configured provider."""
    provider = setup_store.get("ai_provider", "")
    if not provider:
        old_key = setup_store.get("openai_api_key", "")
        if old_key:
            provider = "openai"
    config = PROVIDERS.get(provider, {})
    return {
        "provider": provider,
        "provider_name": config.get("name", ""),
        "model": config.get("model", ""),
    }


# --- Response parsing ---

def _parse_json_response(text: str) -> list | dict:
    """Parse AI response, stripping markdown code fences if present."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    return json.loads(text)


# --- Cache + rate limiting ---

_insights_cache: dict = {}
_insights_cache_time: float = 0
INSIGHTS_CACHE_TTL = 3600  # 1 hour

_anomalies_cache: dict = {}
_anomalies_cache_time: float = 0
ANOMALIES_CACHE_TTL = 1800  # 30 minutes

_bill_cache: dict = {}
_bill_cache_time: float = 0
BILL_CACHE_TTL = 86400  # 24 hours

# Prevent concurrent AI calls (free tiers have strict per-minute limits)
import asyncio
_ai_lock = asyncio.Lock()
_last_ai_call: float = 0
AI_MIN_GAP_SECONDS = 5  # Minimum gap between AI API calls


async def _rate_limited_call(client, model: str, messages: list, temperature: float, max_tokens: int):
    """Make an AI API call with rate limiting and serialization."""
    global _last_ai_call
    async with _ai_lock:
        # Ensure minimum gap between calls
        now = time.time()
        wait = AI_MIN_GAP_SECONDS - (now - _last_ai_call)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_ai_call = time.time()

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response


# --- Insights ---

async def generate_insights(energy_data: list[dict], today_data: dict, forecast: dict | None = None) -> dict:
    """Generate AI insights from recent energy data."""
    global _insights_cache, _insights_cache_time

    now = time.time()
    if _insights_cache and (now - _insights_cache_time) < INSIGHTS_CACHE_TTL:
        return _insights_cache

    client, model = _get_ai_client()
    if not client:
        return {"insights": [], "error": "AI provider not configured"}

    context = "You are an energy advisor for a home with solar panels and a battery storage system.\n"
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

    context += 'Respond with a JSON array of insight objects: [{"title": "...", "body": "...", "type": "achievement|tip|warning|info"}]'

    try:
        response = await _rate_limited_call(
            client, model,
            messages=[
                {"role": "system", "content": "You are a concise home energy advisor. Always respond with valid JSON only."},
                {"role": "user", "content": context},
            ],
            temperature=0.7,
            max_tokens=800,
        )

        insights = _parse_json_response(response.choices[0].message.content)
        provider_info = get_provider_info()
        result = {
            "insights": insights,
            "generated_at": _local_now().isoformat(),
            "model": provider_info["model"],
            "provider": provider_info["provider_name"],
        }

        _insights_cache = result
        _insights_cache_time = now
        return result

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse AI insights JSON: %s", e)
        return {"insights": [], "error": "Failed to parse AI response"}
    except Exception as e:
        logger.error("AI insights error: %s", e)
        return {"insights": [], "error": str(e)}


# --- Anomaly Detection ---

async def detect_anomalies(readings: list[dict], daily_summaries: list[dict]) -> dict:
    """Detect anomalies in energy data using AI."""
    global _anomalies_cache, _anomalies_cache_time

    now = time.time()
    if _anomalies_cache and (now - _anomalies_cache_time) < ANOMALIES_CACHE_TTL:
        return _anomalies_cache

    client, model = _get_ai_client()
    if not client:
        return {"anomalies": [], "error": "AI provider not configured"}

    if not daily_summaries:
        return {"anomalies": [], "error": "Not enough historical data"}

    n = len(daily_summaries)
    avg_solar = sum(d.get("solar_generated_kwh", 0) or 0 for d in daily_summaries) / n if n else 0
    avg_import = sum(d.get("grid_imported_kwh", 0) or 0 for d in daily_summaries) / n if n else 0
    avg_export = sum(d.get("grid_exported_kwh", 0) or 0 for d in daily_summaries) / n if n else 0
    avg_consumed = sum(d.get("home_consumed_kwh", 0) or 0 for d in daily_summaries) / n if n else 0

    context = "You are an energy anomaly detector for a home with solar panels and battery storage.\n"
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

    if readings:
        sampled = readings[::10][:30]
        context += "=== Recent Readings (sampled) ===\n"
        for r in sampled:
            context += json.dumps(r, default=str) + "\n"
        context += "\n"

    context += 'Respond with a JSON array: [{"title": "...", "description": "...", "severity": "info|warning|critical", "metric": "solar|grid|battery|home"}]'

    try:
        response = await _rate_limited_call(
            client, model,
            messages=[
                {"role": "system", "content": "You are a concise energy anomaly detector. Respond with valid JSON only. Only flag genuine anomalies."},
                {"role": "user", "content": context},
            ],
            temperature=0.3,
            max_tokens=600,
        )

        anomalies = _parse_json_response(response.choices[0].message.content)
        provider_info = get_provider_info()
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
            "model": provider_info["model"],
            "provider": provider_info["provider_name"],
        }

        _anomalies_cache = result
        _anomalies_cache_time = now
        return result

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse AI anomalies JSON: %s", e)
        return {"anomalies": [], "error": "Failed to parse AI response"}
    except Exception as e:
        logger.error("AI anomaly detection error: %s", e)
        return {"anomalies": [], "error": str(e)}


# --- Monthly Bill Estimate ---

async def estimate_monthly_bill(daily_summaries: list[dict], rate_info: dict | None = None) -> dict:
    """Estimate the current month's electricity bill using AI.

    Args:
        daily_summaries: This month's daily energy summaries so far
        rate_info: TOU rate schedule info (optional, from /site/tariff)
    """
    global _bill_cache, _bill_cache_time

    now = time.time()
    if _bill_cache and (now - _bill_cache_time) < BILL_CACHE_TTL:
        return _bill_cache

    client, model = _get_ai_client()
    if not client:
        return {"error": "AI provider not configured"}

    if not daily_summaries:
        return {"error": "No energy data for this month yet"}

    local_now = _local_now()
    days_so_far = len(daily_summaries)
    days_in_month = (date(local_now.year, local_now.month % 12 + 1, 1) - timedelta(days=1)).day if local_now.month < 12 else 31
    days_remaining = max(days_in_month - local_now.day, 0)

    total_imported = sum(d.get("grid_imported_kwh", 0) or 0 for d in daily_summaries)
    total_exported = sum(d.get("grid_exported_kwh", 0) or 0 for d in daily_summaries)
    total_consumed = sum(d.get("home_consumed_kwh", 0) or 0 for d in daily_summaries)
    total_solar = sum(d.get("solar_generated_kwh", 0) or 0 for d in daily_summaries)

    context = "You are a utility bill estimator for a residential home with solar panels and battery storage.\n"
    context += "Based on the energy usage data so far this month, estimate the full monthly electricity bill.\n"
    context += "Include ALL typical charges that appear on a residential electricity bill:\n"
    context += "- Energy charges (imported kWh at the applicable rates)\n"
    context += "- Export/net metering credits (exported kWh)\n"
    context += "- Basic/service charge (fixed monthly fee, typically $10-15)\n"
    context += "- Distribution/delivery charges (typically $0.02-0.05/kWh)\n"
    context += "- Taxes and regulatory fees (typically 5-10% of charges)\n"
    context += "- Any other common utility fees\n"
    context += "Project the remaining days based on the daily averages so far.\n\n"

    context += f"=== Month Progress ===\n"
    context += f"Month: {local_now.strftime('%B %Y')}\n"
    context += f"Days tracked: {days_so_far} of {days_in_month}\n"
    context += f"Days remaining: {days_remaining}\n\n"

    context += f"=== Energy Totals (month to date) ===\n"
    context += f"Grid imported: {total_imported:.1f} kWh\n"
    context += f"Grid exported: {total_exported:.1f} kWh\n"
    context += f"Solar generated: {total_solar:.1f} kWh\n"
    context += f"Home consumed: {total_consumed:.1f} kWh\n"
    context += f"Daily avg import: {total_imported / days_so_far:.1f} kWh\n"
    context += f"Daily avg export: {total_exported / days_so_far:.1f} kWh\n\n"

    if rate_info:
        context += "=== Rate Information ===\n"
        context += f"Utility: {rate_info.get('utility', 'Unknown')}\n"
        context += f"Plan: {rate_info.get('plan_name', 'Unknown')}\n"
        if rate_info.get("rate_schedule"):
            for period, info in rate_info["rate_schedule"].items():
                context += f"{info.get('display_name', period)}: ${info.get('rate', 0):.4f}/kWh\n"
        context += "\n"

    context += "=== Recent Daily Data ===\n"
    for d in daily_summaries[-7:]:
        context += json.dumps(d, default=str) + "\n"
    context += "\n"

    context += ('Respond with a JSON object: {"estimated_total": 45.20, "energy_charges": 30.50, '
                '"export_credits": -8.00, "fixed_fees": 12.50, "taxes_and_fees": 5.20, '
                '"projected_import_kwh": 500, "projected_export_kwh": 300, '
                '"confidence": "medium", "note": "Brief explanation of estimate"}')

    try:
        response = await _rate_limited_call(
            client, model,
            messages=[
                {"role": "system", "content": "You are a utility bill estimator. Respond with valid JSON only. Be realistic about typical utility fees and charges."},
                {"role": "user", "content": context},
            ],
            temperature=0.3,
            max_tokens=500,
        )

        estimate = _parse_json_response(response.choices[0].message.content)
        provider_info = get_provider_info()
        result = {
            **estimate,
            "month": local_now.strftime("%B %Y"),
            "days_tracked": days_so_far,
            "days_in_month": days_in_month,
            "estimated_at": _local_now().isoformat(),
            "model": provider_info["model"],
            "provider": provider_info["provider_name"],
        }

        _bill_cache = result
        _bill_cache_time = now
        return result

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse AI bill estimate JSON: %s", e)
        return {"error": "Failed to parse AI response"}
    except Exception as e:
        logger.error("AI bill estimate error: %s", e)
        return {"error": str(e)}
