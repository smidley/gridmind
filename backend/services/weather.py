"""Solar forecast service using Open-Meteo API (free, no API key)."""

import logging
from datetime import datetime, date, timedelta

import httpx
from sqlalchemy import select, delete

from config import settings
from database import async_session, SolarForecast
from services import setup_store

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


async def fetch_solar_forecast() -> list[dict]:
    """Fetch solar irradiance forecast from Open-Meteo.

    Returns hourly forecast for the next 2 days including:
    - Global horizontal irradiance (GHI)
    - Direct normal irradiance (DNI)
    - Cloud cover
    - Temperature
    """
    latitude = setup_store.get_latitude()
    longitude = setup_store.get_longitude()
    timezone = setup_store.get_timezone()

    if not latitude or not longitude:
        logger.warning("Location not configured - skipping solar forecast")
        return []

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "shortwave_radiation,direct_normal_irradiance,cloud_cover,temperature_2m",
        "timezone": timezone,
        "forecast_days": 2,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(OPEN_METEO_URL, params=params, timeout=15.0)
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        logger.error("Failed to fetch solar forecast: %s", e)
        return []

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    radiation = hourly.get("shortwave_radiation", [])
    cloud_cover = hourly.get("cloud_cover", [])

    forecasts = []
    for i, time_str in enumerate(times):
        dt = datetime.fromisoformat(time_str)
        irradiance = radiation[i] if i < len(radiation) else 0
        clouds = cloud_cover[i] if i < len(cloud_cover) else 0

        # Estimate solar generation from irradiance
        # This is a rough estimate - user should calibrate based on their system
        # Assuming ~10kW system with ~15% overall efficiency
        estimated_watts = irradiance * 10 * 0.15  # Rough estimate

        forecasts.append({
            "date": dt.strftime("%Y-%m-%d"),
            "hour": dt.hour,
            "irradiance_wm2": irradiance,
            "estimated_generation_w": round(estimated_watts, 1),
            "cloud_cover_pct": clouds,
        })

    # Store in database
    await _save_forecasts(forecasts)

    logger.info("Fetched solar forecast: %d hourly entries", len(forecasts))
    return forecasts


async def _save_forecasts(forecasts: list[dict]):
    """Save forecast data to database, replacing old entries."""
    async with async_session() as session:
        # Remove old forecasts
        today = date.today().isoformat()
        await session.execute(
            delete(SolarForecast).where(SolarForecast.date >= today)
        )

        for f in forecasts:
            entry = SolarForecast(
                date=f["date"],
                hour=f["hour"],
                irradiance_wm2=f["irradiance_wm2"],
                estimated_generation_w=f["estimated_generation_w"],
                cloud_cover_pct=f["cloud_cover_pct"],
            )
            session.add(entry)

        await session.commit()


async def get_forecast_summary() -> dict:
    """Get a summary of today's and tomorrow's solar forecast."""
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    async with async_session() as session:
        result = await session.execute(
            select(SolarForecast).where(
                SolarForecast.date.in_([today, tomorrow])
            ).order_by(SolarForecast.date, SolarForecast.hour)
        )
        entries = result.scalars().all()

    if not entries:
        return {"today": None, "tomorrow": None}

    def summarize_day(day_entries):
        if not day_entries:
            return None
        total_kwh = sum(e.estimated_generation_w for e in day_entries) / 1000  # Wh to kWh
        avg_cloud = sum(e.cloud_cover_pct for e in day_entries) / len(day_entries)
        peak_w = max(e.estimated_generation_w for e in day_entries)

        # Classify the day
        if avg_cloud < 25:
            condition = "sunny"
        elif avg_cloud < 60:
            condition = "partly_cloudy"
        else:
            condition = "cloudy"

        return {
            "estimated_kwh": round(total_kwh, 2),
            "peak_watts": round(peak_w, 0),
            "avg_cloud_cover": round(avg_cloud, 1),
            "condition": condition,
            "hourly": [
                {
                    "hour": e.hour,
                    "generation_w": e.estimated_generation_w,
                    "cloud_pct": e.cloud_cover_pct,
                }
                for e in day_entries
            ],
        }

    today_entries = [e for e in entries if e.date == today]
    tomorrow_entries = [e for e in entries if e.date == tomorrow]

    return {
        "today": summarize_day(today_entries),
        "tomorrow": summarize_day(tomorrow_entries),
    }
