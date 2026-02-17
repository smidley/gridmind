"""Battery capacity detection and management."""

import logging

logger = logging.getLogger(__name__)

# Powerwall 3 capacity per unit
PW3_CAPACITY_KWH = 13.5

# Default fallback (2 Powerwalls)
DEFAULT_BATTERY_COUNT = 2
DEFAULT_CAPACITY_KWH = DEFAULT_BATTERY_COUNT * PW3_CAPACITY_KWH


async def get_battery_capacity() -> dict:
    """Get battery capacity information from Tesla API.
    
    Returns:
        dict with keys:
            - battery_count: Number of Powerwall units
            - capacity_kwh: Total capacity in kWh
            - nameplate_power_kw: Maximum power output in kW
            - battery_description: Human-readable description
    """
    try:
        from tesla.commands import get_site_config
        config = await get_site_config()
        
        battery_count = config.get("battery_count", DEFAULT_BATTERY_COUNT)
        capacity_kwh = config.get("total_capacity_kwh", battery_count * PW3_CAPACITY_KWH)
        nameplate_power_kw = config.get("nameplate_power_kw", 11.5)
        battery_description = config.get("battery_description", f"{battery_count}x Powerwall 3")
        
        logger.info(
            "Detected battery configuration: %s (%d units, %.1f kWh total, %.1f kW max)",
            battery_description,
            battery_count,
            capacity_kwh,
            nameplate_power_kw
        )
        
        return {
            "battery_count": battery_count,
            "capacity_kwh": capacity_kwh,
            "nameplate_power_kw": nameplate_power_kw,
            "battery_description": battery_description,
        }
    
    except Exception as e:
        logger.warning("Failed to get battery capacity from API, using defaults: %s", e)
        return {
            "battery_count": DEFAULT_BATTERY_COUNT,
            "capacity_kwh": DEFAULT_CAPACITY_KWH,
            "nameplate_power_kw": 11.5,
            "battery_description": f"{DEFAULT_BATTERY_COUNT}x Powerwall 3",
        }


def get_battery_capacity_sync() -> dict:
    """Synchronous version that uses cached site config.
    
    Use this when you can't use async/await (e.g., in synchronous functions).
    Falls back to defaults if cache is not available.
    """
    try:
        from tesla.commands import _cached_site_config
        
        if _cached_site_config:
            battery_count = _cached_site_config.get("battery_count", DEFAULT_BATTERY_COUNT)
            capacity_kwh = battery_count * PW3_CAPACITY_KWH
            nameplate_power = _cached_site_config.get("nameplate_power", 11520)
            nameplate_power_kw = nameplate_power / 1000 if nameplate_power else 11.5
            
            return {
                "battery_count": battery_count,
                "capacity_kwh": capacity_kwh,
                "nameplate_power_kw": nameplate_power_kw,
                "battery_description": f"{battery_count}x Powerwall 3",
            }
    except Exception:
        pass
    
    return {
        "battery_count": DEFAULT_BATTERY_COUNT,
        "capacity_kwh": DEFAULT_CAPACITY_KWH,
        "nameplate_power_kw": 11.5,
        "battery_description": f"{DEFAULT_BATTERY_COUNT}x Powerwall 3",
    }

