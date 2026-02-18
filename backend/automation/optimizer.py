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
    # Verbose thinking feed (last 8 plain-text lines)
    "thoughts": [],
    "last_evaluate_at": None,
}


def _think(msg: str):
    """Record a thought for the verbose thinking feed."""
    _state["thoughts"].append(msg)
    if len(_state["thoughts"]) > 8:
        _state["thoughts"] = _state["thoughts"][-8:]


def _set_phase(phase: str):
    """Set the optimizer phase and persist it for restart recovery."""
    _state["phase"] = phase
    setup_store.set("gridmind_optimize_phase", phase)
    setup_store.set("gridmind_optimize_phase_time", _get_local_now().isoformat())


def get_state() -> dict:
    """Get the current optimizer state, including live TOU info."""
    result = {
        "enabled": _state["enabled"],
        "phase": _state["phase"],
        "peak_start_hour": _state["peak_start_hour"],
        "peak_end_hour": _state["peak_end_hour"],
        "buffer_minutes": _state["buffer_minutes"],
        "min_reserve_pct": _state["min_reserve_pct"],
        "dump_started_at": _state["dump_started_at"],
        "estimated_finish": _state["estimated_finish"],
        "last_calculation": _state["last_calculation"],
        "tou_source": _state.get("_tou_source", "manual"),
        "dump_paused": _state.get("_dump_paused", False),
    }

    # Add live TOU period info so the dashboard can show weekend/off-peak status
    if _state["enabled"]:
        try:
            now = _get_local_now()
            tou = _get_tou_peak_info(now)
            period_display_map = {
                "OFF_PEAK": "Off-Peak",
                "ON_PEAK": "Peak",
                "PARTIAL_PEAK": "Mid-Peak",
            }
            tou_period_name = tou.get("period_name", "OFF_PEAK")
            result["current_tou_period"] = period_display_map.get(tou_period_name, tou_period_name)
            result["tou_in_peak"] = tou["in_peak"]

            is_weekday = now.weekday() < 5
            peak_start = _get_peak_start_hour(now)
            result["tou_has_peak_today"] = is_weekday and peak_start is not None

            # Verbose section for detail page
            status = get_latest_status()
            current_inputs = {}
            if status:
                current_inputs = {
                    "battery_soc": round(status.battery_soc, 1),
                    "battery_power": round(status.battery_power, 0),
                    "solar_power": round(status.solar_power, 0),
                    "grid_power": round(status.grid_power, 0),
                    "home_power": round(status.home_power, 0),
                    "operation_mode": status.operation_mode,
                    "backup_reserve": round(status.backup_reserve, 0),
                }

            # Minutes until peak
            minutes_until_peak = None
            if peak_start is not None and not tou["in_peak"]:
                peak_start_time = now.replace(hour=peak_start, minute=0, second=0)
                if peak_start_time > now:
                    minutes_until_peak = int((peak_start_time - now).total_seconds() / 60)

            # Clean grid info
            clean_grid_info = {
                "enabled": bool(setup_store.get("gridmind_clean_grid_enabled")),
                "active": _state.get("_clean_grid_active", False),
                "fossil_pct": None,
                "threshold": int(setup_store.get("gridmind_fossil_threshold_pct") or 50),
            }
            try:
                from services.grid_mix import get_cached_mix
                mix = get_cached_mix()
                if mix:
                    clean_grid_info["fossil_pct"] = mix.get("fossil_pct")
            except Exception:
                pass

            result["verbose"] = {
                "thoughts": list(_state.get("thoughts", [])),
                "current_inputs": current_inputs,
                "tou_context": {
                    "period_name": period_display_map.get(tou_period_name, tou_period_name),
                    "in_peak": tou["in_peak"],
                    "source": tou.get("source", "manual"),
                    "peak_start_hour": peak_start,
                    "peak_end_hour": _state["peak_end_hour"],
                    "is_weekday": is_weekday,
                    "minutes_until_peak": minutes_until_peak,
                },
                "clean_grid": clean_grid_info,
                "settings": {
                    "buffer_minutes": _state["buffer_minutes"],
                    "min_reserve_pct": _state["min_reserve_pct"],
                    "pre_optimize_mode": _state.get("pre_optimize_mode"),
                    "pre_optimize_reserve": _state.get("pre_optimize_reserve"),
                },
                "last_evaluate_at": _state.get("last_evaluate_at"),
            }
        except Exception:
            pass

    return result


def init():
    """Restore optimizer state from persistent storage on startup."""
    if setup_store.get("gridmind_optimize_enabled"):
        _state["enabled"] = True
        _state["peak_start_hour"] = int(setup_store.get("gridmind_optimize_peak_start") or 17)
        _state["peak_end_hour"] = int(setup_store.get("gridmind_optimize_peak_end") or 21)
        _state["buffer_minutes"] = int(setup_store.get("gridmind_optimize_buffer") or 15)
        _state["min_reserve_pct"] = int(setup_store.get("gridmind_optimize_min_reserve") or 5)

        # Restore pre-optimize settings from persistence (for _end_peak recovery)
        _state["pre_optimize_mode"] = setup_store.get("gridmind_optimize_pre_mode")
        _state["pre_optimize_reserve"] = setup_store.get("gridmind_optimize_pre_reserve")
        _state["pre_optimize_export"] = setup_store.get("gridmind_optimize_pre_export")
        _state["pre_optimize_grid_charging"] = setup_store.get("gridmind_optimize_pre_grid_charging", True)

        # Restore persisted phase, validated against current time
        # Uses weekend-aware check: most TOU plans are off-peak on weekends
        saved_phase = setup_store.get("gridmind_optimize_phase", "idle")
        try:
            tz = ZoneInfo(setup_store.get_timezone() or settings.timezone)
            now = datetime.now(tz)
            current_hour = now.hour
            is_weekday = now.weekday() < 5  # Mon-Fri
            in_peak = is_weekday and _state["peak_start_hour"] <= current_hour < _state["peak_end_hour"]

            if in_peak and saved_phase in ("dumping", "peak_hold"):
                # Restore the exact phase from before restart
                _state["phase"] = saved_phase
                _think(f"Container restarted — resuming {saved_phase} phase during peak")
                logger.info("GridMind Optimize restored: in peak hours (%s), resuming phase '%s'",
                            "weekday" if is_weekday else "weekend", saved_phase)
            elif in_peak:
                _state["phase"] = "peak_hold"
                _think("Container restarted during peak — entering hold phase")
                logger.info("GridMind Optimize restored: in peak hours, entering peak_hold")
            elif saved_phase in ("peak_hold", "dumping", "complete"):
                # Restarted after peak or on weekend — settings need restoring.
                # Set phase so evaluate() triggers _end_peak() on next cycle.
                _state["phase"] = saved_phase
                _think(f"Container restarted — restoring settings from {saved_phase} phase")
                logger.info("GridMind Optimize restored: not in peak (%s, hour=%d) with phase '%s', will restore settings",
                            "weekday" if is_weekday else "weekend", current_hour, saved_phase)
            else:
                _state["phase"] = "idle"
                _think("Container restarted — optimizer idle, waiting for peak")
                logger.info("GridMind Optimize restored: outside peak hours (%s)",
                            "weekday" if is_weekday else "weekend")
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
            _set_phase("peak_hold")
            logger.info("GridMind Optimize enabled during peak hours — entering peak_hold")
        else:
            _set_phase("idle")
    except Exception:
        _set_phase("idle")

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
    _set_phase("idle")
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


def _get_tou_peak_info(now: datetime) -> dict:
    """Check if the current time is in a peak TOU period using Tesla tariff data.

    Returns:
        {
            "in_peak": bool,
            "peak_end_minutes": int or None,  # minutes from midnight when current peak ends
            "period_name": str,               # e.g. "ON_PEAK", "PARTIAL_PEAK", "OFF_PEAK"
            "source": "tou" | "manual",       # whether using TOU data or manual hours
        }
    Falls back to the user's manual peak_start/peak_end hours if TOU data is unavailable.
    """
    # Try to read TOU schedule from Tesla's cached site config
    try:
        from tesla.commands import _cached_site_config
        if not _cached_site_config:
            raise ValueError("Site config not cached yet")

        # tariff_content can be at the top level or nested under components
        tariff = _cached_site_config.get("tariff_content", {})
        if not tariff or not tariff.get("seasons"):
            tariff = _cached_site_config.get("components", {}).get("tariff_content", {})
        if not tariff or not tariff.get("seasons"):
            logger.debug("GridMind Optimize TOU: no tariff_content in cache (top keys: %s), falling back to manual",
                         list(_cached_site_config.keys())[:10])
            raise ValueError("No TOU data")

        day_of_week = now.weekday()  # 0=Monday, 6=Sunday
        hour = now.hour
        minute = now.minute
        current_minutes = hour * 60 + minute

        seasons = tariff.get("seasons", {})
        energy_charges = tariff.get("energy_charges", {})

        # Find the active season
        for season_name, season_data in seasons.items():
            from_month = season_data.get("fromMonth", 1)
            to_month = season_data.get("toMonth", 12)
            if not (from_month <= now.month <= to_month):
                continue

            tou_periods = season_data.get("tou_periods", {})

            for period_name, schedules in tou_periods.items():
                schedule_list = schedules if isinstance(schedules, list) else []
                for sched in schedule_list:
                    from_dow = sched.get("fromDayOfWeek", 0)
                    to_dow = sched.get("toDayOfWeek", 6)

                    # Check day of week
                    if not (from_dow <= day_of_week <= to_dow):
                        continue

                    from_hr = sched.get("fromHour", 0)
                    from_min = sched.get("fromMinute", 0)
                    to_hr = sched.get("toHour", 0)
                    to_min = sched.get("toMinute", 0)
                    from_minutes = from_hr * 60 + from_min
                    to_minutes = to_hr * 60 + to_min

                    # All-day period (from 0:00 to 0:00)
                    if from_hr == 0 and to_hr == 0 and from_min == 0 and to_min == 0:
                        is_peak = period_name == "ON_PEAK"
                        return {
                            "in_peak": is_peak,
                            "peak_end_minutes": 24 * 60 if is_peak else None,
                            "period_name": period_name,
                            "source": "tou",
                        }

                    # Normal time range (e.g., 17:00 - 21:00)
                    in_range = False
                    if from_minutes < to_minutes:
                        in_range = from_minutes <= current_minutes < to_minutes
                    else:
                        # Overnight range (e.g., 21:00 - 7:00)
                        in_range = current_minutes >= from_minutes or current_minutes < to_minutes

                    if in_range:
                        is_peak = period_name == "ON_PEAK"
                        return {
                            "in_peak": is_peak,
                            "peak_end_minutes": to_minutes if is_peak else None,
                            "period_name": period_name,
                            "source": "tou",
                        }

        # No matching period found — default to off-peak
        return {"in_peak": False, "peak_end_minutes": None, "period_name": "OFF_PEAK", "source": "tou"}

    except Exception as e:
        # TOU data unavailable — fall back to manual peak hours (weekdays only)
        # Most TOU plans only have peak on weekdays (Mon-Fri)
        peak_start = _state["peak_start_hour"]
        peak_end = _state["peak_end_hour"]
        hour = now.hour
        is_weekday = now.weekday() < 5  # 0=Mon, 4=Fri, 5=Sat, 6=Sun
        in_peak = is_weekday and peak_start <= hour < peak_end

        logger.debug("GridMind Optimize TOU: manual fallback (%s, hour=%d, peak=%d-%d, in_peak=%s, reason=%s)",
                     "weekday" if is_weekday else "weekend", hour, peak_start, peak_end, in_peak, e)
        return {
            "in_peak": in_peak,
            "peak_end_minutes": peak_end * 60 if in_peak else None,
            "period_name": "ON_PEAK" if in_peak else "OFF_PEAK",
            "source": "manual",
        }


def _get_capacity_info() -> dict:
    """Get battery capacity info from centralized service."""
    from services.battery_capacity import get_battery_capacity_sync
    info = get_battery_capacity_sync()
    return {
        "capacity_kwh": info["capacity_kwh"],
        "max_power_kw": info["nameplate_power_kw"],
    }


async def _get_rolling_home_load_kw(fallback_watts: float = 0) -> float:
    """Get rolling average home load in kW from the last 2 hours of readings.

    Falls back to the provided current reading if no database data available.
    """
    try:
        from sqlalchemy import select, func
        from database import async_session, EnergyReading

        cutoff = datetime.utcnow() - timedelta(hours=2)
        async with async_session() as session:
            result = await session.execute(
                select(func.avg(EnergyReading.home_power))
                .where(EnergyReading.timestamp >= cutoff)
            )
            avg_watts = result.scalar()

        if avg_watts is not None and avg_watts > 0:
            return max(avg_watts / 1000, 0.3)
    except Exception as e:
        logger.debug("Failed to get rolling home load: %s", e)

    # Fallback to current reading with buffer
    return max(fallback_watts / 1000 * 1.1, 0.5)


def _get_peak_start_hour(now: datetime) -> int:
    """Find when ON_PEAK starts today from TOU data, or fall back to manual setting."""
    try:
        from tesla.commands import _cached_site_config
        if not _cached_site_config:
            raise ValueError("Site config not cached yet")

        tariff = _cached_site_config.get("tariff_content", {})
        if not tariff or not tariff.get("seasons"):
            tariff = _cached_site_config.get("components", {}).get("tariff_content", {})
        if not tariff or not tariff.get("seasons"):
            raise ValueError("No TOU data")

        day_of_week = now.weekday()
        seasons = tariff.get("seasons", {})

        for season_name, season_data in seasons.items():
            from_month = season_data.get("fromMonth", 1)
            to_month = season_data.get("toMonth", 12)
            if not (from_month <= now.month <= to_month):
                continue

            tou_periods = season_data.get("tou_periods", {})
            for period_name, schedules in tou_periods.items():
                if period_name != "ON_PEAK":
                    continue
                schedule_list = schedules if isinstance(schedules, list) else []
                for sched in schedule_list:
                    from_dow = sched.get("fromDayOfWeek", 0)
                    to_dow = sched.get("toDayOfWeek", 6)
                    if from_dow <= day_of_week <= to_dow:
                        return sched.get("fromHour", _state["peak_start_hour"])

    except Exception:
        pass

    return _state["peak_start_hour"]


async def _check_clean_grid_preference(status):
    """If clean grid preference is enabled, switch to self-consumption when grid is dirty.

    This is a soft preference — only active during off-peak hours and only when the
    battery has enough charge to sustain the home. Restores normal mode when grid cleans up.
    """
    if not setup_store.get("gridmind_clean_grid_enabled"):
        return

    from services.grid_mix import get_cached_mix

    mix = get_cached_mix()
    if not mix:
        return

    threshold = int(setup_store.get("gridmind_fossil_threshold_pct") or 50)
    fossil_pct = mix.get("fossil_pct", 0)
    grid_dirty = fossil_pct > threshold

    # Only act if battery has reasonable charge (>25%) to avoid draining it
    battery_ok = status.battery_soc > 25

    if grid_dirty and battery_ok and status.operation_mode != "self_consumption":
        # Grid is dirty — prefer battery/solar over grid
        if not _state.get("_clean_grid_active"):
            _think(f"Grid is {fossil_pct:.0f}% fossil (threshold {threshold}%) — switching to self-consumption")
            logger.info(
                "GridMind Clean Grid: fossil %.1f%% > %d%% threshold, switching to self-consumption",
                fossil_pct, threshold,
            )
            try:
                from tesla.commands import set_operation_mode
                await set_operation_mode("self_consumption")
                _state["_clean_grid_active"] = True
            except Exception as e:
                logger.error("Failed to switch to self-consumption for clean grid: %s", e)

    elif (not grid_dirty or not battery_ok) and _state.get("_clean_grid_active"):
        # Grid cleaned up or battery low — restore normal mode
        logger.info(
            "GridMind Clean Grid: restoring autonomous mode (fossil %.1f%%, battery %.0f%%)",
            fossil_pct, status.battery_soc,
        )
        try:
            from tesla.commands import set_operation_mode
            await set_operation_mode("autonomous")
            _state["_clean_grid_active"] = False
        except Exception as e:
            logger.error("Failed to restore autonomous mode: %s", e)


async def _check_stuck_reserve():
    """One-time check for a stuck reserve from a previous optimizer cycle.

    If the Powerwall's reserve is at or below min_reserve_pct (e.g. 5%) and we're
    not currently in a peak phase, the reserve was likely not restored properly.
    Fix it immediately.
    """
    if _state.get("_reserve_check_done"):
        return
    _state["_reserve_check_done"] = True

    # Only check when idle (not actively optimizing)
    if _state["phase"] != "idle":
        return

    status = get_latest_status()
    if status is None:
        return

    min_reserve = _state["min_reserve_pct"]
    actual_reserve = status.backup_reserve

    if actual_reserve <= min_reserve + 1:
        logger.warning(
            "GridMind Optimize: Reserve stuck at %.0f%% (min_reserve=%d%%) — restoring to 20%%",
            actual_reserve, min_reserve,
        )
        try:
            from tesla.commands import set_backup_reserve
            await set_backup_reserve(20)
            logger.info("GridMind Optimize: Successfully restored reserve to 20%%")
        except Exception as e:
            logger.error("GridMind Optimize: Failed to restore stuck reserve: %s", e)

        # Also clear any stale persisted pre-optimize values
        setup_store.update({
            "gridmind_optimize_pre_mode": None,
            "gridmind_optimize_pre_reserve": None,
            "gridmind_optimize_pre_export": None,
            "gridmind_optimize_pre_grid_charging": None,
        })


async def evaluate():
    """Main evaluation loop -- called every ~2 minutes by the scheduler.

    Uses TOU schedule from Tesla tariff data to determine peak periods.
    Falls back to manual peak_start/peak_end hours if TOU data unavailable.
    Handles weekends (off-peak all day) and seasonal schedules.
    """
    if not _state["enabled"]:
        return

    # One-time startup check for stuck reserve
    await _check_stuck_reserve()

    now = _get_local_now()
    _state["last_evaluate_at"] = now.isoformat()

    status = get_latest_status()
    if status is None:
        _think("Waiting for Powerwall data...")
        return

    _think(f"Battery at {status.battery_soc:.1f}% — solar {status.solar_power/1000:.1f} kW, home {status.home_power/1000:.1f} kW, grid {status.grid_power/1000:.1f} kW")

    # Safety: if peak_hold/dumping has been active for over 6 hours, something is wrong.
    # No peak window is that long — force restore to prevent getting stuck.
    if _state["phase"] in ("peak_hold", "dumping"):
        phase_persisted_at = setup_store.get("gridmind_optimize_phase_time")
        if phase_persisted_at:
            try:
                phase_age_hours = (now - datetime.fromisoformat(phase_persisted_at)).total_seconds() / 3600
                if phase_age_hours > 6:
                    _think(f"Phase '{_state['phase']}' stuck for {phase_age_hours:.0f}h — forcing restore")
                    logger.warning("GridMind Optimize: phase '%s' stuck for %.1f hours — forcing restore",
                                   _state["phase"], phase_age_hours)
                    await _end_peak()
                    return
            except Exception:
                pass

    # Check TOU schedule to determine if we're in peak
    tou = _get_tou_peak_info(now)
    in_peak = tou["in_peak"]
    period_display = {"OFF_PEAK": "Off-Peak", "ON_PEAK": "Peak", "PARTIAL_PEAK": "Mid-Peak"}
    period_name = period_display.get(tou.get("period_name", ""), tou.get("period_name", "unknown"))
    _think(f"TOU check: currently {period_name}" + (" — in peak window" if in_peak else ""))

    # Not in peak: restore settings if needed, otherwise idle
    if not in_peak:
        if _state["phase"] in ("peak_hold", "dumping", "complete"):
            _think("Peak ended — restoring normal operation")
            await _end_peak()
        elif _state["phase"] != "idle":
            _set_phase("idle")

        # Show time until peak if applicable
        peak_start = _get_peak_start_hour(now)
        is_weekday = now.weekday() < 5
        if is_weekday and peak_start is not None:
            peak_start_time = now.replace(hour=peak_start, minute=0, second=0)
            minutes_to_peak = int((peak_start_time - now).total_seconds() / 60)
            if minutes_to_peak > 0:
                time_str = f"{minutes_to_peak // 60}h {minutes_to_peak % 60}m" if minutes_to_peak >= 60 else f"{minutes_to_peak}m"
                _think(f"Peak starts at {peak_start if peak_start <= 12 else peak_start - 12}:00 {'PM' if peak_start >= 12 else 'AM'} — {time_str} from now")
            else:
                _think("Past peak hours — idle until tomorrow")
        elif not is_weekday:
            _think("Weekend — no peak period today")
        else:
            _think("Off-peak — no actions needed")

        # Clean grid preference: if grid is fossil-heavy, switch to self-consumption
        # to avoid importing dirty power (uses battery + solar instead)
        await _check_clean_grid_preference(status)
        return

    # In peak: store peak end time for dump timing calculations
    _state["_peak_end_minutes"] = tou.get("peak_end_minutes")
    _state["_tou_source"] = tou.get("source", "manual")

    # During peak hours
    if _state["phase"] == "idle":
        _think("Peak just started — entering hold phase")
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

    # Save current settings from Tesla (not cached values) — persist for restart recovery
    try:
        config = await get_site_config()
        _state["pre_optimize_mode"] = config.get("operation_mode", "autonomous")
        _state["pre_optimize_reserve"] = config.get("backup_reserve_percent", 20)
        _state["pre_optimize_export"] = config.get("export_rule", "battery_ok")
        _state["pre_optimize_grid_charging"] = not config.get("grid_charging_disabled", False)
    except Exception:
        _state["pre_optimize_mode"] = status.operation_mode
        _state["pre_optimize_reserve"] = status.backup_reserve
        _state["pre_optimize_export"] = "battery_ok"
        _state["pre_optimize_grid_charging"] = True

    # Safety: if the captured reserve looks like a leftover from a previous optimize
    # cycle (e.g. 5% min_reserve that wasn't properly restored), use 20% instead.
    # Normal user reserves are typically 15-30%; the optimizer's min_reserve (5%) should
    # never be treated as the "normal" setting to restore to.
    min_reserve = _state["min_reserve_pct"]
    if _state["pre_optimize_reserve"] <= min_reserve:
        logger.warning(
            "GridMind Optimize: Captured reserve %s%% looks like a stuck optimizer value (min_reserve=%d%%), using 20%% instead",
            _state["pre_optimize_reserve"], min_reserve,
        )
        _state["pre_optimize_reserve"] = 20

    # Persist pre-optimize settings so they survive container restarts
    setup_store.update({
        "gridmind_optimize_pre_mode": _state["pre_optimize_mode"],
        "gridmind_optimize_pre_reserve": _state["pre_optimize_reserve"],
        "gridmind_optimize_pre_export": _state["pre_optimize_export"],
        "gridmind_optimize_pre_grid_charging": _state.get("pre_optimize_grid_charging", True),
    })

    _set_phase("peak_hold")

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
    buffer_min = _state["buffer_minutes"]
    min_reserve = _state["min_reserve_pct"]

    # Peak end time from TOU schedule (set by evaluate())
    peak_end_minutes = _state.get("_peak_end_minutes")
    if peak_end_minutes is None:
        # Fallback to manual peak end hour
        peak_end_minutes = _state["peak_end_hour"] * 60

    # Available energy to dump
    available_pct = max(status.battery_soc - min_reserve, 0)
    available_kwh = (available_pct / 100) * cap["capacity_kwh"]

    if available_kwh <= 0.5:
        _think(f"Only {available_kwh:.1f} kWh available — not enough to dump")
        _state["last_calculation"] = {
            "time": now.isoformat(),
            "decision": "skip",
            "reason": "Not enough energy to dump",
            "available_kwh": round(available_kwh, 2),
        }
        return

    # Use rolling 2-hour average for home load (more stable than instantaneous)
    estimated_home_kw = await _get_rolling_home_load_kw(fallback_watts=max(status.home_power, 0))

    # Battery drain rate = total battery output (home + grid combined).
    # The battery serves both home and grid simultaneously, so it drains at
    # the TOTAL discharge rate, not just the grid export portion.
    # Use max battery power as the drain rate (what the battery can output).
    drain_rate_kw = cap["max_power_kw"]

    # Net export rate (what goes to grid after home) — for display only
    net_export_kw = max(drain_rate_kw - estimated_home_kw, 1.0)

    # Time needed = total energy / total drain rate
    hours_needed = available_kwh / drain_rate_kw
    minutes_needed = hours_needed * 60

    # Time remaining until peak ends (using TOU-derived end time)
    peak_end_hour = peak_end_minutes // 60
    peak_end_min = peak_end_minutes % 60
    peak_end_time = now.replace(hour=peak_end_hour, minute=peak_end_min, second=0)
    # Handle case where peak end is before current time (shouldn't happen, but safety)
    if peak_end_time <= now:
        peak_end_time += timedelta(days=1)
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

    _think(f"Home drawing {estimated_home_kw:.1f} kW — net export rate {net_export_kw:.1f} kW")
    _think(f"Need {minutes_needed:.0f} min to dump {available_kwh:.1f} kWh — {minutes_remaining:.0f} min remain in peak")

    if minutes_needed >= trigger_at:
        # Time to dump!
        estimated_finish = now + timedelta(minutes=minutes_needed)
        _think(f"Trigger threshold reached — starting battery dump, est. finish {estimated_finish.strftime('%I:%M %p')}")
        logger.info(
            "GridMind Optimize: DUMPING -- %.1f kWh at %.1f kW net, estimated finish %s",
            available_kwh, net_export_kw, estimated_finish.strftime("%H:%M"),
        )
        await _start_dump(estimated_finish)
    else:
        _think(f"Trigger at {trigger_at:.0f} min remaining ({buffer_min}m buffer) — holding")
        logger.debug(
            "GridMind Optimize: Holding -- need %.0f min, have %.0f min (trigger at %.0f)",
            minutes_needed, minutes_remaining, trigger_at,
        )


async def _start_dump(estimated_finish: datetime):
    """Start the battery dump to grid.

    Each command is independent so one failure doesn't prevent the others.
    The reserve MUST be lowered to min_reserve_pct so the battery can
    discharge fully — otherwise it holds at the normal reserve (e.g. 20%).
    """
    from tesla.commands import set_grid_import_export, set_backup_reserve, set_operation_mode
    from services.notifications import send_notification

    _set_phase("dumping")
    _state["dump_started_at"] = _get_local_now().isoformat()
    _state["estimated_finish"] = estimated_finish.strftime("%H:%M")
    min_reserve = _state["min_reserve_pct"]

    # Each command in its own try/except so one failure doesn't block the rest
    try:
        await set_operation_mode("autonomous")
        logger.info("GridMind Optimize: Set mode to autonomous")
    except Exception as e:
        logger.error("GridMind Optimize: Failed to set autonomous mode: %s", e)

    try:
        await set_grid_import_export(customer_preferred_export_rule="battery_ok")
        logger.info("GridMind Optimize: Set export rule to battery_ok")
    except Exception as e:
        logger.error("GridMind Optimize: Failed to set export rule: %s", e)

    try:
        await set_backup_reserve(min_reserve)
        current = get_latest_status()
        logger.info("GridMind Optimize: Set reserve to %d%% for dump (current status shows %.0f%%)", min_reserve, current.backup_reserve if current else -1)
    except Exception as e:
        logger.error("GridMind Optimize: Failed to set reserve to %d%%: %s", min_reserve, e)

    try:
        await send_notification(
            "GridMind Optimize: Battery Dump Started",
            f"Exporting battery to grid for peak credits. Reserve set to {min_reserve}%. Estimated finish: {estimated_finish.strftime('%I:%M %p')}",
            "info",
        )
    except Exception:
        pass


async def _monitor_dump(status, now: datetime):
    """Monitor dump progress and update calculation display.

    Includes smart load protection: if home load is causing grid imports
    during the dump, temporarily pause exporting to serve the home from
    battery first. Resumes exporting when load drops.
    """
    min_reserve = _state["min_reserve_pct"]
    cap = _get_capacity_info()

    # --- Smart Load Protection ---
    # If we're importing from grid during a dump, the home load exceeds what
    # the battery + solar can cover. Pause export to prioritize home.
    grid_importing = status.grid_power > 100  # importing >100W from grid
    was_paused = _state.get("_dump_paused", False)

    if grid_importing and not was_paused and status.battery_soc > min_reserve + 5:
        _think(f"Home load causing grid import ({status.grid_power/1000:.1f} kW) — pausing export to serve home")
        logger.info("GridMind Optimize: Pausing dump — grid importing %.0f W during peak, switching to self-consumption",
                     status.grid_power)
        try:
            from tesla.commands import set_operation_mode
            await set_operation_mode("self_consumption")
            _state["_dump_paused"] = True
        except Exception as e:
            logger.error("GridMind Optimize: Failed to pause dump: %s", e)

    elif was_paused and not grid_importing:
        _think("Home load dropped — resuming battery export to grid")
        logger.info("GridMind Optimize: Resuming dump — grid import stopped, switching back to autonomous")
        try:
            from tesla.commands import set_operation_mode
            await set_operation_mode("autonomous")
            _state["_dump_paused"] = False
        except Exception as e:
            logger.error("GridMind Optimize: Failed to resume dump: %s", e)

    elif was_paused and grid_importing:
        _think(f"Still serving home from battery — grid import {status.grid_power/1000:.1f} kW, waiting for load to drop")

    # Peak end time from TOU schedule (set by evaluate())
    peak_end_minutes = _state.get("_peak_end_minutes")
    if peak_end_minutes is None:
        peak_end_minutes = _state["peak_end_hour"] * 60

    # Update last_calculation with current values so dashboard shows live info
    available_pct = max(status.battery_soc - min_reserve, 0)
    available_kwh = (available_pct / 100) * cap["capacity_kwh"]
    home_kw = await _get_rolling_home_load_kw(fallback_watts=max(status.home_power, 0))
    drain_rate_kw = cap["max_power_kw"]
    net_export_kw = max(drain_rate_kw - home_kw, 0.1)
    minutes_needed = (available_kwh / drain_rate_kw) * 60 if drain_rate_kw > 0 else 0
    peak_end_hour = peak_end_minutes // 60
    peak_end_min = peak_end_minutes % 60
    peak_end_time = now.replace(hour=peak_end_hour, minute=peak_end_min, second=0)
    if peak_end_time <= now:
        peak_end_time += timedelta(days=1)
    minutes_remaining = max((peak_end_time - now).total_seconds() / 60, 0)

    # Update estimated finish
    if net_export_kw > 0 and available_kwh > 0:
        _state["estimated_finish"] = (now + timedelta(minutes=minutes_needed)).strftime("%H:%M")

    _state["last_calculation"] = {
        "time": now.isoformat(),
        "battery_soc": round(status.battery_soc, 1),
        "available_kwh": round(available_kwh, 1),
        "home_load_kw": round(home_kw, 1),
        "net_export_kw": round(net_export_kw, 1),
        "minutes_needed": round(minutes_needed, 0),
        "minutes_remaining": round(minutes_remaining, 0),
        "trigger_at_minutes": 0,
        "decision": "dump",
    }

    _think(f"Dumping to grid — {available_kwh:.1f} kWh left at {net_export_kw:.1f} kW, ~{minutes_needed:.0f} min remaining")

    # Safety check: verify the reserve is actually set to min_reserve.
    # If a previous set_backup_reserve call failed silently, the Powerwall
    # won't discharge below its current reserve (e.g. 20%), wasting the dump.
    actual_reserve = status.backup_reserve
    if actual_reserve > min_reserve + 2:
        _think(f"Reserve at {actual_reserve:.0f}% but should be {min_reserve}% — resending command")
        logger.warning(
            "GridMind Optimize: Reserve is %.0f%% but should be %d%% — resending command",
            actual_reserve, min_reserve,
        )
        from tesla.commands import set_backup_reserve
        try:
            await set_backup_reserve(min_reserve)
        except Exception as e:
            logger.error("GridMind Optimize: Failed to correct reserve: %s", e)

    if status.battery_soc <= min_reserve + 1:
        _think(f"Dump complete — battery at {status.battery_soc:.1f}%, stopping export")
        logger.info("GridMind Optimize: Dump complete, battery at %.1f%%", status.battery_soc)
        _state["_dump_paused"] = False
        from tesla.commands import set_grid_import_export
        try:
            await set_grid_import_export(customer_preferred_export_rule="pv_only")
        except Exception:
            pass
        _set_phase("complete")


async def _end_peak():
    """Peak hours ended -- restore normal operation."""
    from tesla.commands import set_operation_mode, set_backup_reserve, set_grid_import_export
    from services.notifications import send_notification

    logger.info("GridMind Optimize: Peak ended, restoring normal operation")

    # Read pre-optimize settings from memory, falling back to persisted values
    prev_mode = (_state.get("pre_optimize_mode")
                 or setup_store.get("gridmind_optimize_pre_mode")
                 or "autonomous")
    prev_reserve = (_state.get("pre_optimize_reserve")
                    or setup_store.get("gridmind_optimize_pre_reserve")
                    or 20)
    prev_export = (_state.get("pre_optimize_export")
                   or setup_store.get("gridmind_optimize_pre_export")
                   or "battery_ok")
    prev_grid_charging = _state.get("pre_optimize_grid_charging")
    if prev_grid_charging is None:
        prev_grid_charging = setup_store.get("gridmind_optimize_pre_grid_charging", True)

    # Grid charging: False means allow charging from grid (the setting is "disallow")
    grid_charging_disallowed = not prev_grid_charging

    try:
        await set_operation_mode(prev_mode)
        logger.info("GridMind Optimize: Restored mode to %s", prev_mode)
    except Exception as e:
        logger.error("GridMind Optimize: Failed to restore mode: %s", e)

    try:
        await set_backup_reserve(prev_reserve)
        logger.info("GridMind Optimize: Restored reserve to %s%% (was %d%% min_reserve)", prev_reserve, _state["min_reserve_pct"])
    except Exception as e:
        logger.error("GridMind Optimize: Failed to restore reserve to %s%%: %s", prev_reserve, e)

    try:
        await set_grid_import_export(
            disallow_charge_from_grid_with_solar_installed=grid_charging_disallowed,
            customer_preferred_export_rule=prev_export,
        )
        logger.info("GridMind Optimize: Restored export=%s, grid_charging_disallowed=%s", prev_export, grid_charging_disallowed)
    except Exception as e:
        logger.error("GridMind Optimize: Failed to restore grid settings: %s", e)

    try:
        await send_notification(
            "GridMind Optimize: Peak Ended",
            f"Restored to {prev_mode} mode with {prev_reserve}% reserve.",
            "info",
        )
    except Exception:
        pass

    _set_phase("idle")
    _state["dump_started_at"] = None
    _state["estimated_finish"] = None
    _state["_dump_paused"] = False

    # Clear pre-optimize state so stale values don't persist to the next cycle.
    # If the container restarts before tomorrow's peak, init() won't load stale values.
    _state["pre_optimize_mode"] = None
    _state["pre_optimize_reserve"] = None
    _state["pre_optimize_export"] = None
    _state["pre_optimize_grid_charging"] = None
    setup_store.update({
        "gridmind_optimize_pre_mode": None,
        "gridmind_optimize_pre_reserve": None,
        "gridmind_optimize_pre_export": None,
        "gridmind_optimize_pre_grid_charging": None,
    })
