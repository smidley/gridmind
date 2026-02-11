"""API routes for historical energy data and charts."""

import time
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, EnergyReading, DailyEnergySummary
from services.weather import get_forecast_summary
from tesla.client import tesla_client, TeslaAPIError
from tesla.commands import get_energy_history

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/history", tags=["history"])

# --- Tesla Energy Data Cache ---
# Cache Tesla API responses to avoid rate limiting while allowing fast frontend polling

_cache: dict = {}
_cache_times: dict = {}
CACHE_TTL = 120  # 2 minutes


async def _get_cached(key: str, fetch_fn, ttl: int = CACHE_TTL):
    """Return cached data or fetch fresh if stale."""
    now = time.time()
    if key in _cache and (now - _cache_times.get(key, 0)) < ttl:
        return _cache[key]
    try:
        data = await fetch_fn()
        _cache[key] = data
        _cache_times[key] = now
        return data
    except Exception as e:
        # Return stale cache if available, otherwise raise
        if key in _cache:
            logger.warning("Using stale cache for %s: %s", key, e)
            return _cache[key]
        raise


@router.get("/readings")
async def get_readings(
    hours: int = Query(default=24, ge=1, le=168),
    resolution: int = Query(default=1, ge=1, le=60, description="Minutes between samples"),
    db: AsyncSession = Depends(get_db),
):
    """Get energy readings for the specified time window.

    Args:
        hours: Number of hours to look back (1-168, default 24)
        resolution: Resolution in minutes (1-60, default 1 = every reading)
    """
    since = datetime.utcnow() - timedelta(hours=hours)

    result = await db.execute(
        select(EnergyReading)
        .where(EnergyReading.timestamp >= since)
        .order_by(EnergyReading.timestamp)
    )
    readings = result.scalars().all()

    # Downsample if resolution > 1 minute
    if resolution > 1 and readings:
        sampled = []
        last_time = None
        for r in readings:
            if last_time is None or (r.timestamp - last_time).total_seconds() >= resolution * 60:
                sampled.append(r)
                last_time = r.timestamp
        readings = sampled

    return {
        "count": len(readings),
        "readings": [
            {
                "timestamp": r.timestamp.isoformat(),
                "battery_soc": r.battery_soc,
                "battery_power": r.battery_power,
                "solar_power": r.solar_power,
                "grid_power": r.grid_power,
                "home_power": r.home_power,
                "grid_status": r.grid_status,
            }
            for r in readings
        ],
    }


@router.get("/daily")
async def get_daily_summary(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get daily energy summaries."""
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    result = await db.execute(
        select(DailyEnergySummary)
        .where(DailyEnergySummary.date >= since)
        .order_by(DailyEnergySummary.date)
    )
    summaries = result.scalars().all()

    return {
        "count": len(summaries),
        "summaries": [
            {
                "date": s.date,
                "solar_generated_kwh": s.solar_generated_kwh,
                "grid_imported_kwh": s.grid_imported_kwh,
                "grid_exported_kwh": s.grid_exported_kwh,
                "home_consumed_kwh": s.home_consumed_kwh,
                "battery_charged_kwh": s.battery_charged_kwh,
                "battery_discharged_kwh": s.battery_discharged_kwh,
            }
            for s in summaries
        ],
    }


async def _fetch_today_totals():
    """Fetch today's totals from Tesla (internal, used by cache)."""
    data = await get_energy_history(period="day", kind="energy")
    time_series = data.get("time_series", [])

    solar_kwh = 0.0
    grid_import_kwh = 0.0
    grid_export_kwh = 0.0
    home_kwh = 0.0
    battery_charged_kwh = 0.0
    battery_discharged_kwh = 0.0

    for entry in time_series:
        solar_kwh += max(entry.get("solar_energy_exported", 0), 0) / 1000
        home_kwh += max(entry.get("consumer_energy_imported_from_grid", 0) +
                      entry.get("consumer_energy_imported_from_solar", 0) +
                      entry.get("consumer_energy_imported_from_battery", 0), 0) / 1000
        grid_from = entry.get("grid_energy_imported", 0)
        grid_to = entry.get("grid_energy_exported_from_solar", 0) + entry.get("grid_energy_exported_from_battery", 0)
        grid_import_kwh += max(grid_from, 0) / 1000
        grid_export_kwh += max(grid_to, 0) / 1000
        battery_charged_kwh += max(entry.get("battery_energy_imported_from_grid", 0) +
                                  entry.get("battery_energy_imported_from_solar", 0), 0) / 1000
        battery_discharged_kwh += max(entry.get("battery_energy_exported", 0), 0) / 1000

    return {
        "solar_generated_kwh": round(solar_kwh, 2),
        "grid_imported_kwh": round(grid_import_kwh, 2),
        "grid_exported_kwh": round(grid_export_kwh, 2),
        "home_consumed_kwh": round(home_kwh, 2),
        "battery_charged_kwh": round(battery_charged_kwh, 2),
        "battery_discharged_kwh": round(battery_discharged_kwh, 2),
        "source": "tesla",
    }


@router.get("/today")
async def get_today_totals():
    """Get today's energy totals (cached, refreshes every 2 minutes from Tesla)."""
    if not tesla_client.is_authenticated:
        return {
            "solar_generated_kwh": 0,
            "grid_imported_kwh": 0,
            "grid_exported_kwh": 0,
            "home_consumed_kwh": 0,
            "battery_charged_kwh": 0,
            "battery_discharged_kwh": 0,
            "source": "none",
        }

    try:
        return await _get_cached("today_totals", _fetch_today_totals)
    except Exception:
        return await _compute_today_from_readings()


async def _compute_today_from_readings():
    """Fallback: compute today's totals from local readings."""
    from datetime import date
    from database import async_session

    start_of_day = datetime.combine(date.today(), datetime.min.time())

    async with async_session() as session:
        result = await session.execute(
            select(EnergyReading)
            .where(EnergyReading.timestamp >= start_of_day)
            .order_by(EnergyReading.timestamp)
        )
        readings = result.scalars().all()

    if not readings:
        return {
            "solar_generated_kwh": 0,
            "grid_imported_kwh": 0,
            "grid_exported_kwh": 0,
            "home_consumed_kwh": 0,
            "battery_charged_kwh": 0,
            "battery_discharged_kwh": 0,
            "source": "local",
        }

    total_seconds = (readings[-1].timestamp - readings[0].timestamp).total_seconds() if len(readings) > 1 else 30
    avg_interval_hours = (total_seconds / max(len(readings) - 1, 1)) / 3600

    return {
        "solar_generated_kwh": round(sum(max(r.solar_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "grid_imported_kwh": round(sum(max(r.grid_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "grid_exported_kwh": round(sum(abs(min(r.grid_power or 0, 0)) for r in readings) * avg_interval_hours / 1000, 2),
        "home_consumed_kwh": round(sum(max(r.home_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "battery_charged_kwh": round(sum(max(r.battery_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "battery_discharged_kwh": round(sum(abs(min(r.battery_power or 0, 0)) for r in readings) * avg_interval_hours / 1000, 2),
        "source": "local",
    }


@router.get("/value")
async def get_energy_value(
    days: int = Query(default=1, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """Calculate the financial value of energy production and consumption.

    Uses Tesla's tariff data to compute:
    - Export credits (what you earned selling to the grid)
    - Import costs (what you would have paid without solar)
    - Solar self-consumption savings
    - Net value
    """
    from tesla.client import tesla_client, TeslaAPIError
    from tesla.commands import get_site_info, get_energy_history
    from services import setup_store
    from zoneinfo import ZoneInfo

    if not tesla_client.is_authenticated:
        return {"error": "Not authenticated"}

    # Get tariff data
    try:
        info = await get_site_info()
    except TeslaAPIError:
        return {"error": "Could not fetch site info"}

    tariff = info.get("tariff_content", {})
    if not tariff:
        return {"error": "No tariff configured"}

    # Get user timezone
    user_tz_name = setup_store.get_timezone()
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/New_York")

    # Parse rate schedule
    seasons = tariff.get("seasons", {})
    energy_charges = tariff.get("energy_charges", {})
    sell_tariff = tariff.get("sell_tariff", {})
    sell_charges = sell_tariff.get("energy_charges", energy_charges)

    # Get today's energy data from Tesla
    try:
        data = await get_energy_history(period="day", kind="energy")
    except TeslaAPIError:
        return {"error": "Could not fetch energy history"}

    time_series = data.get("time_series", [])

    # Helper to determine TOU period for a given hour/day
    def get_period_and_rate(hour: int, day_of_week: int, month: int, is_sell: bool = False):
        charges = sell_charges if is_sell else energy_charges
        for season_name, season_data in seasons.items():
            from_month = season_data.get("fromMonth", 1)
            to_month = season_data.get("toMonth", 12)
            if from_month <= month <= to_month:
                tou_periods = season_data.get("tou_periods", {})
                for period_name, schedules in tou_periods.items():
                    schedule_list = schedules if isinstance(schedules, list) else []
                    for sched in schedule_list:
                        from_dow = sched.get("fromDayOfWeek", 0)
                        to_dow = sched.get("toDayOfWeek", 6)
                        from_hr = sched.get("fromHour", 0)
                        to_hr = sched.get("toHour", 0)

                        if not (from_dow <= day_of_week <= to_dow):
                            continue

                        # All-day period (weekends)
                        if from_hr == 0 and to_hr == 0:
                            rate = charges.get(season_name, {}).get(period_name, 0)
                            return period_name, rate

                        # Time check
                        if from_hr < to_hr:
                            if from_hr <= hour < to_hr:
                                rate = charges.get(season_name, {}).get(period_name, 0)
                                return period_name, rate
                        else:
                            if hour >= from_hr or hour < to_hr:
                                rate = charges.get(season_name, {}).get(period_name, 0)
                                return period_name, rate
        return "OFF_PEAK", 0

    # Calculate values
    now = datetime.now(user_tz)
    total_export_value = 0.0
    total_import_cost = 0.0
    total_solar_self_use_savings = 0.0
    period_breakdown = {}

    for entry in time_series:
        # Parse timestamp
        ts_str = entry.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            ts_local = ts.astimezone(user_tz)
        except Exception:
            continue

        hour = ts_local.hour
        dow = ts_local.weekday()
        month = ts_local.month

        _, buy_rate = get_period_and_rate(hour, dow, month, is_sell=False)
        period_name, sell_rate = get_period_and_rate(hour, dow, month, is_sell=True)

        # Energy values in Wh from Tesla, convert to kWh
        exported = (entry.get("grid_energy_exported_from_solar", 0) +
                   entry.get("grid_energy_exported_from_battery", 0)) / 1000
        imported = entry.get("grid_energy_imported", 0) / 1000
        solar_self = (entry.get("consumer_energy_imported_from_solar", 0) +
                     entry.get("consumer_energy_imported_from_battery", 0)) / 1000

        export_value = exported * sell_rate
        import_cost = imported * buy_rate
        self_use_savings = solar_self * buy_rate  # What you would have paid

        total_export_value += export_value
        total_import_cost += import_cost
        total_solar_self_use_savings += self_use_savings

        # Period breakdown
        display = {"OFF_PEAK": "Off-Peak", "ON_PEAK": "Peak", "PARTIAL_PEAK": "Mid-Peak"}.get(period_name, period_name)
        if display not in period_breakdown:
            period_breakdown[display] = {"exported_kwh": 0, "imported_kwh": 0, "export_value": 0, "import_cost": 0}
        period_breakdown[display]["exported_kwh"] += exported
        period_breakdown[display]["imported_kwh"] += imported
        period_breakdown[display]["export_value"] += export_value
        period_breakdown[display]["import_cost"] += import_cost

    # Net Value = Export Credits - Import Costs (actual grid cash flow)
    net_value = total_export_value - total_import_cost

    return {
        "period": "today",
        "utility": tariff.get("utility", ""),
        "plan": tariff.get("name", ""),
        "export_credits": round(total_export_value, 2),
        "import_costs": round(total_import_cost, 2),
        "solar_savings": round(total_solar_self_use_savings, 2),
        "net_value": round(net_value, 2),
        "period_breakdown": {
            k: {kk: round(vv, 2) for kk, vv in v.items()}
            for k, v in period_breakdown.items()
        },
    }


@router.get("/forecast")
async def solar_forecast():
    """Get solar generation forecast for today and tomorrow."""
    return await get_forecast_summary()


@router.post("/forecast/refresh")
async def refresh_forecast():
    """Manually trigger a solar forecast refresh."""
    from services.weather import fetch_solar_forecast
    forecasts = await fetch_solar_forecast()
    return {"refreshed": True, "hours": len(forecasts)}
