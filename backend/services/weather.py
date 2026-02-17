"""Solar forecast service using Open-Meteo API (free, no API key)."""

import logging
from datetime import datetime, date, timedelta

import httpx
from sqlalchemy import select, delete

from config import settings
from database import async_session, SolarForecast
from services import setup_store
from services.cache import cached

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def _get_solar_config() -> dict:
    """Get solar panel configuration from setup store with defaults."""
    return {
        "capacity_kw": float(setup_store.get("solar_capacity_kw") or 5.0),
        "tilt": float(setup_store.get("solar_tilt") or 30),        # degrees from horizontal
        "azimuth": float(setup_store.get("solar_azimuth") or 0),    # 0=South, -90=East, 90=West
        "dc_ac_ratio": float(setup_store.get("solar_dc_ac_ratio") or 1.2),
        "inverter_efficiency": float(setup_store.get("solar_inverter_efficiency") or 0.96),
        "system_losses": float(setup_store.get("solar_system_losses") or 14),  # percent
    }


async def fetch_solar_forecast() -> list[dict]:
    """Fetch solar irradiance forecast from Open-Meteo.

    Uses Global Tilted Irradiance (GTI) when panel tilt/azimuth are configured,
    falling back to horizontal GHI. Estimates PV output based on panel config.

    NOT cached — this function writes to the database as a side effect.
    Called by the scheduler every 6 hours.
    """
    latitude = setup_store.get_latitude()
    longitude = setup_store.get_longitude()
    timezone = setup_store.get_timezone()

    if not latitude or not longitude:
        logger.warning("Location not configured - skipping solar forecast")
        return []

    solar_config = _get_solar_config()

    # Build hourly variables - request both GHI and Global Tilted Irradiance (GTI)
    # GTI accounts for panel tilt and azimuth, giving more accurate results
    hourly_vars = [
        "shortwave_radiation",
        "global_tilted_irradiance",
        "cloud_cover",
        "temperature_2m",
    ]

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": ",".join(hourly_vars),
        "daily": "sunrise,sunset",
        "timezone": timezone,
        "forecast_days": 7,
        # These parameters control global_tilted_irradiance calculation
        "tilt": solar_config["tilt"],
        "azimuth": solar_config["azimuth"],
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
    # Prefer tilted irradiance (global_tilted_irradiance) if available, else use GHI
    radiation = (hourly.get("global_tilted_irradiance")
                 or hourly.get("shortwave_radiation", []))
    cloud_cover = hourly.get("cloud_cover", [])
    temperature = hourly.get("temperature_2m", [])

    # PV generation calculation parameters
    capacity_w = solar_config["capacity_kw"] * 1000
    inverter_eff = solar_config["inverter_efficiency"]
    system_loss_factor = 1 - (solar_config["system_losses"] / 100)

    forecasts = []
    for i, time_str in enumerate(times):
        dt = datetime.fromisoformat(time_str)
        irradiance = radiation[i] if i < len(radiation) else 0
        clouds = cloud_cover[i] if i < len(cloud_cover) else 0
        temp = temperature[i] if i < len(temperature) else 25

        # PV output estimation:
        # P = Irradiance/1000 * Capacity * InverterEff * (1 - SystemLosses) * TempFactor
        # Temperature coefficient: ~-0.4%/°C above 25°C for crystalline silicon
        temp_factor = 1.0 + (-0.004 * max(temp - 25, 0))

        estimated_watts = ((irradiance / 1000)
                          * capacity_w
                          * inverter_eff
                          * system_loss_factor
                          * temp_factor)

        forecasts.append({
            "date": dt.strftime("%Y-%m-%d"),
            "hour": dt.hour,
            "irradiance_wm2": irradiance,
            "estimated_generation_w": round(max(estimated_watts, 0), 1),
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
        # Remove ALL existing forecasts to avoid duplicates
        # (we always store the full 2-day window fresh)
        await session.execute(delete(SolarForecast))
        await session.flush()

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

    # Fetch all forecast days (up to 7 days ahead)
    week_end = (local_now + timedelta(days=7)).strftime("%Y-%m-%d")

    async with async_session() as session:
        result = await session.execute(
            select(SolarForecast).where(
                SolarForecast.date >= today,
                SolarForecast.date <= week_end,
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

    # Build 7-day forecast
    all_dates = sorted(set(e.date for e in entries))
    week = []
    for d in all_dates:
        day_entries = [e for e in entries if e.date == d]
        summary = summarize_day(day_entries, d)
        if summary:
            summary["date"] = d
            week.append(summary)

    return {
        "today": summarize_day(today_entries, today),
        "tomorrow": summarize_day(tomorrow_entries, tomorrow),
        "week": week,
    }


# WMO weather codes that indicate severe/storm conditions
STORM_CODES = {
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail",
}
SEVERE_CODES = {
    65: "Heavy rain",
    67: "Heavy freezing rain",
    75: "Heavy snowfall",
    77: "Snow grains",
    82: "Violent rain showers",
    86: "Heavy snow showers",
    **STORM_CODES,
}
WEATHER_DESCRIPTIONS = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Heavy freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snowfall",
    77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm",
}


@cached(ttl=3600, key_prefix="weather_forecast")
async def get_weather_forecast() -> dict:
    """Get 7-day weather forecast with storm/severe weather indicators.

    Cached for 1 hour to reduce API calls.
    """
    latitude = setup_store.get_latitude()
    longitude = setup_store.get_longitude()
    timezone = setup_store.get_timezone()

    if not latitude or not longitude:
        return {"days": []}

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
        "timezone": timezone,
        "forecast_days": 7,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(OPEN_METEO_URL, params=params, timeout=15.0)
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        logger.error("Failed to fetch weather forecast: %s", e)
        return {"days": []}

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    codes = daily.get("weather_code", [])
    max_temps = daily.get("temperature_2m_max", [])
    min_temps = daily.get("temperature_2m_min", [])
    precip = daily.get("precipitation_sum", [])
    wind_max = daily.get("wind_speed_10m_max", [])
    gusts_max = daily.get("wind_gusts_10m_max", [])

    days = []
    for i, d in enumerate(dates):
        code = codes[i] if i < len(codes) else 0
        is_severe = code in SEVERE_CODES
        is_storm = code in STORM_CODES

        days.append({
            "date": d,
            "weather_code": code,
            "description": WEATHER_DESCRIPTIONS.get(code, f"Code {code}"),
            "temp_high_c": max_temps[i] if i < len(max_temps) else None,
            "temp_low_c": min_temps[i] if i < len(min_temps) else None,
            "temp_high_f": round(max_temps[i] * 9/5 + 32) if i < len(max_temps) and max_temps[i] is not None else None,
            "temp_low_f": round(min_temps[i] * 9/5 + 32) if i < len(min_temps) and min_temps[i] is not None else None,
            "precipitation_mm": precip[i] if i < len(precip) else 0,
            "wind_max_kmh": wind_max[i] if i < len(wind_max) else 0,
            "gusts_max_kmh": gusts_max[i] if i < len(gusts_max) else 0,
            "is_severe": is_severe,
            "is_storm": is_storm,
            "storm_watch_likely": is_storm or (gusts_max[i] if i < len(gusts_max) else 0) > 80,
        })

    return {"days": days}
