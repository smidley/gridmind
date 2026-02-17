"""Smart EV charge scheduler - TOU-aware, solar surplus, and departure planner strategies.

Evaluates every 2 minutes and adjusts vehicle charging based on the selected strategy.
"""

import logging
import math
from datetime import datetime, time as dtime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from services import setup_store
from services.collector import get_latest_status
from services.vehicle_collector import get_latest_vehicle_status
from tesla.client import tesla_client, TeslaAPIError
from tesla.vehicle_commands import charge_start, charge_stop, set_charging_amps

logger = logging.getLogger(__name__)


def _get_local_now() -> datetime:
    """Get current time in user's configured timezone."""
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")
    return datetime.now(tz)

# Track scheduler state
_scheduler_state: dict = {
    "last_action": None,
    "last_action_time": None,
    "charging_by_scheduler": False,
}


def get_schedule_config() -> dict:
    """Get the current schedule configuration."""
    schedule = setup_store.get("ev_schedule", {})
    if not isinstance(schedule, dict):
        return {"strategy": "off"}
    return schedule


def get_state() -> dict:
    """Get the current scheduler state for API/UI."""
    config = get_schedule_config()
    return {
        "strategy": config.get("strategy", "off"),
        "active": config.get("strategy", "off") != "off",
        "last_action": _scheduler_state.get("last_action"),
        "last_action_time": _scheduler_state.get("last_action_time"),
        "charging_by_scheduler": _scheduler_state.get("charging_by_scheduler", False),
    }


def _get_current_tou_period() -> dict | None:
    """Determine the current TOU period using Tesla tariff data.

    Returns dict with 'name' and 'rate' or None if not available.
    """
    try:
        from services import setup_store as ss
        import json

        # Try to get tariff data from cached site info
        # This mirrors the approach in routes_status.py
        from tesla.commands import _cached_site_config
        tariff = _cached_site_config.get("tariff_content", {})
        if not tariff:
            return None

        periods = tariff.get("periods", {})
        sell_tariff = tariff.get("sell_tariff", {})

        now = _get_local_now()
        current_hour = now.hour
        current_day = now.weekday()  # 0=Monday

        # Map Tesla day format
        day_names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        today_name = day_names[current_day]

        # Check which period we're in
        for period_name, schedule in periods.items():
            for entry in schedule:
                days = entry.get("days", [])
                if today_name not in days:
                    continue
                start_h = entry.get("start_hour", 0)
                end_h = entry.get("end_hour", 24)
                if start_h <= current_hour < end_h:
                    # Get the rate for this period
                    rate = 0
                    for rate_entry in sell_tariff.get("periods", {}).get(period_name, []):
                        rate = rate_entry.get("rate", 0)
                        break
                    return {
                        "name": period_name,
                        "rate": rate,
                        "is_peak": "peak" in period_name.lower() and "off" not in period_name.lower(),
                    }

        return None
    except Exception as e:
        logger.debug("Could not determine TOU period: %s", e)
        return None


def _is_peak_period() -> bool:
    """Check if we're currently in a peak TOU period."""
    period = _get_current_tou_period()
    if period is None:
        return False
    return period.get("is_peak", False)


async def _safe_charge_start(vehicle_id: str) -> bool:
    """Start charging with error handling. Returns True on success."""
    try:
        await charge_start(vehicle_id)
        _scheduler_state["last_action"] = "charge_start"
        _scheduler_state["last_action_time"] = _get_local_now().isoformat()
        _scheduler_state["charging_by_scheduler"] = True
        return True
    except TeslaAPIError as e:
        logger.warning("Failed to start charge: %s", e)
        return False


async def _safe_charge_stop(vehicle_id: str) -> bool:
    """Stop charging with error handling. Returns True on success."""
    try:
        await charge_stop(vehicle_id)
        _scheduler_state["last_action"] = "charge_stop"
        _scheduler_state["last_action_time"] = _get_local_now().isoformat()
        _scheduler_state["charging_by_scheduler"] = False
        return True
    except TeslaAPIError as e:
        logger.warning("Failed to stop charge: %s", e)
        return False


async def _safe_set_amps(vehicle_id: str, amps: int) -> bool:
    """Set charging amps with error handling. Returns True on success."""
    try:
        await set_charging_amps(vehicle_id, amps)
        _scheduler_state["last_action"] = f"set_amps_{amps}"
        _scheduler_state["last_action_time"] = _get_local_now().isoformat()
        return True
    except TeslaAPIError as e:
        logger.warning("Failed to set amps to %d: %s", amps, e)
        return False


async def _strategy_tou_aware(vehicle_id: str, charge_state: dict):
    """TOU-aware strategy: charge during off-peak, pause during peak."""
    charging = charge_state.get("charging_state") == "Charging"
    plugged_in = charge_state.get("charging_state") not in ("Disconnected", None)
    at_limit = charge_state.get("battery_level", 0) >= charge_state.get("charge_limit_soc", 100)

    if not plugged_in or at_limit:
        return

    is_peak = _is_peak_period()

    if is_peak and charging:
        logger.info("TOU: Peak period detected, stopping charge")
        await _safe_charge_stop(vehicle_id)
    elif not is_peak and not charging:
        logger.info("TOU: Off-peak period, starting charge")
        await _safe_charge_start(vehicle_id)


async def _strategy_solar_surplus(vehicle_id: str, charge_state: dict, config: dict):
    """Solar surplus strategy: charge when solar exceeds home load."""
    threshold_kw = config.get("solar_surplus_threshold_kw", 1.5)
    min_soc = config.get("solar_surplus_min_soc", 20)

    charging = charge_state.get("charging_state") == "Charging"
    plugged_in = charge_state.get("charging_state") not in ("Disconnected", None)
    at_limit = charge_state.get("battery_level", 0) >= charge_state.get("charge_limit_soc", 100)
    battery_level = charge_state.get("battery_level", 0)

    if not plugged_in or at_limit:
        return

    # Get current solar and home power from energy collector
    energy_status = get_latest_status()
    if energy_status is None:
        return

    solar_kw = energy_status.solar_power / 1000
    home_kw = energy_status.home_power / 1000
    surplus_kw = solar_kw - home_kw

    # Also charge if vehicle SOC is critically low regardless of solar
    critical_low = battery_level < min_soc

    if surplus_kw >= threshold_kw or critical_low:
        if not charging:
            logger.info(
                "Solar surplus: %.1f kW surplus (threshold %.1f kW), starting charge",
                surplus_kw, threshold_kw,
            )
            await _safe_charge_start(vehicle_id)

        # Adjust amps proportional to surplus (approximate: 240V single phase)
        # Each amp at 240V = 0.24 kW
        max_amps = charge_state.get("charge_current_request_max", 32)
        if surplus_kw > 0:
            target_amps = min(int(surplus_kw / 0.24), max_amps)
            target_amps = max(target_amps, 1)  # Minimum 1 amp
        else:
            target_amps = max_amps if critical_low else 1

        current_amps = charge_state.get("charger_actual_current", 0)
        # Only adjust if difference is significant (avoid constant API calls)
        if abs(target_amps - current_amps) >= 2:
            logger.info("Solar surplus: adjusting amps from %d to %d", current_amps, target_amps)
            await _safe_set_amps(vehicle_id, target_amps)

    elif charging and _scheduler_state.get("charging_by_scheduler"):
        # Surplus dropped below threshold, stop charging (only if we started it)
        logger.info("Solar surplus: %.1f kW below threshold, stopping charge", surplus_kw)
        await _safe_charge_stop(vehicle_id)


async def _strategy_departure(vehicle_id: str, charge_state: dict, config: dict):
    """Departure planner: calculate optimal start time for target SOC by departure."""
    departure_time_str = config.get("departure_time", "07:30")
    target_soc = config.get("departure_target_soc", 80)
    battery_capacity = config.get("battery_capacity_kwh", 75.0)

    charging = charge_state.get("charging_state") == "Charging"
    plugged_in = charge_state.get("charging_state") not in ("Disconnected", None)
    current_soc = charge_state.get("battery_level", 0)
    at_target = current_soc >= target_soc

    if not plugged_in or at_target:
        if charging and at_target and _scheduler_state.get("charging_by_scheduler"):
            logger.info("Departure: target SOC %d%% reached, stopping", target_soc)
            await _safe_charge_stop(vehicle_id)
        return

    # Parse departure time
    try:
        dep_h, dep_m = map(int, departure_time_str.split(":"))
        departure = dtime(dep_h, dep_m)
    except (ValueError, AttributeError):
        departure = dtime(7, 30)

    now = _get_local_now()
    today_departure = now.replace(hour=departure.hour, minute=departure.minute, second=0, microsecond=0)

    # If departure is already past today, target tomorrow
    if today_departure <= now:
        today_departure += timedelta(days=1)

    hours_until_departure = (today_departure - now).total_seconds() / 3600

    # Calculate charge needed
    soc_needed = target_soc - current_soc
    energy_needed_kwh = (soc_needed / 100) * battery_capacity

    # Estimate charge rate (use current if charging, otherwise assume ~7 kW home charging)
    charge_rate_kw = charge_state.get("charger_power", 0)
    if charge_rate_kw <= 0:
        charge_rate_kw = 7.0  # Default assumption for home L2

    hours_to_charge = energy_needed_kwh / charge_rate_kw if charge_rate_kw > 0 else float("inf")

    # Add 30 min buffer
    hours_to_charge += 0.5

    # Determine if we should be charging now
    should_charge = hours_until_departure <= hours_to_charge

    # Prefer off-peak: if not urgent, delay to off-peak
    if not should_charge and _is_peak_period():
        # Don't start during peak unless we have to
        should_charge = False
    elif should_charge and _is_peak_period():
        # Must charge during peak if time is tight
        logger.info("Departure: charging during peak - time is tight (%.1fh needed, %.1fh until departure)",
                     hours_to_charge, hours_until_departure)

    if should_charge and not charging:
        logger.info(
            "Departure: starting charge (need %.1f kWh, %.1fh to charge, %.1fh until departure)",
            energy_needed_kwh, hours_to_charge, hours_until_departure,
        )
        await _safe_charge_start(vehicle_id)
    elif not should_charge and charging and _scheduler_state.get("charging_by_scheduler"):
        logger.info("Departure: pausing charge (%.1fh until departure, only need %.1fh)",
                     hours_until_departure, hours_to_charge)
        await _safe_charge_stop(vehicle_id)


async def _apply_hybrid_charge_limit(vehicle_id: str, charge_state: dict, config: dict):
    """Hybrid charge limit: charge from any source up to grid_limit, then solar-only up to solar_limit.

    Example: grid_charge_limit=80, solar_charge_limit=100
    - Below 80%: charge from any source normally
    - Between 80-100%: only charge when solar surplus is available
    - At 100%: stop
    """
    grid_limit = config.get("grid_charge_limit", 0)
    solar_limit = config.get("solar_charge_limit", 0)

    # 0 = disabled
    if grid_limit <= 0 or solar_limit <= 0:
        return

    battery_level = charge_state.get("battery_level", 0)
    charging = charge_state.get("charging_state") == "Charging"
    plugged_in = charge_state.get("charging_state") not in ("Disconnected", None)

    if not plugged_in:
        return

    if battery_level >= solar_limit:
        # At or above solar limit — stop charging
        if charging and _scheduler_state.get("charging_by_scheduler"):
            logger.info("Hybrid limit: at solar limit %d%%, stopping", solar_limit)
            await _safe_charge_stop(vehicle_id)
        return

    if battery_level < grid_limit:
        # Below grid limit — charge from any source (let other strategies or normal charging handle this)
        return

    # Between grid_limit and solar_limit — only charge from solar surplus
    energy_status = get_latest_status()
    if energy_status is None:
        return

    solar_kw = energy_status.solar_power / 1000
    home_kw = energy_status.home_power / 1000
    surplus_kw = solar_kw - home_kw

    threshold = config.get("solar_surplus_threshold_kw", 1.5)

    if surplus_kw >= threshold:
        if not charging:
            logger.info("Hybrid limit: SOC %d%% (grid limit %d%%), solar surplus %.1f kW, starting solar charge",
                        battery_level, grid_limit, surplus_kw)
            await _safe_charge_start(vehicle_id)

        # Adjust amps to match surplus
        max_amps = charge_state.get("charge_current_request_max", 32)
        target_amps = min(int(surplus_kw / 0.24), max_amps)
        target_amps = max(target_amps, 1)
        current_amps = charge_state.get("charger_actual_current", 0)
        if abs(target_amps - current_amps) >= 2:
            await _safe_set_amps(vehicle_id, target_amps)
    elif charging and _scheduler_state.get("charging_by_scheduler"):
        logger.info("Hybrid limit: SOC %d%% above grid limit %d%%, no solar surplus, stopping",
                    battery_level, grid_limit)
        await _safe_charge_stop(vehicle_id)


async def evaluate():
    """Main scheduler evaluation - runs every 2 minutes."""
    if not tesla_client.is_authenticated:
        return

    config = get_schedule_config()
    strategy = config.get("strategy", "off")

    if strategy == "off":
        return

    vehicle_id = setup_store.get("selected_vehicle_id")
    if not vehicle_id:
        return

    # Wall Connector signals from Powerwall (always fresh, no car wake needed)
    energy_status = get_latest_status()
    wc_power = getattr(energy_status, "wall_connector_power", 0) if energy_status else 0
    wc_state = getattr(energy_status, "wall_connector_state", 0) if energy_status else 0
    wc_connected = wc_state > 2
    wc_charging = wc_power > 50

    # If WC shows car isn't plugged in, skip — nothing to schedule
    if not wc_connected and not wc_charging:
        return

    # Get current vehicle status
    vehicle_status = get_latest_vehicle_status()
    if vehicle_status is None or vehicle_status.charge_state is None:
        # No vehicle data but WC shows plugged in — can't make SOC decisions yet.
        # The vehicle collector will poll soon since WC shows activity.
        logger.debug("Charge scheduler: WC shows connected but no vehicle data yet, waiting")
        return

    # Build a simple dict of charge state for strategy functions.
    # Enrich with WC signals for more accurate real-time charging state.
    cs = vehicle_status.charge_state
    charge_data = {
        "charging_state": cs.charging_state,
        "battery_level": cs.battery_level,
        "charge_limit_soc": cs.charge_limit_soc,
        "charger_power": cs.charger_power,
        "charger_actual_current": cs.charger_actual_current,
        "charge_current_request_max": cs.charge_current_request_max,
    }

    # Override stale vehicle charging_state with WC ground truth.
    # WC power updates every 30s; vehicle data can be 60+ min stale when asleep.
    if wc_charging and charge_data["charging_state"] != "Charging":
        charge_data["charging_state"] = "Charging"
        charge_data["charger_power"] = wc_power / 1000  # Convert W → kW
    elif wc_connected and not wc_charging and charge_data["charging_state"] == "Disconnected":
        # WC says plugged in but vehicle data says Disconnected (stale)
        charge_data["charging_state"] = "Stopped"

    # Apply hybrid charge limit logic first (works with any strategy or standalone)
    await _apply_hybrid_charge_limit(vehicle_id, charge_data, config)

    try:
        if strategy == "tou_aware":
            await _strategy_tou_aware(vehicle_id, charge_data)
        elif strategy == "solar_surplus":
            await _strategy_solar_surplus(vehicle_id, charge_data, config)
        elif strategy == "departure":
            await _strategy_departure(vehicle_id, charge_data, config)
        else:
            logger.warning("Unknown EV schedule strategy: %s", strategy)
    except Exception as e:
        logger.exception("Error in charge scheduler (%s): %s", strategy, e)
