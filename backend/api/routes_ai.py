"""AI insights, anomaly detection, bill estimation, and interactive Q&A routes."""

import logging
import json
from datetime import datetime, timedelta, date

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from database import async_session, EnergyReading, DailyEnergySummary
from services import setup_store
from services.ai_insights import (
    generate_insights, detect_anomalies, estimate_monthly_bill,
    is_configured, get_provider_info, PROVIDERS, _get_ai_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AIConfigRequest(BaseModel):
    provider: str
    api_key: str


@router.get("/providers")
async def ai_providers():
    """List available AI providers."""
    providers = []
    for key, config in PROVIDERS.items():
        providers.append({
            "id": key,
            "name": config["name"],
            "key_prefix": config["key_prefix"],
            "free_tier": config["free_tier"],
            "key_url": config["key_url"],
            "model": config["model"],
        })
    return {"providers": providers}


@router.get("/status")
async def ai_status():
    """Check if an AI provider is configured."""
    info = get_provider_info()
    return {
        "configured": is_configured(),
        "provider": info["provider"],
        "provider_name": info["provider_name"],
        "model": info["model"],
        "has_key": bool(setup_store.get("ai_api_key", "") or setup_store.get("openai_api_key", "")),
    }


@router.post("/configure")
async def ai_configure(data: AIConfigRequest):
    """Save AI provider and API key."""
    if data.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {data.provider}. Valid: {', '.join(PROVIDERS.keys())}")

    if not data.api_key:
        raise HTTPException(status_code=400, detail="API key is required")

    config = PROVIDERS[data.provider]
    if config["key_prefix"] and not data.api_key.startswith(config["key_prefix"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid key format for {config['name']}. Key should start with '{config['key_prefix']}'"
        )

    setup_store.set("ai_provider", data.provider)
    setup_store.set("ai_api_key", data.api_key)
    # Clear old key if migrating
    if setup_store.get("openai_api_key"):
        setup_store.set("openai_api_key", "")

    logger.info("AI provider configured: %s", config["name"])
    return {"status": "ok", "provider": data.provider, "provider_name": config["name"]}


@router.delete("/configure")
async def ai_remove():
    """Remove AI configuration."""
    setup_store.set("ai_provider", "")
    setup_store.set("ai_api_key", "")
    setup_store.set("openai_api_key", "")
    logger.info("AI configuration removed")
    return {"status": "ok"}


@router.get("/insights")
async def ai_insights():
    """Get AI-generated energy insights."""
    if not is_configured():
        return {"insights": [], "error": "AI provider not configured. Add an API key in Settings."}

    async with async_session() as session:
        since = (date.today() - timedelta(days=7)).isoformat()
        result = await session.execute(
            select(DailyEnergySummary)
            .where(DailyEnergySummary.date >= since)
            .order_by(DailyEnergySummary.date.asc())
        )
        summaries = result.scalars().all()

    energy_data = [
        {
            "date": s.date,
            "solar_kwh": round(s.solar_generated_kwh or 0, 2),
            "imported_kwh": round(s.grid_imported_kwh or 0, 2),
            "exported_kwh": round(s.grid_exported_kwh or 0, 2),
            "consumed_kwh": round(s.home_consumed_kwh or 0, 2),
            "battery_charged_kwh": round(s.battery_charged_kwh or 0, 2),
            "battery_discharged_kwh": round(s.battery_discharged_kwh or 0, 2),
        }
        for s in summaries
    ]

    from services.collector import get_latest_status
    status = get_latest_status()
    today_data = {}
    if status:
        today_data = {
            "solar_power_w": status.solar_power,
            "grid_power_w": status.grid_power,
            "battery_soc": status.battery_soc,
            "home_power_w": status.home_power,
            "operation_mode": status.operation_mode,
        }
    if energy_data:
        today_data.update(energy_data[-1])

    forecast = None
    try:
        from api.routes_history import _get_cached
        forecast = await _get_cached("forecast_for_ai", lambda: _fetch_forecast_summary())
    except Exception:
        pass

    return await generate_insights(energy_data, today_data, forecast)


@router.get("/anomalies")
async def ai_anomalies():
    """Detect energy anomalies using AI."""
    if not is_configured():
        return {"anomalies": [], "error": "AI provider not configured. Add an API key in Settings."}

    async with async_session() as session:
        since = datetime.utcnow() - timedelta(hours=24)
        result = await session.execute(
            select(EnergyReading)
            .where(EnergyReading.timestamp >= since)
            .order_by(EnergyReading.timestamp.asc())
        )
        readings_raw = result.scalars().all()

        since_days = (date.today() - timedelta(days=30)).isoformat()
        result = await session.execute(
            select(DailyEnergySummary)
            .where(DailyEnergySummary.date >= since_days)
            .order_by(DailyEnergySummary.date.asc())
        )
        summaries_raw = result.scalars().all()

    # Convert UTC timestamps to local time so the AI sees correct times
    from zoneinfo import ZoneInfo
    user_tz_name = setup_store.get_timezone()
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/New_York")

    # Exclude grid_status — grid outages are handled by the dedicated health
    # alerts system with proper duration tracking. Sending it to the AI causes
    # false "Grid Outage" anomalies from brief status blips.
    readings = [
        {
            "timestamp": (r.timestamp.replace(tzinfo=ZoneInfo("UTC")).astimezone(user_tz)).strftime("%Y-%m-%d %I:%M %p"),
            "solar_w": r.solar_power,
            "grid_w": r.grid_power,
            "battery_w": r.battery_power,
            "home_w": r.home_power,
            "soc": r.battery_soc,
        }
        for r in readings_raw
    ]

    summaries = [
        {
            "date": s.date,
            "solar_generated_kwh": s.solar_generated_kwh,
            "grid_imported_kwh": s.grid_imported_kwh,
            "grid_exported_kwh": s.grid_exported_kwh,
            "home_consumed_kwh": s.home_consumed_kwh,
        }
        for s in summaries_raw
    ]

    return await detect_anomalies(readings, summaries)


@router.get("/bill-estimate")
async def ai_bill_estimate():
    """Get AI-estimated monthly electricity bill."""
    if not is_configured():
        return {"error": "AI provider not configured. Add an API key in Settings."}

    # Get this month's daily summaries
    today = date.today()
    month_start = today.replace(day=1).isoformat()

    async with async_session() as session:
        result = await session.execute(
            select(DailyEnergySummary)
            .where(DailyEnergySummary.date >= month_start)
            .order_by(DailyEnergySummary.date.asc())
        )
        summaries = result.scalars().all()

    daily_data = [
        {
            "date": s.date,
            "solar_generated_kwh": round(s.solar_generated_kwh or 0, 2),
            "grid_imported_kwh": round(s.grid_imported_kwh or 0, 2),
            "grid_exported_kwh": round(s.grid_exported_kwh or 0, 2),
            "home_consumed_kwh": round(s.home_consumed_kwh or 0, 2),
        }
        for s in summaries
    ]

    # Get rate info if available
    rate_info = None
    try:
        from tesla.commands import get_site_info
        info = await get_site_info()
        tariff = info.get("tariff_content", {})
        if tariff:
            from api.routes_status import site_tariff
            rate_info = await site_tariff()
    except Exception:
        pass

    return await estimate_monthly_bill(daily_data, rate_info)


class AskRequest(BaseModel):
    context: str  # The insight title + body
    question: str  # The follow-up question


# Pre-defined follow-up question templates by insight type
FOLLOWUP_TEMPLATES = {
    "achievement": [
        "How can I maintain this level of performance?",
        "How does this compare to typical homes in my area?",
        "What contributed most to this achievement?",
    ],
    "tip": [
        "What specific actions should I take?",
        "How much could this save me per month?",
        "When is the best time to implement this?",
    ],
    "warning": [
        "What is causing this issue?",
        "How urgent is this to address?",
        "What steps can I take to fix it?",
    ],
    "info": [
        "Can you explain this in more detail?",
        "How does this affect my energy costs?",
        "What should I watch for going forward?",
    ],
}


@router.get("/insights-with-followups")
async def ai_insights_with_followups():
    """Get AI insights with pre-generated follow-up questions."""
    result = await ai_insights()

    if result.get("insights"):
        for insight in result["insights"]:
            insight_type = insight.get("type", "info")
            insight["followup_questions"] = FOLLOWUP_TEMPLATES.get(insight_type, FOLLOWUP_TEMPLATES["info"])

    return result


@router.post("/ask")
async def ai_ask(data: AskRequest):
    """Stream an AI response to a follow-up question about an insight."""
    if not is_configured():
        raise HTTPException(status_code=400, detail="AI provider not configured")

    client, model = _get_ai_client()
    if not client:
        raise HTTPException(status_code=500, detail="Failed to create AI client")

    system_prompt = (
        "You are a knowledgeable home energy advisor. The user is asking a follow-up question "
        "about an energy insight from their solar + battery monitoring system. "
        "Give a helpful, specific, and concise answer (2-4 sentences). "
        "Reference specific numbers when possible. Be practical and actionable."
    )

    user_prompt = f"Original insight:\n{data.context}\n\nFollow-up question: {data.question}"

    async def generate():
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.7,
                max_tokens=300,
                stream=True,
            )

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'text': text})}\n\n"

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            logger.error("AI ask streaming error: %s", e)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _fetch_forecast_summary():
    """Helper to get a simple forecast summary for AI context."""
    try:
        from services.weather import get_forecast_summary
        forecast = await get_forecast_summary()
        if forecast:
            return {
                "today_kwh": forecast.get("today", {}).get("estimated_kwh"),
                "tomorrow_kwh": forecast.get("tomorrow", {}).get("estimated_kwh"),
                "condition": forecast.get("today", {}).get("condition"),
            }
    except Exception:
        pass
    return None
