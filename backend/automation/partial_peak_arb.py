"""Partial-peak solar arbitrage for GridMind Optimize.

During PARTIAL_PEAK (mid-peak) periods, calculates whether the battery can
dump to the grid and have solar recover the charge before ON_PEAK starts.

Strategy:
1. Estimate solar production remaining until ON_PEAK
2. Estimate home load consumption until ON_PEAK
3. Net recoverable = solar surplus that can recharge the battery
4. Only dump what solar can recover — battery enters peak at the same SOC

Safety:
- 15% buffer on solar recovery estimate
- Never dump below 20% reserve
- Minimum 10% capacity dump (not worth it for tiny amounts)
- Minimum 1 hour until peak (need time to recover)
- If solar forecast unavailable, skip entirely
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select

from database import async_session, SolarForecast, EnergyReading
from services import setup_store

logger = logging.getLogger(__name__)

SAFETY_BUFFER_PCT = 15  # Reduce solar estimate by this %
MIN_DUMP_PCT = 10       # Don't bother dumping less than this
MIN_HOURS_TO_PEAK = 1   # Need at least 1 hour to recover
NORMAL_RESERVE_PCT = 20 # Never dump below this


async def get_solar_forecast_until_hour(target_hour: int) -> float:
    """Get total forecasted solar generation (kWh) from now until target hour.

    Uses the SolarForecast table (populated by the weather service every 6 hours).
    """
    from zoneinfo import ZoneInfo
    user_tz = ZoneInfo(setup_store.get_timezone() or "America/New_York")
    now = datetime.now(user_tz)
    today = now.strftime("%Y-%m-%d")

    async with async_session() as session:
        result = await session.execute(
            select(SolarForecast)
            .where(
                SolarForecast.date == today,
                SolarForecast.hour >= now.hour,
                SolarForecast.hour < target_hour,
            )
            .order_by(SolarForecast.hour.asc())
        )
        forecasts = result.scalars().all()

    if not forecasts:
        return 0.0

    # Each forecast entry is estimated_generation_w for that hour
    # Sum them up: watts * 1 hour = Wh, convert to kWh
    total_wh = sum(f.estimated_generation_w or 0 for f in forecasts)
    return total_wh / 1000


async def get_average_home_load_kw() -> float:
    """Get recent average home load in kW from the last 2 hours of readings."""
    from sqlalchemy import func
    from datetime import timedelta

    cutoff = datetime.utcnow() - timedelta(hours=2)

    async with async_session() as session:
        result = await session.execute(
            select(func.avg(EnergyReading.home_power))
            .where(EnergyReading.timestamp >= cutoff)
        )
        avg_watts = result.scalar()

    if avg_watts is None:
        return 1.5  # Default 1.5 kW if no data

    return max(avg_watts / 1000, 0.3)  # At least 0.3 kW baseline


async def calculate_arbitrage(
    battery_soc: float,
    battery_capacity_kwh: float,
    peak_start_hour: int,
) -> Optional[dict]:
    """Calculate if partial-peak arbitrage is feasible.

    Returns dict with target_reserve_pct and breakdown, or None if not feasible.
    """
    from zoneinfo import ZoneInfo
    user_tz = ZoneInfo(setup_store.get_timezone() or "America/New_York")
    now = datetime.now(user_tz)
    hours_until_peak = peak_start_hour - now.hour

    if hours_until_peak <= MIN_HOURS_TO_PEAK:
        logger.debug("Partial-peak arb: only %d hours until peak, skipping", hours_until_peak)
        return None

    # Get solar forecast and home load
    solar_remaining_kwh = await get_solar_forecast_until_hour(peak_start_hour)
    if solar_remaining_kwh <= 0:
        logger.debug("Partial-peak arb: no solar forecast data, skipping")
        return None

    avg_home_load_kw = await get_average_home_load_kw()
    home_consumption_kwh = avg_home_load_kw * hours_until_peak

    # Net recoverable = solar surplus after powering home
    net_recoverable_kwh = max(0, solar_remaining_kwh - home_consumption_kwh)

    # Apply safety buffer
    safe_recoverable_kwh = net_recoverable_kwh * (1 - SAFETY_BUFFER_PCT / 100)

    # How much can we dump? Convert to percentage of battery capacity
    recoverable_pct = (safe_recoverable_kwh / battery_capacity_kwh) * 100 if battery_capacity_kwh > 0 else 0

    # Target reserve = current SOC - recoverable (but never below normal reserve)
    target_reserve_pct = max(NORMAL_RESERVE_PCT, battery_soc - recoverable_pct)

    # Actual dump amount
    dump_pct = battery_soc - target_reserve_pct
    dump_kwh = (dump_pct / 100) * battery_capacity_kwh

    if dump_pct < MIN_DUMP_PCT:
        logger.debug("Partial-peak arb: only %.1f%% to dump (need %d%%), skipping",
                      dump_pct, MIN_DUMP_PCT)
        return None

    result = {
        "feasible": True,
        "current_soc": round(battery_soc, 1),
        "target_reserve_pct": round(target_reserve_pct, 0),
        "dump_pct": round(dump_pct, 1),
        "dump_kwh": round(dump_kwh, 1),
        "solar_remaining_kwh": round(solar_remaining_kwh, 1),
        "home_consumption_kwh": round(home_consumption_kwh, 1),
        "net_recoverable_kwh": round(net_recoverable_kwh, 1),
        "safe_recoverable_kwh": round(safe_recoverable_kwh, 1),
        "hours_until_peak": hours_until_peak,
        "avg_home_load_kw": round(avg_home_load_kw, 1),
        "safety_buffer_pct": SAFETY_BUFFER_PCT,
        "calculated_at": now.isoformat(),
    }

    logger.info(
        "Partial-peak arb: dump %.1f%% (%.1f kWh), solar=%.1f kWh, home=%.1f kWh, "
        "net recoverable=%.1f kWh, target reserve=%d%%, %d hrs to peak",
        dump_pct, dump_kwh, solar_remaining_kwh, home_consumption_kwh,
        net_recoverable_kwh, target_reserve_pct, hours_until_peak,
    )

    return result
