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
CLEAN_FUELS = {"SUN", "WND", "WAT", "NUC", "BAT"}  # Solar, Wind, Hydro, Nuclear, Battery Storage
FOSSIL_FUELS = {"NG", "COL", "OIL", "OTH"}          # Gas, Coal, Oil, Other

FUEL_DISPLAY = {
    "SUN": "Solar",
    "WND": "Wind",
    "WAT": "Hydro",
    "NUC": "Nuclear",
    "BAT": "Battery",
    "NG": "Natural Gas",
    "COL": "Coal",
    "OIL": "Oil",
    "OTH": "Other",
    "ALL": "Total",
}

# EIA balancing authority codes by US state
# Full list: https://api.eia.gov/v2/electricity/rto/fuel-type-data/facet/respondent
STATE_TO_BA = {
    "OR": "BPAT", "WA": "BPAT", "ID": "BPAT", "MT": "BPAT",
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


# Map Tesla utility names to EIA respondent codes
UTILITY_TO_BA = {
    "PGE": "PGE", "PORTLAND GENERAL": "PGE",
    "PACIFICORP": "PACW", "PACIFIC POWER": "PACW",
    "PUGET SOUND": "PSEI", "PSE": "PSEI",
    "SEATTLE CITY LIGHT": "SCL",
    "AVISTA": "AVA",
    "IDAHO POWER": "IPCO",
    "SOUTHERN CALIFORNIA EDISON": "CISO", "SCE": "CISO",
    "PG&E": "CISO", "PACIFIC GAS": "CISO",
    "SDG&E": "CISO", "SAN DIEGO": "CISO",
    "ONCOR": "ERCO", "CENTERPOINT": "ERCO", "AEP TEXAS": "ERCO",
    "CON EDISON": "NYIS", "CONED": "NYIS",
    "NATIONAL GRID": "NYIS",
    "EVERSOURCE": "ISNE", "UNITIL": "ISNE",
    "FLORIDA POWER": "FPL", "FPL": "FPL",
    "DUKE ENERGY": "DUK",
    "DOMINION": "PJM",
    "APS": "SRP", "ARIZONA PUBLIC": "AZPS",
    "XCEL": "PSCO",
    "ENTERGY": "MISO",
    "TVA": "TVA", "TENNESSEE VALLEY": "TVA",
}


def get_balancing_authority() -> str | None:
    """Get the user's balancing authority, auto-detecting from utility or location."""
    # Check manual override first
    ba = setup_store.get("grid_balancing_authority")
    if ba:
        return ba

    # Try to match from Tesla utility name (most accurate)
    try:
        from tesla.commands import _cached_site_config
        tariff = _cached_site_config.get("tariff_content", {})
        utility = tariff.get("utility", "").upper()
        if utility:
            for key, eia_code in UTILITY_TO_BA.items():
                if key in utility:
                    return eia_code
    except Exception:
        pass

    # Auto-detect from address string
    address = setup_store.get_address() or ""
    if address:
        # Try to extract 2-letter state code from address parts
        for part in address.replace(",", " ").split():
            code = part.strip().upper()
            if len(code) == 2 and code in STATE_TO_BA:
                return STATE_TO_BA[code]

        # Try matching full state names
        state_name_map = {
            "OREGON": "OR", "WASHINGTON": "WA", "CALIFORNIA": "CA", "TEXAS": "TX",
            "NEW YORK": "NY", "FLORIDA": "FL", "IDAHO": "ID", "MONTANA": "MT",
            "COLORADO": "CO", "ARIZONA": "AZ", "NEVADA": "NV", "UTAH": "UT",
            "OHIO": "OH", "PENNSYLVANIA": "PA", "VIRGINIA": "VA", "GEORGIA": "GA",
            "ILLINOIS": "IL", "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSOURI": "MO",
            "WISCONSIN": "WI", "INDIANA": "IN", "IOWA": "IA", "TENNESSEE": "TN",
            "MASSACHUSETTS": "MA", "CONNECTICUT": "CT", "MARYLAND": "MD",
            "NEW JERSEY": "NJ", "NORTH CAROLINA": "NC", "SOUTH CAROLINA": "SC",
        }
        addr_upper = address.upper()
        for name, code in state_name_map.items():
            if name in addr_upper and code in STATE_TO_BA:
                return STATE_TO_BA[code]

    # Fallback: rough lat/lon to region mapping
    lat = setup_store.get_latitude()
    lon = setup_store.get_longitude()
    if lat and lon and lat != 0.0 and lon != 0.0:
        # Pacific NW
        if 42 <= lat <= 49 and -125 <= lon <= -116:
            return "BPAT"
        # California
        if 32 <= lat <= 42 and -125 <= lon <= -114:
            return "CISO"
        # Texas
        if 25 <= lat <= 37 and -107 <= lon <= -93:
            return "ERCO"
        # Northeast
        if 40 <= lat <= 45 and -80 <= lon <= -72:
            return "NYIS"
        # Southeast
        if 25 <= lat <= 37 and -90 <= lon <= -75:
            return "SOCO"

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

    # Request last 24 hours of data
    now = datetime.utcnow()
    start = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H")

    try:
        params = {
            "api_key": api_key,
            "frequency": "hourly",
            "data[]": "value",
            "facets[respondent][]": ba,
            "start": start,
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": 500,
        }
        logger.info("Fetching EIA grid mix for %s (start=%s)", ba, start)

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(EIA_API_URL, params=params)

        if response.status_code != 200:
            logger.warning("EIA API error: %d %s", response.status_code, response.text[:500])
            return _cached_mix

        data = response.json()
        records = data.get("response", {}).get("data", [])
        logger.info("EIA returned %d records for %s", len(records), ba)

        if not records:
            logger.debug("Grid mix: no data returned for %s", ba)
            return _cached_mix

        # Group all records by period (hour)
        by_period: dict[str, dict[str, float]] = {}
        for r in records:
            period = r.get("period", "")
            fuel = r.get("fueltype", "OTH")
            value = r.get("value")
            if fuel == "ALL" or value is None:
                continue
            mwh = float(value)
            if mwh > 0:
                if period not in by_period:
                    by_period[period] = {}
                by_period[period][fuel] = by_period[period].get(fuel, 0) + mwh

        if not by_period:
            return _cached_mix

        # Build current (latest) period summary
        latest_period = sorted(by_period.keys(), reverse=True)[0]
        fuel_mwh = by_period[latest_period]
        total_mwh = sum(fuel_mwh.values())

        if total_mwh <= 0:
            return _cached_mix

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

        # Build hourly breakdown for the chart
        hourly = []
        for period in sorted(by_period.keys()):
            fuels = by_period[period]
            period_total = sum(fuels.values())
            if period_total <= 0:
                continue
            entry = {"period": period}
            period_clean = 0.0
            for fuel, mwh in fuels.items():
                pct = round((mwh / period_total) * 100, 1)
                entry[fuel] = pct
                entry[f"{fuel}_name"] = FUEL_DISPLAY.get(fuel, fuel)
                if fuel in CLEAN_FUELS:
                    period_clean += pct
            entry["clean_pct"] = round(period_clean, 1)
            entry["fossil_pct"] = round(100 - period_clean, 1)
            hourly.append(entry)

        result = {
            "balancing_authority": ba,
            "period": latest_period,
            "sources": sources,
            "clean_pct": round(clean_pct, 1),
            "fossil_pct": round(fossil_pct, 1),
            "total_mwh": round(total_mwh, 1),
            "hourly": hourly,
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
