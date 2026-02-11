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
        "daily": "sunrise,sunset",
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
        # Uses the user's configured solar capacity (kW) if set, otherwise defaults to 5kW
        # Standard Test Conditions (STC) irradiance is 1000 W/m²
        # Real-world factor ~0.75-0.85 accounts for temperature, inverter, wiring losses
        solar_capacity_kw = float(setup_store.get("solar_capacity_kw") or 5.0)
        system_factor = float(setup_store.get("solar_efficiency_factor") or 0.80)
        estimated_watts = (irradiance / 1000) * solar_capacity_kw * 1000 * system_factor

        forecasts.append({
            "date": dt.strftime("%Y-%m-%d"),
            "hour": dt.hour,
            "irradiance_wm2": irradiance,
            "estimated_generation_w": round(estimated_watts, 1),
            "cloud_cover_pct": clouds,
        })

    # Store sunrise/sunset data
    daily_data = data.get("daily", {})
    daily_dates = daily_data.get("time", [])
    sunrises = daily_data.get("sunrise", [])
    sunsets = daily_data.get("sunset", [])

    sun_times = {}
    for i, d_str in enumerate(daily_dates):
        sun_times[d_str] = {
            "sunrise": sunrises[i] if i < len(sunrises) else None,
            "sunset": sunsets[i] if i < len(sunsets) else None,
        }

    # Save sun times to setup store for quick access
    setup_store.set("sun_times", sun_times)

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
    # Use user's timezone for "today" calculation, not UTC
    from zoneinfo import ZoneInfo
    user_tz_name = setup_store.get_timezone()
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/New_York")

    local_now = datetime.now(user_tz)
    today = local_now.strftime("%Y-%m-%d")
    tomorrow = (local_now + timedelta(days=1)).strftime("%Y-%m-%d")

    async with async_session() as session:
        result = await session.execute(
            select(SolarForecast).where(
                SolarForecast.date.in_([today, tomorrow])
            ).order_by(SolarForecast.date, SolarForecast.hour)
        )
        entries = result.scalars().all()

    if not entries:
        return {"today": None, "tomorrow": None}

    # Get sun times from store
    sun_times = setup_store.get("sun_times") or {}
    now = local_now

    def summarize_day(day_entries, day_date_str):
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

        # Sunrise/sunset
        day_sun = sun_times.get(day_date_str, {})
        sunrise = day_sun.get("sunrise")
        sunset = day_sun.get("sunset")

        # Calculate remaining sunlight and energy (only for today)
        remaining_kwh = None
        remaining_sunlight_hours = None
        if day_date_str == today:
            # Sum generation from current hour onwards
            remaining_entries = [e for e in day_entries if e.hour >= now.hour]
            remaining_kwh = round(sum(e.estimated_generation_w for e in remaining_entries) / 1000, 2)

            # Calculate remaining sunlight from sunset
            if sunset:
                try:
                    sunset_dt = datetime.fromisoformat(sunset)
                    if not sunset_dt.tzinfo:
                        sunset_dt = sunset_dt.replace(tzinfo=user_tz)
                    remaining_seconds = (sunset_dt - now).total_seconds()
                    remaining_sunlight_hours = round(max(remaining_seconds / 3600, 0), 1)
                except Exception:
                    pass

        result = {
            "estimated_kwh": round(total_kwh, 2),
            "peak_watts": round(peak_w, 0),
            "avg_cloud_cover": round(avg_cloud, 1),
            "condition": condition,
            "sunrise": sunrise,
            "sunset": sunset,
            "remaining_kwh": remaining_kwh,
            "remaining_sunlight_hours": remaining_sunlight_hours,
            "hourly": [
                {
                    "hour": e.hour,
                    "generation_w": e.estimated_generation_w,
                    "cloud_pct": e.cloud_cover_pct,
                }
                for e in day_entries
            ],
        }
        return result

    today_entries = [e for e in entries if e.date == today]
    tomorrow_entries = [e for e in entries if e.date == tomorrow]

    return {
        "today": summarize_day(today_entries, today),
        "tomorrow": summarize_day(tomorrow_entries, tomorrow),
    }
