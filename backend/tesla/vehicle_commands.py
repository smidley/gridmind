"""Tesla Vehicle command and data retrieval functions."""

import logging
import time
from datetime import datetime
from typing import Optional

from tesla.client import tesla_client, TeslaAPIError
from tesla.models import VehicleSummary, ChargeState, VehicleConfig, VehicleStatus

logger = logging.getLogger(__name__)


# Cache vehicle list to avoid frequent API calls
_cached_vehicles: list[dict] = []
_vehicles_cache_time: float = 0
VEHICLES_CACHE_TTL = 300  # 5 minutes


async def list_vehicles() -> list[VehicleSummary]:
    """List all vehicles on the Tesla account.

    Uses /api/1/products (energy scope) first, falls back to /api/1/vehicles.
    This works even without dedicated vehicle scopes since the products endpoint
    returns both energy sites and vehicles under the energy_device_data scope.
    """
    global _cached_vehicles, _vehicles_cache_time

    now = time.time()
    if _cached_vehicles and (now - _vehicles_cache_time) < VEHICLES_CACHE_TTL:
        return [VehicleSummary(**v) for v in _cached_vehicles]

    vehicles = []
    raw_cache = []

    # Try /api/1/products first — works with energy scopes and includes vehicles
    try:
        data = await tesla_client.get("/api/1/products")
        for product in data.get("response", []):
            # Vehicles have 'vin' key, energy sites have 'energy_site_id'
            if "vin" in product:
                summary = {
                    "id": str(product.get("id", "")),
                    "vehicle_id": str(product.get("vehicle_id", "")),
                    "display_name": product.get("display_name", "Tesla"),
                    "state": product.get("state", "unknown"),
                    "vin": product.get("vin", ""),
                }
                raw_cache.append(summary)
                vehicles.append(VehicleSummary(**summary))
    except TeslaAPIError:
        pass

    # Fallback to /api/1/vehicles if products didn't return any vehicles
    if not vehicles:
        try:
            data = await tesla_client.get("/api/1/vehicles")
            for v in data.get("response", []):
                summary = {
                    "id": str(v.get("id", "")),
                    "vehicle_id": str(v.get("vehicle_id", "")),
                    "display_name": v.get("display_name", "Tesla"),
                    "state": v.get("state", "unknown"),
                    "vin": v.get("vin", ""),
                }
                raw_cache.append(summary)
                vehicles.append(VehicleSummary(**summary))
        except TeslaAPIError as e:
            logger.warning("Could not list vehicles: %s", e)

    _cached_vehicles = raw_cache
    _vehicles_cache_time = now

    logger.info("Found %d vehicle(s)", len(vehicles))
    return vehicles


async def get_vehicle_data(vehicle_id: str) -> VehicleStatus:
    """Get comprehensive vehicle data including charge state.

    Tries /api/1/vehicles/{id}/vehicle_data first (requires vehicle_device_data scope).
    Falls back to basic info from /api/1/products if vehicle scopes are missing.

    Args:
        vehicle_id: The Tesla vehicle ID
    """
    # Try the full vehicle_data endpoint first
    try:
        data = await tesla_client.get(f"/api/1/vehicles/{vehicle_id}/vehicle_data")
        response = data.get("response", {})
    except TeslaAPIError as e:
        if e.status_code == 403:
            # Vehicle scopes not available — return basic info from products
            logger.warning("Vehicle scopes not available (403). Add vehicle_device_data scope to your Tesla Developer App.")
            return await _get_basic_vehicle_info(vehicle_id)
        raise

    return _parse_vehicle_response(response, vehicle_id)


async def _get_basic_vehicle_info(vehicle_id: str) -> VehicleStatus:
    """Fallback: get basic vehicle info from /api/1/products when vehicle scopes are missing."""
    data = await tesla_client.get("/api/1/products")
    for product in data.get("response", []):
        if str(product.get("id")) == str(vehicle_id) and "vin" in product:
            return VehicleStatus(
                timestamp=datetime.utcnow(),
                vehicle=VehicleSummary(
                    id=str(product.get("id", vehicle_id)),
                    vehicle_id=str(product.get("vehicle_id", "")),
                    display_name=product.get("display_name", "Tesla"),
                    state=product.get("state", "unknown"),
                    vin=product.get("vin", ""),
                ),
                charge_state=None,
                software_version="",
                missing_scopes=True,
            )
    raise TeslaAPIError("Vehicle not found in products", status_code=404)


def _parse_vehicle_response(response: dict, vehicle_id: str) -> VehicleStatus:
    """Parse a full vehicle_data response into VehicleStatus."""
    charge = response.get("charge_state", {})
    vehicle_state = response.get("vehicle_state", {})
    drive_state = response.get("drive_state", {})
    config = response.get("vehicle_config", {})

    charge_state = ChargeState(
        battery_level=charge.get("battery_level", 0),
        battery_range=charge.get("battery_range", 0),
        charging_state=charge.get("charging_state", "Disconnected"),
        charge_limit_soc=charge.get("charge_limit_soc", 80),
        charge_rate=charge.get("charge_rate", 0),
        charger_power=charge.get("charger_power", 0),
        charger_voltage=charge.get("charger_voltage", 0),
        charger_actual_current=charge.get("charger_actual_current", 0),
        time_to_full_charge=charge.get("time_to_full_charge", 0),
        charge_energy_added=charge.get("charge_energy_added", 0),
        charge_miles_added_rated=charge.get("charge_miles_added_rated", 0),
        scheduled_charging_mode=charge.get("scheduled_charging_mode", "Off"),
        scheduled_charging_start_time=charge.get("scheduled_charging_start_time"),
        conn_charge_cable=charge.get("conn_charge_cable", ""),
        fast_charger_present=charge.get("fast_charger_present", False),
        charge_current_request=charge.get("charge_current_request", 0),
        charge_current_request_max=charge.get("charge_current_request_max", 0),
        charger_phases=charge.get("charger_phases"),
        off_peak_charging_enabled=charge.get("off_peak_charging_enabled", False),
        off_peak_charging_times=charge.get("off_peak_charging_times", ""),
        off_peak_hours_end_time=charge.get("off_peak_hours_end_time", 0),
        preconditioning_enabled=charge.get("preconditioning_enabled", False),
        managed_charging_active=charge.get("managed_charging_active", False),
        charge_enable_request=charge.get("charge_enable_request", True),
    )

    summary = VehicleSummary(
        id=str(response.get("id", vehicle_id)),
        vehicle_id=str(response.get("vehicle_id", "")),
        display_name=response.get("display_name", "Tesla"),
        state=response.get("state", "online"),
        vin=response.get("vin", ""),
    )

    vehicle_config = None
    if config:
        vehicle_config = VehicleConfig(
            car_type=config.get("car_type", ""),
            trim_badging=config.get("trim_badging", ""),
            exterior_color=config.get("exterior_color", ""),
            wheel_type=config.get("wheel_type", ""),
            plaid=config.get("plaid", False),
            has_air_suspension=config.get("has_air_suspension", False),
            has_seat_cooling=config.get("has_seat_cooling", False),
            driver_assist=config.get("driver_assist", ""),
        )

    return VehicleStatus(
        timestamp=datetime.utcnow(),
        vehicle=summary,
        charge_state=charge_state,
        vehicle_config=vehicle_config,
        odometer=vehicle_state.get("odometer"),
        software_version=vehicle_state.get("car_version", ""),
        latitude=drive_state.get("latitude"),
        longitude=drive_state.get("longitude"),
    )


async def wake_up(vehicle_id: str) -> dict:
    """Wake up a sleeping vehicle.

    Args:
        vehicle_id: The Tesla vehicle ID
    """
    logger.info("Waking up vehicle %s", vehicle_id)
    data = await tesla_client.post(f"/api/1/vehicles/{vehicle_id}/wake_up")
    return data.get("response", {})


async def charge_start(vehicle_id: str) -> dict:
    """Start charging the vehicle.

    Args:
        vehicle_id: The Tesla vehicle ID
    """
    logger.info("Starting charge on vehicle %s", vehicle_id)
    data = await tesla_client.post(f"/api/1/vehicles/{vehicle_id}/command/charge_start")
    return data.get("response", {})


async def charge_stop(vehicle_id: str) -> dict:
    """Stop charging the vehicle.

    Args:
        vehicle_id: The Tesla vehicle ID
    """
    logger.info("Stopping charge on vehicle %s", vehicle_id)
    data = await tesla_client.post(f"/api/1/vehicles/{vehicle_id}/command/charge_stop")
    return data.get("response", {})


async def set_charge_limit(vehicle_id: str, percent: int) -> dict:
    """Set the charge limit percentage.

    Args:
        vehicle_id: The Tesla vehicle ID
        percent: Charge limit 50-100
    """
    percent = max(50, min(100, percent))
    logger.info("Setting charge limit to %d%% on vehicle %s", percent, vehicle_id)
    data = await tesla_client.post(
        f"/api/1/vehicles/{vehicle_id}/command/set_charge_limit",
        json={"percent": percent},
    )
    return data.get("response", {})


async def set_charging_amps(vehicle_id: str, amps: int) -> dict:
    """Set the charging amperage.

    Args:
        vehicle_id: The Tesla vehicle ID
        amps: Charging current in amps (typically 1-48)
    """
    amps = max(1, min(48, amps))
    logger.info("Setting charging amps to %d on vehicle %s", amps, vehicle_id)
    data = await tesla_client.post(
        f"/api/1/vehicles/{vehicle_id}/command/set_charging_amps",
        json={"charging_amps": amps},
    )
    return data.get("response", {})


async def set_scheduled_charging(vehicle_id: str, enable: bool, time_minutes: Optional[int] = None) -> dict:
    """Set or disable scheduled charging.

    Args:
        vehicle_id: The Tesla vehicle ID
        enable: Whether to enable scheduled charging
        time_minutes: Minutes after midnight for charge start (0-1439)
    """
    payload = {"enable": enable}
    if time_minutes is not None:
        payload["time"] = max(0, min(1439, time_minutes))

    logger.info(
        "Setting scheduled charging: enable=%s time=%s on vehicle %s",
        enable, time_minutes, vehicle_id,
    )
    data = await tesla_client.post(
        f"/api/1/vehicles/{vehicle_id}/command/set_scheduled_charging",
        json=payload,
    )
    return data.get("response", {})
