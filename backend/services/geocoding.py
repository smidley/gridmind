"""Geocoding service using OpenStreetMap Nominatim (free, no API key)."""

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


async def geocode_address(address: str) -> Optional[dict]:
    """Convert an address string to latitude/longitude coordinates.

    Uses OpenStreetMap's Nominatim service (free, no API key required).
    Please respect their usage policy: max 1 request/second.

    Returns:
        Dict with lat, lon, display_name, and timezone or None if not found.
    """
    if not address.strip():
        return None

    params = {
        "q": address,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    }

    headers = {
        "User-Agent": "GridMind/0.1.0 (personal Tesla Powerwall automation)",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                NOMINATIM_URL,
                params=params,
                headers=headers,
                timeout=10.0,
            )
            response.raise_for_status()
            results = response.json()

        if not results:
            logger.warning("No geocoding results for: %s", address)
            return None

        result = results[0]
        lat = float(result["lat"])
        lon = float(result["lon"])
        display_name = result.get("display_name", address)

        # Try to determine timezone from coordinates
        timezone = await _get_timezone(lat, lon)

        logger.info("Geocoded '%s' -> %.4f, %.4f (%s)", address, lat, lon, display_name)

        return {
            "latitude": lat,
            "longitude": lon,
            "display_name": display_name,
            "timezone": timezone,
        }

    except Exception as e:
        logger.error("Geocoding failed for '%s': %s", address, e)
        return None


async def _get_timezone(lat: float, lon: float) -> str:
    """Estimate timezone from coordinates using a timezone API."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://timeapi.io/api/timezone/coordinate",
                params={"latitude": lat, "longitude": lon},
                timeout=5.0,
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("timeZone", "America/New_York")
    except Exception:
        pass

    # Fallback: rough estimate from longitude
    offset_hours = round(lon / 15)
    common_timezones = {
        -5: "America/New_York",
        -6: "America/Chicago",
        -7: "America/Denver",
        -8: "America/Los_Angeles",
        -9: "America/Anchorage",
        -10: "Pacific/Honolulu",
    }
    return common_timezones.get(offset_hours, "America/New_York")
