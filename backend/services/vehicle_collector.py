"""Vehicle data collector - polls Tesla vehicle charge state and stores in database."""

import logging
import time
from datetime import datetime

from database import async_session, VehicleChargeReading
from tesla.client import tesla_client, TeslaAuthError, TeslaAPIError
from tesla.vehicle_commands import get_vehicle_data, list_vehicles, wake_up
from tesla.models import VehicleStatus
from services import setup_store
from services.collector import get_latest_status as get_energy_status

logger = logging.getLogger(__name__)

# In-memory cache for latest vehicle status (used by WebSocket + dashboard)
_latest_vehicle_status: VehicleStatus | None = None
_vehicle_listeners: list = []  # Callbacks for real-time updates
_last_poll_time: float = 0
_consecutive_errors: int = 0

# Adaptive polling intervals (seconds)
POLL_CHARGING = 120       # 2 min when actively charging
POLL_PLUGGED_IN = 600     # 10 min when plugged in but not charging
POLL_DISCONNECTED = 1800  # 30 min when not plugged in
POLL_ASLEEP = 3600        # 60 min when vehicle is asleep (avoid waking)
POLL_ERROR_BACKOFF = 300  # 5 min backoff on errors


def get_latest_vehicle_status() -> VehicleStatus | None:
    """Get the most recent cached vehicle status."""
    return _latest_vehicle_status


def register_vehicle_listener(callback):
    """Register a callback for real-time vehicle status updates."""
    _vehicle_listeners.append(callback)


def unregister_vehicle_listener(callback):
    """Remove a vehicle status update callback."""
    if callback in _vehicle_listeners:
        _vehicle_listeners.remove(callback)


def _get_selected_vehicle_id() -> str | None:
    """Get the user-selected vehicle ID from setup store."""
    return setup_store.get("selected_vehicle_id")


def _get_poll_interval() -> int:
    """Determine the appropriate polling interval based on current state."""
    global _consecutive_errors

    if _consecutive_errors >= 3:
        return POLL_ERROR_BACKOFF

    status = _latest_vehicle_status
    if status is None:
        return POLL_DISCONNECTED

    # Check vehicle state
    if status.vehicle.state == "asleep":
        # Don't wake the vehicle just to check charge state
        return POLL_ASLEEP

    if status.charge_state is None:
        # No charge data available (missing scopes) — poll slowly
        return POLL_DISCONNECTED

    cs = status.charge_state.charging_state
    if cs == "Charging":
        return POLL_CHARGING
    elif cs in ("Stopped", "Complete"):
        # Plugged in but not actively charging
        return POLL_PLUGGED_IN
    else:
        # Disconnected or unknown
        return POLL_DISCONNECTED


def should_poll_now() -> bool:
    """Check if enough time has elapsed for the next poll."""
    global _last_poll_time
    interval = _get_poll_interval()
    return (time.time() - _last_poll_time) >= interval


async def collect_vehicle_data():
    """Poll the vehicle and store a charge reading. Called by the scheduler."""
    global _latest_vehicle_status, _last_poll_time, _consecutive_errors

    if not tesla_client.is_authenticated:
        logger.debug("Skipping vehicle collection - not authenticated")
        return

    vehicle_id = _get_selected_vehicle_id()
    if not vehicle_id:
        logger.debug("Skipping vehicle collection - no vehicle selected")
        return

    # Check adaptive polling interval
    if not should_poll_now():
        return

    try:
        status = await get_vehicle_data(vehicle_id)
        _latest_vehicle_status = status
        _last_poll_time = time.time()
        _consecutive_errors = 0

        # Store in database (only if we have charge data)
        if status.charge_state is not None:
            # Calculate solar fraction when charging
            solar_frac = None
            if status.charge_state.charging_state == "Charging" and status.charge_state.charger_power > 0:
                energy = get_energy_status()
                if energy:
                    solar_w = max(energy.solar_power, 0)
                    battery_discharge_w = max(energy.battery_power, 0)  # positive = discharging
                    grid_import_w = max(energy.grid_power, 0)  # positive = importing
                    total_supply = solar_w + battery_discharge_w + grid_import_w
                    if total_supply > 0:
                        solar_frac = round(solar_w / total_supply, 4)

            async with async_session() as session:
                reading = VehicleChargeReading(
                    timestamp=status.timestamp,
                    vehicle_id=vehicle_id,
                    battery_level=status.charge_state.battery_level,
                    battery_range=status.charge_state.battery_range,
                    charging_state=status.charge_state.charging_state,
                    charge_rate=status.charge_state.charge_rate,
                    charger_power=status.charge_state.charger_power,
                    charge_energy_added=status.charge_state.charge_energy_added,
                    charge_limit_soc=status.charge_state.charge_limit_soc,
                    solar_fraction=solar_frac,
                )
                session.add(reading)
                await session.commit()

        # Notify WebSocket listeners
        for listener in _vehicle_listeners:
            try:
                await listener(status)
            except Exception as e:
                logger.warning("Vehicle status listener error: %s", e)

        if status.charge_state is not None:
            logger.debug(
                "Vehicle: SOC=%d%% State=%s Range=%.0f mi Power=%.1f kW",
                status.charge_state.battery_level,
                status.charge_state.charging_state,
                status.charge_state.battery_range,
                status.charge_state.charger_power,
            )
        elif status.missing_scopes:
            logger.debug("Vehicle: %s (online, charge data unavailable - missing scopes)", status.vehicle.display_name)
        else:
            logger.debug("Vehicle: %s state=%s", status.vehicle.display_name, status.vehicle.state)

    except TeslaAPIError as e:
        _consecutive_errors += 1
        if e.status_code == 408:
            # Vehicle is asleep - update state but don't treat as hard error
            if _latest_vehicle_status:
                _latest_vehicle_status.vehicle.state = "asleep"
            _last_poll_time = time.time()
            logger.debug("Vehicle is asleep (408), will check again later")
        else:
            logger.error("API error during vehicle collection: %s", e)
    except TeslaAuthError as e:
        _consecutive_errors += 1
        logger.error("Auth error during vehicle collection: %s", e)
    except Exception as e:
        _consecutive_errors += 1
        logger.exception("Unexpected error during vehicle collection: %s", e)
