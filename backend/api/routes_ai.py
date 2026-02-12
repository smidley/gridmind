"""AI insights and anomaly detection routes."""

import logging
from datetime import datetime, timedelta, date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from database import async_session, EnergyReading, DailyEnergySummary
from services import setup_store
from services.ai_insights import generate_insights, detect_anomalies, is_configured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


class OpenAIKeyRequest(BaseModel):
    api_key: str


@router.get("/status")
async def ai_status():
    """Check if OpenAI is configured."""
    return {
        "configured": is_configured(),
        "has_key": bool(setup_store.get("openai_api_key", "")),
    }


@router.post("/configure")
async def ai_configure(data: OpenAIKeyRequest):
    """Save or update the OpenAI API key."""
    if not data.api_key.startswith("sk-"):
        raise HTTPException(status_code=400, detail="Invalid API key format (should start with sk-)")

    setup_store.set("openai_api_key", data.api_key)
    logger.info("OpenAI API key configured")
    return {"status": "ok"}


@router.delete("/configure")
async def ai_remove_key():
    """Remove the OpenAI API key."""
    setup_store.set("openai_api_key", "")
    logger.info("OpenAI API key removed")
    return {"status": "ok"}


@router.get("/insights")
async def ai_insights():
    """Get AI-generated energy insights."""
    if not is_configured():
        return {"insights": [], "error": "OpenAI not configured. Add your API key in Settings."}

    # Gather data for the AI
    async with async_session() as session:
        # Last 7 days of daily summaries
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

    # Today's data
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

    # Forecast
    forecast = None
    try:
        from api.routes_history import _get_cached
        forecast_data = await _get_cached("forecast_for_ai", lambda: _fetch_forecast_summary())
    except Exception:
        forecast_data = None

    return await generate_insights(energy_data, today_data, forecast_data)


@router.get("/anomalies")
async def ai_anomalies():
    """Detect energy anomalies using AI."""
    if not is_configured():
        return {"anomalies": [], "error": "OpenAI not configured. Add your API key in Settings."}

    async with async_session() as session:
        # Last 24h of readings (sampled)
        since = datetime.utcnow() - timedelta(hours=24)
        result = await session.execute(
            select(EnergyReading)
            .where(EnergyReading.timestamp >= since)
            .order_by(EnergyReading.timestamp.asc())
        )
        readings_raw = result.scalars().all()

        # Last 30 days of summaries for baseline
        since_days = (date.today() - timedelta(days=30)).isoformat()
        result = await session.execute(
            select(DailyEnergySummary)
            .where(DailyEnergySummary.date >= since_days)
            .order_by(DailyEnergySummary.date.asc())
        )
        summaries_raw = result.scalars().all()

    readings = [
        {
            "timestamp": r.timestamp.isoformat(),
            "solar_w": r.solar_power,
            "grid_w": r.grid_power,
            "battery_w": r.battery_power,
            "home_w": r.home_power,
            "soc": r.battery_soc,
            "grid_status": r.grid_status,
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


async def _fetch_forecast_summary():
    """Helper to get a simple forecast summary for AI context."""
    try:
        from services.weather import get_cached_forecast
        forecast = get_cached_forecast()
        if forecast:
            return {
                "today_kwh": forecast.get("today", {}).get("estimated_kwh"),
                "tomorrow_kwh": forecast.get("tomorrow", {}).get("estimated_kwh"),
                "condition": forecast.get("today", {}).get("condition"),
            }
    except Exception:
        pass
    return None
