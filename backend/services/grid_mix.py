"""Grid energy mix service — fetches real-time fuel source data from the EIA API.

Provides the current grid fuel mix (hydro, wind, solar, gas, coal, nuclear, etc.)
for the user's region. Data updates hourly from the EIA with ~1-2 hour delay.

Requires a free EIA API key: https://www.eia.gov/opendata/register.php

Data source: U.S. Energy Information Administration (EIA)
https://www.eia.gov/opendata/
Used in accordance with the EIA API Terms of Service.
EIA does not endorse this application.
"""

import logging
import time
from datetime import datetime, timedelta

import httpx

from services import setup_store

logger = logging.getLogger(__name__)

EIA_API_URL = "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/"

# Cache
_cached_mix: dict | None = None
_cache_time: float = 0
CACHE_TTL = 1800  # 30 minutes

# Fuel type categories
CLEAN_FUELS = {"SUN", "WND", "WAT", "NUC"}  # Solar, Wind, Hydro, Nuclear
FOSSIL_FUELS = {"NG", "COL", "OIL", "OTH"}   # Gas, Coal, Oil, Other

FUEL_DISPLAY = {
    "SUN": "Solar",
    "WND": "Wind",
    "WAT": "Hydro",
    "NUC": "Nuclear",
    "NG": "Natural Gas",
    "COL": "Coal",
    "OIL": "Oil",
    "OTH": "Other",
    "ALL": "Total",
}

# Approximate balancing authority by US state (covers most users)
STATE_TO_BA = {
    "OR": "BPA", "WA": "BPA", "ID": "BPA", "MT": "BPA",
    "CA": "CISO",
    "TX": "ERCO",
    "NY": "NYIS",
    "CT": "ISNE", "MA": "ISNE", "ME": "ISNE", "NH": "ISNE", "RI": "ISNE", "VT": "ISNE",
    "IL": "MISO", "IN": "MISO", "IA": "MISO", "MI": "MISO", "MN": "MISO",
    "MO": "MISO", "ND": "MISO", "SD": "MISO", "WI": "MISO",
    "NJ": "PJM", "PA": "PJM", "OH": "PJM", "VA": "PJM", "WV": "PJM",
    "MD": "PJM", "DE": "PJM", "DC": "PJM", "NC": "PJM", "KY": "PJM",
    "CO": "PSCO", "NM": "PNM", "AZ": "SRP", "NV": "NEVP",
    "FL": "FPL", "GA": "SOCO", "AL": "SOCO", "MS": "SOCO",
    "TN": "TVA", "SC": "DUK", "UT": "PACE",
}


def get_eia_api_key() -> str | None:
    """Get the EIA API key from setup store."""
    return setup_store.get("eia_api_key")


def get_balancing_authority() -> str | None:
    """Get the user's balancing authority, auto-detecting from location if needed."""
    # Check manual override first
    ba = setup_store.get("grid_balancing_authority")
    if ba:
        return ba

    # Auto-detect from address/state
    address = setup_store.get_address() or ""
    if address:
        # Extract state abbreviation from address (typically "City, ST" or "City, ST ZIP")
        parts = address.split(",")
        if len(parts) >= 2:
            state_part = parts[-1].strip().split()[0].upper() if parts[-1].strip() else ""
            if len(state_part) == 2 and state_part in STATE_TO_BA:
                return STATE_TO_BA[state_part]

    return None


def get_cached_mix() -> dict | None:
    """Get the cached grid mix data (if available and fresh)."""
    global _cached_mix, _cache_time
    if _cached_mix and (time.time() - _cache_time) < CACHE_TTL:
        return _cached_mix
    return None


async def fetch_grid_mix() -> dict | None:
    """Fetch current grid energy mix from EIA API.

    Returns dict with fuel percentages and clean/fossil breakdown,
    or None if EIA API key is not configured.
    """
    global _cached_mix, _cache_time

    api_key = get_eia_api_key()
    if not api_key:
        return None

    ba = get_balancing_authority()
    if not ba:
        logger.debug("Grid mix: no balancing authority configured or detected")
        return None

    # Request last 24 hours of data to find the most recent available
    now = datetime.utcnow()
    start = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(EIA_API_URL, params={
                "api_key": api_key,
                "frequency": "hourly",
                "data[]": "value",
                "facets[respondent][]": ba,
                "start": start,
                "sort[0][column]": "period",
                "sort[0][direction]": "desc",
                "length": 50,
            })

        if response.status_code != 200:
            logger.warning("EIA API error: %d %s", response.status_code, response.text[:200])
            return _cached_mix  # Return stale cache on error

        data = response.json()
        records = data.get("response", {}).get("data", [])

        if not records:
            logger.debug("Grid mix: no data returned for %s", ba)
            return _cached_mix

        # Group by the most recent period
        latest_period = records[0].get("period", "")
        latest_records = [r for r in records if r.get("period") == latest_period]

        # Build fuel mix
        fuel_mwh = {}
        total_mwh = 0
        for r in latest_records:
            fuel = r.get("fueltype", "OTH")
            value = r.get("value")
            if fuel == "ALL" or value is None:
                continue
            mwh = float(value)
            if mwh > 0:
                fuel_mwh[fuel] = fuel_mwh.get(fuel, 0) + mwh
                total_mwh += mwh

        if total_mwh <= 0:
            return _cached_mix

        # Calculate percentages
        sources = {}
        clean_pct = 0.0
        fossil_pct = 0.0
        for fuel, mwh in sorted(fuel_mwh.items(), key=lambda x: -x[1]):
            pct = round((mwh / total_mwh) * 100, 1)
            sources[fuel] = {
                "name": FUEL_DISPLAY.get(fuel, fuel),
                "mwh": round(mwh, 1),
                "pct": pct,
            }
            if fuel in CLEAN_FUELS:
                clean_pct += pct
            elif fuel in FOSSIL_FUELS:
                fossil_pct += pct

        result = {
            "balancing_authority": ba,
            "period": latest_period,
            "sources": sources,
            "clean_pct": round(clean_pct, 1),
            "fossil_pct": round(fossil_pct, 1),
            "total_mwh": round(total_mwh, 1),
            "fetched_at": now.isoformat(),
            "attribution": "Source: U.S. Energy Information Administration (EIA)",
            "attribution_url": "https://www.eia.gov/opendata/",
        }

        _cached_mix = result
        _cache_time = time.time()

        logger.info("Grid mix updated for %s: %.1f%% clean, %.1f%% fossil (period: %s)",
                     ba, clean_pct, fossil_pct, latest_period)

        return result

    except Exception as e:
        logger.error("Failed to fetch grid mix: %s", e)
        return _cached_mix  # Return stale cache on error
