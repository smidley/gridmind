"""Partial-peak arbitrage logic for GridMind Optimize.

During PARTIAL_PEAK periods (e.g., 7am-5pm), this module calculates whether
it makes sense to dump some battery to the grid and recover via solar before
ON_PEAK starts.

The strategy:
1. Estimate solar production remaining until ON_PEAK
2. Estimate home load consumption until ON_PEAK
3. Calculate net recoverable energy = solar - home_load
4. Only dump battery if we can recover before peak starts
5. Set reserve to limit dump to recoverable amount
"""

import logging
from datetime import datetime
from typing import Optional

from database import async_session, SolarForecast, EnergyReading
from sqlalchemy import select, func
from services import setup_store

logger = logging.getLogger(__name__)


async def get_solar_forecast_until_hour(target_hour: int) -> float:
    """Get estimated solar production (kWh) from now until target_hour.
    
    Args:
        target_hour: Hour (0-23) to forecast until (e.g., 17 for 5pm)
    
    Returns:
        Estimated kWh of solar production remaining
    """
    from zoneinfo import ZoneInfo
    
    user_tz_name = setup_store.get_timezone() or "America/Los_Angeles"
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/Los_Angeles")
    
    local_now = datetime.now(user_tz)
    today = local_now.strftime("%Y-%m-%d")
    current_hour = local_now.hour
    
    if current_hour >= target_hour:
        return 0.0
    
    async with async_session() as session:
        result = await session.execute(
            select(SolarForecast).where(
                SolarForecast.date == today,
                SolarForecast.hour >= current_hour,
                SolarForecast.hour < target_hour,
            )
        )
        entries = result.scalars().all()
    
    if not entries:
        logger.debug("No solar forecast entries found for today")
        return 0.0
    
    # Sum estimated generation (W) and convert to kWh
    # Each entry is 1 hour, so W = Wh for that hour
    total_wh = sum(e.estimated_generation_w for e in entries)
    total_kwh = total_wh / 1000
    
    logger.debug("Solar forecast until hour %d: %.2f kWh from %d entries",
                 target_hour, total_kwh, len(entries))
    return total_kwh


async def get_average_home_load() -> float:
    """Get average home load (kW) from recent readings.
    
    Uses the last 2 hours of readings to estimate typical home consumption.
    
    Returns:
        Average home load in kW
    """
    from datetime import timedelta
    
    cutoff = datetime.utcnow() - timedelta(hours=2)
    
    async with async_session() as session:
        result = await session.execute(
            select(func.avg(EnergyReading.home_power)).where(
                EnergyReading.timestamp >= cutoff,
                EnergyReading.home_power.isnot(None),
            )
        )
        avg_watts = result.scalar()
    
    if avg_watts is None:
        # Default to 1.5 kW if no data
        return 1.5
    
    return avg_watts / 1000  # Convert to kW


async def calculate_partial_peak_arbitrage(
    battery_soc: float,
    battery_capacity_kwh: float,
    on_peak_start_hour: int,
    min_reserve_pct: float = 20.0,
    safety_buffer_pct: float = 10.0,
) -> Optional[dict]:
    """Calculate if partial-peak arbitrage makes sense.
    
    Args:
        battery_soc: Current battery state of charge (0-100)
        battery_capacity_kwh: Total battery capacity in kWh
        on_peak_start_hour: Hour when ON_PEAK starts (e.g., 17 for 5pm)
        min_reserve_pct: Minimum reserve to maintain (default 20%)
        safety_buffer_pct: Safety buffer to ensure full recovery (default 10%)
    
    Returns:
        dict with arbitrage calculation, or None if not feasible
    """
    from zoneinfo import ZoneInfo
    
    user_tz_name = setup_store.get_timezone() or "America/Los_Angeles"
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/Los_Angeles")
    
    local_now = datetime.now(user_tz)
    current_hour = local_now.hour
    hours_until_peak = on_peak_start_hour - current_hour
    
    if hours_until_peak <= 1:
        # Not enough time to dump and recover
        logger.debug("Partial-peak arb: only %d hours until peak, skipping", hours_until_peak)
        return None
    
    # Get solar forecast and home load estimates
    solar_remaining_kwh = await get_solar_forecast_until_hour(on_peak_start_hour)
    avg_home_load_kw = await get_average_home_load()
    
    # Calculate home consumption until peak
    home_consumption_kwh = avg_home_load_kw * hours_until_peak
    
    # Net energy that can charge the battery
    # Solar goes to home first, excess charges battery
    net_recoverable_kwh = max(0, solar_remaining_kwh - home_consumption_kwh)
    
    # Apply safety buffer
    safe_recoverable_kwh = net_recoverable_kwh * (1 - safety_buffer_pct / 100)
    
    # Current battery energy
    current_battery_kwh = (battery_soc / 100) * battery_capacity_kwh
    min_battery_kwh = (min_reserve_pct / 100) * battery_capacity_kwh
    
    # How much can we dump?
    # We want to dump enough that solar can recover it, but not more
    # Target: dump down to (100% - recoverable%), but not below min_reserve
    recoverable_pct = (safe_recoverable_kwh / battery_capacity_kwh) * 100
    target_reserve_pct = max(min_reserve_pct, 100 - recoverable_pct)
    
    # Only proceed if we'd dump at least 10% of capacity (worth the effort)
    dump_pct = battery_soc - target_reserve_pct
    if dump_pct < 10:
        logger.debug("Partial-peak arb: only %.1f%% to dump, not worth it", dump_pct)
        return None
    
    dump_kwh = (dump_pct / 100) * battery_capacity_kwh
    
    result = {
        "feasible": True,
        "current_soc": round(battery_soc, 1),
        "target_reserve_pct": round(target_reserve_pct, 0),
        "dump_pct": round(dump_pct, 1),
        "dump_kwh": round(dump_kwh, 2),
        "solar_remaining_kwh": round(solar_remaining_kwh, 2),
        "home_consumption_kwh": round(home_consumption_kwh, 2),
        "net_recoverable_kwh": round(net_recoverable_kwh, 2),
        "safe_recoverable_kwh": round(safe_recoverable_kwh, 2),
        "hours_until_peak": hours_until_peak,
        "avg_home_load_kw": round(avg_home_load_kw, 2),
        "calculated_at": local_now.isoformat(),
    }
    
    logger.info(
        "Partial-peak arb calculation: dump %.1f%% (%.1f kWh), "
        "solar remaining %.1f kWh, home load %.1f kWh, net recoverable %.1f kWh",
        dump_pct, dump_kwh, solar_remaining_kwh, home_consumption_kwh, net_recoverable_kwh
    )
    
    return result

