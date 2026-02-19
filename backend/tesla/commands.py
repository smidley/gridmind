"""Tesla Powerwall command and data retrieval functions."""

import logging
from datetime import datetime

from tesla.client import tesla_client, TeslaAPIError
from tesla.models import PowerwallStatus

logger = logging.getLogger(__name__)


# Cache site config to avoid hitting site_info on every poll
_cached_site_config: dict = {}
_config_cache_time: float = 0
CONFIG_CACHE_TTL = 300  # Refresh site config every 5 minutes


async def get_live_status() -> PowerwallStatus:
    """Get current live status from the Powerwall."""
    global _cached_site_config, _config_cache_time
    import time

    data = await tesla_client.get(tesla_client._site_url("/live_status"))
    response = data.get("response", {})

    # Get operation mode from site_info (live_status doesn't return it accurately)
    now = time.time()
    if not _cached_site_config or (now - _config_cache_time) > CONFIG_CACHE_TTL:
        try:
            site_data = await tesla_client.get(tesla_client._site_url("/site_info"))
            _cached_site_config = site_data.get("response", {})
            _config_cache_time = now
        except Exception:
            pass  # Use cached or fallback

    operation_mode = _cached_site_config.get("default_real_mode", response.get("default_real_mode", "self_consumption"))
    backup_reserve = _cached_site_config.get("backup_reserve_percent", response.get("backup_reserve_percent", 0))
    storm_mode = _cached_site_config.get("storm_mode_enabled", response.get("storm_mode_active", False))

    # Extract Wall Connector data from live_status (available even when vehicle is asleep)
    wc_power = 0.0
    wc_state = 0
    for wc in response.get("wall_connectors", []):
        wc_power += wc.get("wall_connector_power", 0) or 0
        # Use highest state code across all WCs (higher = more active)
        wc_state = max(wc_state, wc.get("wall_connector_state", 0) or 0)

    return PowerwallStatus(
        timestamp=datetime.utcnow(),
        battery_soc=response.get("percentage_charged", 0),
        battery_power=response.get("battery_power", 0),
        solar_power=response.get("solar_power", 0),
        grid_power=response.get("grid_power", 0),
        home_power=response.get("load_power", 0),
        grid_status="connected" if response.get("grid_status", "") in ("Active", "Unknown", "") else "islanded",
        operation_mode=operation_mode,
        backup_reserve=backup_reserve,
        storm_mode=storm_mode,
        wall_connector_power=wc_power,
        wall_connector_state=wc_state,
    )


async def get_site_info() -> dict:
    """Get full site info and configuration."""
    data = await tesla_client.get(tesla_client._site_url("/site_info"))
    return data.get("response", {})


async def get_site_config() -> dict:
    """Get site operational configuration."""
    info = await get_site_info()
    components = info.get("components", {})

    # Determine battery type and capacity from gateway/battery info
    gateways = components.get("gateways", [])
    batteries = components.get("batteries", [])
    battery_count = info.get("battery_count", 0)

    # Identify the gateway (main unit) name
    gateway_name = ""
    for gw in gateways:
        if gw.get("part_name"):
            gateway_name = gw["part_name"]
            break

    # Build battery description
    # Powerwall 3 = 13.5 kWh per unit
    PW3_CAPACITY_KWH = 13.5
    total_capacity_kwh = battery_count * PW3_CAPACITY_KWH

    # Count expansions (batteries that aren't the gateway)
    gateway_serial = gateways[0]["serial_number"] if gateways else ""
    expansions = [b for b in batteries if b.get("serial_number") != gateway_serial]

    if expansions:
        battery_description = f"{gateway_name} + {len(expansions)} Expansion"
        if len(expansions) > 1:
            battery_description += "s"
    else:
        battery_description = gateway_name or "Powerwall"

    # Nameplate power (watts)
    nameplate_power = info.get("nameplate_power", 0)

    return {
        "operation_mode": info.get("default_real_mode", "self_consumption"),
        "backup_reserve_percent": info.get("backup_reserve_percent", 0),
        "storm_mode_enabled": components.get("storm_mode_capable", False) and info.get("user_settings", {}).get("storm_mode_enabled", False),
        "site_name": info.get("site_name", ""),
        "battery_count": battery_count,
        "battery_description": battery_description,
        "total_capacity_kwh": total_capacity_kwh,
        "nameplate_power_kw": round(nameplate_power / 1000, 1) if nameplate_power else 0,
        "firmware_version": gateways[0].get("firmware_version", "") if gateways else "",
        "export_rule": components.get("customer_preferred_export_rule", "pv_only"),
        "grid_charging_disabled": components.get("disallow_charge_from_grid_with_solar_installed", False),
    }


def invalidate_site_config_cache():
    """Force the next get_live_status() to refresh site config from Tesla API.

    Call this after any command that changes Powerwall settings (mode, reserve,
    grid import/export) so the dashboard shows the updated values immediately.
    """
    global _config_cache_time
    _config_cache_time = 0


async def set_operation_mode(mode: str) -> dict:
    """Set the Powerwall operation mode.

    Args:
        mode: "self_consumption" or "autonomous"
    """
    if mode not in ("self_consumption", "autonomous"):
        raise ValueError(f"Invalid mode: {mode}. Must be 'self_consumption' or 'autonomous'.")

    logger.info("Setting operation mode to: %s", mode)
    data = await tesla_client.post(
        tesla_client._site_url("/operation"),
        json={"default_real_mode": mode},
    )
    invalidate_site_config_cache()
    return data.get("response", {})


async def set_backup_reserve(reserve_percent: float) -> dict:
    """Set the backup reserve percentage.

    Args:
        reserve_percent: 0-100, the minimum battery level to maintain
    """
    reserve_percent = max(0, min(100, reserve_percent))
    logger.info("Setting backup reserve to: %.1f%%", reserve_percent)
    data = await tesla_client.post(
        tesla_client._site_url("/backup"),
        json={"backup_reserve_percent": reserve_percent},
    )
    invalidate_site_config_cache()
    return data.get("response", {})


async def set_storm_mode(enabled: bool) -> dict:
    """Enable or disable storm mode."""
    logger.info("Setting storm mode to: %s", enabled)
    data = await tesla_client.post(
        tesla_client._site_url("/storm_mode"),
        json={"enabled": enabled},
    )
    return data.get("response", {})


async def set_grid_import_export(
    disallow_charge_from_grid_with_solar_installed: bool = None,
    customer_preferred_export_rule: str = None,
) -> dict:
    """Configure grid import/export settings.

    Args:
        disallow_charge_from_grid_with_solar_installed: If True, battery won't charge from grid
        customer_preferred_export_rule: "pv_only", "battery_ok", or "never"
    """
    payload = {}
    if disallow_charge_from_grid_with_solar_installed is not None:
        payload["disallow_charge_from_grid_with_solar_installed"] = (
            disallow_charge_from_grid_with_solar_installed
        )
    if customer_preferred_export_rule is not None:
        if customer_preferred_export_rule not in ("pv_only", "battery_ok", "never"):
            raise ValueError(
                f"Invalid export rule: {customer_preferred_export_rule}. "
                "Must be 'pv_only', 'battery_ok', or 'never'."
            )
        payload["customer_preferred_export_rule"] = customer_preferred_export_rule

    logger.info("Setting grid import/export: %s", payload)
    data = await tesla_client.post(
        tesla_client._site_url("/grid_import_export"),
        json=payload,
    )
    invalidate_site_config_cache()
    return data.get("response", {})


async def get_energy_history(period: str = "day", kind: str = "power") -> dict:
    """Get energy history data.

    Args:
        period: "day", "week", "month", "year"
        kind: "power" or "energy"
    """
    params = {"period": period, "kind": kind}
    data = await tesla_client.get(
        tesla_client._site_url("/calendar_history"),
        params=params,
    )
    return data.get("response", {})
