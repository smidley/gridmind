"""GridMind Optimize -- Smart Peak Export Strategy Engine.

When enabled, this mode intelligently manages the Powerwall during peak TOU hours:
1. At peak start: switches to self-powered to avoid grid imports
2. During peak: monitors battery SOC, home load, and time remaining
3. Calculates the optimal moment to start dumping battery to grid
4. Dumps battery for maximum export credits before peak ends
5. At peak end: restores normal operation

The dump timing adapts daily based on:
- Current battery level and capacity
- Real-time home consumption (rolling average)
- Max battery discharge rate
- Time remaining in the peak window
"""

import logging
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from config import settings
from services import setup_store
from services.collector import get_latest_status

logger = logging.getLogger(__name__)

# State
_state = {
    "enabled": False,
    "phase": "idle",          # idle | peak_hold | dumping | complete
    "peak_start_hour": 17,    # 5pm
    "peak_end_hour": 21,      # 9pm
    "buffer_minutes": 15,     # Safety buffer
    "min_reserve_pct": 5,     # Don't dump below this
    "dump_started_at": None,
    "estimated_finish": None,
    "last_calculation": None,
    "pre_optimize_mode": None,
    "pre_optimize_reserve": None,
}


def get_state() -> dict:
    """Get the current optimizer state."""
    return {
        "enabled": _state["enabled"],
        "phase": _state["phase"],
        "peak_start_hour": _state["peak_start_hour"],
        "peak_end_hour": _state["peak_end_hour"],
        "buffer_minutes": _state["buffer_minutes"],
        "min_reserve_pct": _state["min_reserve_pct"],
        "dump_started_at": _state["dump_started_at"],
        "estimated_finish": _state["estimated_finish"],
        "last_calculation": _state["last_calculation"],
    }


def init():
    """Restore optimizer state from persistent storage on startup."""
    if setup_store.get("gridmind_optimize_enabled"):
        _state["enabled"] = True
        _state["peak_start_hour"] = int(setup_store.get("gridmind_optimize_peak_start") or 17)
        _state["peak_end_hour"] = int(setup_store.get("gridmind_optimize_peak_end") or 21)
        _state["buffer_minutes"] = int(setup_store.get("gridmind_optimize_buffer") or 15)
        _state["min_reserve_pct"] = int(setup_store.get("gridmind_optimize_min_reserve") or 5)

        # Check if we're currently in peak hours and set phase accordingly
        # so the dashboard doesn't show "Waiting for Peak" for the first 2 minutes
        try:
            tz = ZoneInfo(setup_store.get_timezone() or settings.timezone)
            now = datetime.now(tz)
            current_hour = now.hour
            if _state["peak_start_hour"] <= current_hour < _state["peak_end_hour"]:
                _state["phase"] = "peak_hold"
                logger.info("GridMind Optimize restored: currently in peak hours, entering peak_hold")
            else:
                _state["phase"] = "idle"
                logger.info("GridMind Optimize restored: outside peak hours")
        except Exception:
            _state["phase"] = "idle"

        logger.info("GridMind Optimize restored from config: enabled, peak %d:00-%d:00",
                     _state["peak_start_hour"], _state["peak_end_hour"])


def enable(peak_start: int = 17, peak_end: int = 21, buffer: int = 15, min_reserve: int = 5):
    """Enable GridMind Optimize mode."""
    _state["enabled"] = True
    _state["peak_start_hour"] = peak_start
    _state["peak_end_hour"] = peak_end
    _state["buffer_minutes"] = buffer
    _state["min_reserve_pct"] = min_reserve

    # Immediately check if we're in peak hours
    try:
        tz = ZoneInfo(setup_store.get_timezone() or settings.timezone)
        current_hour = datetime.now(tz).hour
        if peak_start <= current_hour < peak_end:
            _state["phase"] = "peak_hold"
            logger.info("GridMind Optimize enabled during peak hours — entering peak_hold")
        else:
            _state["phase"] = "idle"
    except Exception:
        _state["phase"] = "idle"

    # Persist all settings
    setup_store.set("gridmind_optimize_enabled", True)
    setup_store.set("gridmind_optimize_peak_start", peak_start)
    setup_store.set("gridmind_optimize_peak_end", peak_end)
    setup_store.set("gridmind_optimize_buffer", buffer)
    setup_store.set("gridmind_optimize_min_reserve", min_reserve)
    logger.info("GridMind Optimize enabled: peak %d:00-%d:00, buffer %dm", peak_start, peak_end, buffer)


def disable():
    """Disable GridMind Optimize mode."""
    _state["enabled"] = False
    _state["phase"] = "idle"
    _state["dump_started_at"] = None
    _state["estimated_finish"] = None
    setup_store.set("gridmind_optimize_enabled", False)
    logger.info("GridMind Optimize disabled")


def _get_local_now() -> datetime:
    """Get current time in user's timezone."""
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")
    return datetime.now(tz)


def _get_capacity_info() -> dict:
    """Get battery capacity info."""
    # PW3 = 13.5 kWh per unit, max output from site config
    battery_count = 2  # Default
    capacity_kwh = battery_count * 13.5
    max_power_kw = 11.5

    # Try to get from cached site config
    try:
        from tesla.commands import _cached_site_config
        if _cached_site_config:
            battery_count = _cached_site_config.get("battery_count", 2)
            capacity_kwh = battery_count * 13.5
            max_power_kw = _cached_site_config.get("nameplate_power", 11520) / 1000
    except Exception:
        pass

    return {
        "capacity_kwh": capacity_kwh,
        "max_power_kw": max_power_kw,
    }


async def evaluate():
    """Main evaluation loop -- called every ~2 minutes by the scheduler.

    Determines what phase we're in and takes appropriate action.
    """
    if not _state["enabled"]:
        return

    now = _get_local_now()
    hour = now.hour
    peak_start = _state["peak_start_hour"]
    peak_end = _state["peak_end_hour"]

    status = get_latest_status()
    if status is None:
        return

    # Before peak: ensure we're ready
    if hour < peak_start:
        if _state["phase"] != "idle":
            _state["phase"] = "idle"
        return

    # After peak: restore and reset
    if hour >= peak_end:
        if _state["phase"] in ("peak_hold", "dumping"):
            await _end_peak()
        _state["phase"] = "complete" if hour < peak_end + 1 else "idle"
        return

    # During peak hours
    if _state["phase"] == "idle":
        # Peak just started -- enter hold phase
        await _start_peak_hold(status)
        return

    if _state["phase"] == "peak_hold":
        # Check if it's time to start dumping
        await _check_dump_timing(status, now)
        return

    if _state["phase"] == "dumping":
        # Monitor dump progress
        await _monitor_dump(status, now)
        return


async def _start_peak_hold(status):
    """Peak hours started -- switch to self-powered to hold battery."""
    from tesla.commands import set_operation_mode, set_backup_reserve, set_grid_import_export, get_site_config

    logger.info("GridMind Optimize: Peak started, entering hold phase")

    # Save current settings from Tesla (not cached values)
    try:
        config = await get_site_config()
        _state["pre_optimize_mode"] = config.get("operation_mode", "autonomous")
        _state["pre_optimize_reserve"] = config.get("backup_reserve_percent", 20)
        _state["pre_optimize_export"] = config.get("export_rule", "battery_ok")
    except Exception:
        _state["pre_optimize_mode"] = status.operation_mode
        _state["pre_optimize_reserve"] = status.backup_reserve
        _state["pre_optimize_export"] = "battery_ok"

    _state["phase"] = "peak_hold"

    try:
        # Self-powered mode, hold current battery level
        await set_operation_mode("self_consumption")
        # Disable grid charging
        await set_grid_import_export(disallow_charge_from_grid_with_solar_installed=True)
        logger.info("GridMind Optimize: Holding battery at %.1f%% SOC", status.battery_soc)
    except Exception as e:
        logger.error("GridMind Optimize: Failed to enter hold phase: %s", e)


async def _check_dump_timing(status, now: datetime):
    """Calculate if it's time to start dumping battery to grid."""
    cap = _get_capacity_info()
    peak_end = _state["peak_end_hour"]
    buffer_min = _state["buffer_minutes"]
    min_reserve = _state["min_reserve_pct"]

    # Available energy to dump
    available_pct = max(status.battery_soc - min_reserve, 0)
    available_kwh = (available_pct / 100) * cap["capacity_kwh"]

    if available_kwh <= 0.5:
        # Not enough to dump
        _state["last_calculation"] = {
            "time": now.isoformat(),
            "decision": "skip",
            "reason": "Not enough energy to dump",
            "available_kwh": round(available_kwh, 2),
        }
        return

    # Estimate home load from current reading
    home_load_kw = max(status.home_power, 0) / 1000

    # Use rolling average if we have it (more stable)
    # For now, use current + a buffer for variability
    estimated_home_kw = max(home_load_kw * 1.1, 0.5)  # 10% buffer, min 500W

    # Net export rate (what actually goes to grid)
    net_export_kw = max(cap["max_power_kw"] - estimated_home_kw, 1.0)

    # Time needed to dump
    hours_needed = available_kwh / net_export_kw
    minutes_needed = hours_needed * 60

    # Time remaining until peak ends
    peak_end_time = now.replace(hour=peak_end, minute=0, second=0)
    minutes_remaining = (peak_end_time - now).total_seconds() / 60

    # Decision: start dumping when we need to
    trigger_at = minutes_remaining - buffer_min

    _state["last_calculation"] = {
        "time": now.isoformat(),
        "battery_soc": round(status.battery_soc, 1),
        "available_kwh": round(available_kwh, 1),
        "home_load_kw": round(estimated_home_kw, 1),
        "net_export_kw": round(net_export_kw, 1),
        "minutes_needed": round(minutes_needed, 0),
        "minutes_remaining": round(minutes_remaining, 0),
        "trigger_at_minutes": round(trigger_at, 0),
        "decision": "wait" if minutes_needed < trigger_at else "dump",
    }

    if minutes_needed >= trigger_at:
        # Time to dump!
        estimated_finish = now + timedelta(minutes=minutes_needed)
        logger.info(
            "GridMind Optimize: DUMPING -- %.1f kWh at %.1f kW net, estimated finish %s",
            available_kwh, net_export_kw, estimated_finish.strftime("%H:%M"),
        )
        await _start_dump(estimated_finish)
    else:
        logger.debug(
            "GridMind Optimize: Holding -- need %.0f min, have %.0f min (trigger at %.0f)",
            minutes_needed, minutes_remaining, trigger_at,
        )


async def _start_dump(estimated_finish: datetime):
    """Start the battery dump to grid."""
    from tesla.commands import set_grid_import_export, set_backup_reserve, set_operation_mode
    from services.notifications import send_notification

    _state["phase"] = "dumping"
    _state["dump_started_at"] = datetime.now().isoformat()
    _state["estimated_finish"] = estimated_finish.strftime("%H:%M")

    try:
        # Switch to autonomous (Time-Based Control) so the Powerwall actively exports
        # Self-consumption mode only supplements home load — it won't push to grid
        await set_operation_mode("autonomous")
        # Allow battery export to grid
        await set_grid_import_export(customer_preferred_export_rule="battery_ok")
        # Set reserve to minimum to allow full dump
        await set_backup_reserve(_state["min_reserve_pct"])

        await send_notification(
            "GridMind Optimize: Battery Dump Started",
            f"Exporting battery to grid for peak credits. Estimated finish: {estimated_finish.strftime('%I:%M %p')}",
            "info",
        )
    except Exception as e:
        logger.error("GridMind Optimize: Failed to start dump: %s", e)


async def _monitor_dump(status, now: datetime):
    """Monitor dump progress."""
    min_reserve = _state["min_reserve_pct"]

    if status.battery_soc <= min_reserve + 1:
        logger.info("GridMind Optimize: Dump complete, battery at %.1f%%", status.battery_soc)
        # Battery is drained to reserve, stop exporting
        from tesla.commands import set_grid_import_export
        try:
            await set_grid_import_export(customer_preferred_export_rule="pv_only")
        except Exception:
            pass
        _state["phase"] = "complete"


async def _end_peak():
    """Peak hours ended -- restore normal operation."""
    from tesla.commands import set_operation_mode, set_backup_reserve, set_grid_import_export
    from services.notifications import send_notification

    logger.info("GridMind Optimize: Peak ended, restoring normal operation")

    prev_mode = _state.get("pre_optimize_mode") or "autonomous"
    prev_reserve = _state.get("pre_optimize_reserve") or 20
    prev_export = _state.get("pre_optimize_export") or "battery_ok"

    try:
        await set_operation_mode(prev_mode)
        await set_backup_reserve(prev_reserve)
        await set_grid_import_export(
            disallow_charge_from_grid_with_solar_installed=False,
            customer_preferred_export_rule=prev_export,
        )
        await send_notification(
            "GridMind Optimize: Peak Ended",
            f"Restored to {prev_mode} mode with {prev_reserve}% reserve.",
            "info",
        )
    except Exception as e:
        logger.error("GridMind Optimize: Failed to restore: %s", e)

    _state["phase"] = "idle"
    _state["dump_started_at"] = None
    _state["estimated_finish"] = None
