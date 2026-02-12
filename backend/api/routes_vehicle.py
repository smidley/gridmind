"""Vehicle API routes - EV charging status, controls, and smart scheduling."""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from database import async_session, VehicleChargeReading
from tesla.client import tesla_client, TeslaAuthError, TeslaAPIError
from tesla.vehicle_commands import (
    list_vehicles,
    get_vehicle_data,
    charge_start,
    charge_stop,
    set_charge_limit,
    set_charging_amps,
    wake_up,
)
from tesla.models import ChargeLimitRequest, ChargingAmpsRequest, ScheduleConfigRequest
from services.vehicle_collector import get_latest_vehicle_status
from services import setup_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vehicle", tags=["vehicle"])


def _require_auth():
    """Raise 401 if not authenticated."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla")


def _get_vehicle_id() -> str:
    """Get the selected vehicle ID or raise 404."""
    vid = setup_store.get("selected_vehicle_id")
    if not vid:
        raise HTTPException(status_code=404, detail="No vehicle selected. Discover and select a vehicle first.")
    return vid


# --- Discovery ---


@router.get("/list")
async def vehicle_list():
    """List vehicles on the Tesla account."""
    _require_auth()
    try:
        vehicles = await list_vehicles()
        selected = setup_store.get("selected_vehicle_id")
        return {
            "vehicles": [v.model_dump() for v in vehicles],
            "selected_vehicle_id": selected,
        }
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.post("/select")
async def vehicle_select(data: dict):
    """Select which vehicle to monitor.

    Body: {"vehicle_id": "...", "display_name": "..."}
    """
    vehicle_id = data.get("vehicle_id")
    if not vehicle_id:
        raise HTTPException(status_code=400, detail="vehicle_id is required")

    setup_store.update({
        "selected_vehicle_id": vehicle_id,
        "selected_vehicle_name": data.get("display_name", "Tesla"),
    })

    logger.info("Selected vehicle: %s (%s)", data.get("display_name"), vehicle_id)
    return {"status": "ok", "vehicle_id": vehicle_id}


# --- Live Status ---


@router.get("/status")
async def vehicle_status():
    """Get current vehicle charge status."""
    _require_auth()
    vid = _get_vehicle_id()

    # Try cached status first
    cached = get_latest_vehicle_status()
    if cached:
        return cached.model_dump(mode="json")

    # Fallback: fetch live
    try:
        status = await get_vehicle_data(vid)
        return status.model_dump(mode="json")
    except TeslaAPIError as e:
        if e.status_code == 408:
            return {
                "vehicle": {
                    "id": vid,
                    "vehicle_id": "",
                    "display_name": setup_store.get("selected_vehicle_name", "Tesla"),
                    "state": "asleep",
                    "vin": "",
                },
                "charge_state": None,
                "timestamp": datetime.utcnow().isoformat(),
            }
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


# --- Charge Controls ---


@router.post("/wake")
async def vehicle_wake():
    """Wake up the vehicle."""
    _require_auth()
    vid = _get_vehicle_id()
    try:
        result = await wake_up(vid)
        return {"status": "ok", "result": result}
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.post("/charge/start")
async def vehicle_charge_start():
    """Start charging the vehicle."""
    _require_auth()
    vid = _get_vehicle_id()

    # Check if smart scheduler is active
    schedule = setup_store.get("ev_schedule", {})
    strategy = schedule.get("strategy", "off") if isinstance(schedule, dict) else "off"
    warning = None
    if strategy != "off":
        warning = f"Smart charge scheduler ({strategy}) is active. Manual charge may be overridden."

    try:
        result = await charge_start(vid)
        resp = {"status": "ok", "result": result}
        if warning:
            resp["warning"] = warning
        return resp
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.post("/charge/stop")
async def vehicle_charge_stop():
    """Stop charging the vehicle."""
    _require_auth()
    vid = _get_vehicle_id()
    try:
        result = await charge_stop(vid)
        return {"status": "ok", "result": result}
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.post("/charge/limit")
async def vehicle_charge_limit(data: ChargeLimitRequest):
    """Set the charge limit percentage."""
    _require_auth()
    vid = _get_vehicle_id()
    try:
        result = await set_charge_limit(vid, data.percent)
        return {"status": "ok", "result": result}
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.post("/charge/amps")
async def vehicle_charge_amps(data: ChargingAmpsRequest):
    """Set the charging amperage."""
    _require_auth()
    vid = _get_vehicle_id()
    try:
        result = await set_charging_amps(vid, data.amps)
        return {"status": "ok", "result": result}
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


# --- Wall Connector ---


@router.get("/wall-connector")
async def vehicle_wall_connector():
    """Get Wall Connector hardware info and live status."""
    _require_auth()

    from tesla.commands import get_live_status, get_site_info

    # State code mappings
    # Note: Tesla state 2 = WC is online and available, not necessarily a vehicle plugged in
    WC_STATE = {
        0: "Booting",
        1: "Idle",
        2: "Online",
        4: "Ready",
        6: "Charging",
        8: "Busy",
        10: "Scheduled",
        11: "Complete",
    }
    WC_FAULT = {
        0: "None",
        1: "Overvoltage",
        2: "None",
        3: "Overcurrent",
        4: "Undercurrent",
        5: "Ground Fault",
    }

    try:
        # Get live data
        live_data = await tesla_client.get(tesla_client._site_url("/live_status"))
        live_resp = live_data.get("response", {})
        wc_live_list = live_resp.get("wall_connectors", [])

        # Get hardware info
        site_data = await tesla_client.get(tesla_client._site_url("/site_info"))
        site_resp = site_data.get("response", {})
        components = site_resp.get("components", {})
        wc_info_list = components.get("wall_connectors", [])

        # Build a map of DIN -> hardware info
        hw_map = {}
        for wc in wc_info_list:
            hw_map[wc.get("din", "")] = {
                "part_name": wc.get("part_name", "Wall Connector"),
                "serial_number": wc.get("serial_number", ""),
                "part_number": wc.get("part_number", ""),
                "is_active": wc.get("is_active", False),
            }

        # Check vehicle charge state to refine WC status
        vehicle_charging_state = None
        cached_vehicle = get_latest_vehicle_status()
        if cached_vehicle and cached_vehicle.charge_state:
            vehicle_charging_state = cached_vehicle.charge_state.charging_state

        connectors = []
        for wc in wc_live_list:
            din = wc.get("din", "")
            state_code = wc.get("wall_connector_state", 0)
            fault_code = wc.get("wall_connector_fault_state", 0)
            hw = hw_map.get(din, {})

            # Determine display state — cross-reference with vehicle if available
            state_label = WC_STATE.get(state_code, f"Unknown ({state_code})")
            if state_code == 2 and vehicle_charging_state:
                # WC is online — check if vehicle is actually plugged in
                if vehicle_charging_state in ("Charging", "Stopped", "Complete", "NoPower"):
                    state_label = "Vehicle Connected"

            connectors.append({
                "din": din,
                "state": state_label,
                "state_code": state_code,
                "fault": WC_FAULT.get(fault_code, f"Fault ({fault_code})"),
                "fault_code": fault_code,
                "has_fault": fault_code not in (0, 2),
                "power_w": wc.get("wall_connector_power", 0),
                "power_kw": round(wc.get("wall_connector_power", 0) / 1000, 2) if wc.get("wall_connector_power", 0) else 0,
                "part_name": hw.get("part_name", "Wall Connector"),
                "serial_number": hw.get("serial_number", ""),
                "part_number": hw.get("part_number", ""),
                "is_active": hw.get("is_active", True),
            })

        return {"connectors": connectors, "count": len(connectors)}

    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


# --- Solar Miles ---


@router.get("/solar-miles")
async def vehicle_solar_miles():
    """Calculate miles charged from solar energy.

    Estimates solar-powered miles by looking at each charging reading's solar fraction
    and the charge rate (mph) over each polling interval.
    """
    from datetime import date

    vid = setup_store.get("selected_vehicle_id")
    if not vid:
        return {"total_solar_kwh": 0, "total_solar_miles": 0, "today_solar_kwh": 0, "today_solar_miles": 0}

    # Model Y ~3.5 mi/kWh (EPA rated), reasonable default
    MILES_PER_KWH = 3.5

    async with async_session() as session:
        result = await session.execute(
            select(VehicleChargeReading)
            .where(
                VehicleChargeReading.vehicle_id == vid,
                VehicleChargeReading.charging_state == "Charging",
                VehicleChargeReading.solar_fraction.isnot(None),
                VehicleChargeReading.charger_power > 0,
            )
            .order_by(VehicleChargeReading.timestamp.asc())
        )
        readings = result.scalars().all()

    if not readings:
        return {"total_solar_kwh": 0, "total_solar_miles": 0, "today_solar_kwh": 0, "today_solar_miles": 0}

    today_str = date.today().isoformat()
    total_solar_kwh = 0.0
    today_solar_kwh = 0.0

    # For each consecutive pair of readings, estimate the solar kWh in that interval
    for i in range(len(readings)):
        r = readings[i]

        # Estimate interval: time between this reading and the previous one
        if i > 0:
            delta_seconds = (r.timestamp - readings[i - 1].timestamp).total_seconds()
        else:
            delta_seconds = 120  # Default 2 min for first reading

        # Cap interval to 10 min (if gap is larger, data was probably missing)
        delta_seconds = min(delta_seconds, 600)
        interval_hours = delta_seconds / 3600

        # Solar kWh this interval = charger_power * solar_fraction * interval
        solar_kwh = (r.charger_power or 0) * (r.solar_fraction or 0) * interval_hours
        total_solar_kwh += solar_kwh

        if r.timestamp.date().isoformat() == today_str:
            today_solar_kwh += solar_kwh

    total_solar_miles = round(total_solar_kwh * MILES_PER_KWH, 1)
    today_solar_miles = round(today_solar_kwh * MILES_PER_KWH, 1)

    return {
        "total_solar_kwh": round(total_solar_kwh, 2),
        "total_solar_miles": total_solar_miles,
        "today_solar_kwh": round(today_solar_kwh, 2),
        "today_solar_miles": today_solar_miles,
        "reading_count": len(readings),
    }


# --- Charge Source ---


@router.get("/charge-source")
async def vehicle_charge_source():
    """Get the current charging power source breakdown.

    Estimates how much of the EV charging power comes from solar, battery, and grid
    based on the current Powerwall status.
    """
    from services.collector import get_latest_status

    cached = get_latest_vehicle_status()
    energy = get_latest_status()

    if not cached or not cached.charge_state or not energy:
        return {"charging": False, "sources": {}}

    cs = cached.charge_state
    if cs.charging_state != "Charging" or cs.charger_power <= 0:
        return {"charging": False, "sources": {}}

    ev_watts = cs.charger_power * 1000

    # Determine sources feeding the home (EV is part of home load)
    solar_w = max(energy.solar_power, 0)
    # battery_power: negative = charging battery, positive = discharging battery
    battery_discharge_w = max(energy.battery_power, 0)
    # grid_power: positive = importing, negative = exporting
    grid_import_w = max(energy.grid_power, 0)

    total_supply = solar_w + battery_discharge_w + grid_import_w

    if total_supply <= 0:
        return {"charging": True, "ev_power_kw": cs.charger_power, "sources": {}}

    # Proportional allocation
    solar_pct = solar_w / total_supply
    battery_pct = battery_discharge_w / total_supply
    grid_pct = grid_import_w / total_supply

    solar_kw = round(ev_watts * solar_pct / 1000, 2)
    battery_kw = round(ev_watts * battery_pct / 1000, 2)
    grid_kw = round(ev_watts * grid_pct / 1000, 2)

    # Determine primary source
    primary = "solar" if solar_pct >= battery_pct and solar_pct >= grid_pct else \
              "battery" if battery_pct >= grid_pct else "grid"

    return {
        "charging": True,
        "ev_power_kw": cs.charger_power,
        "sources": {
            "solar_kw": solar_kw,
            "solar_pct": round(solar_pct * 100),
            "battery_kw": battery_kw,
            "battery_pct": round(battery_pct * 100),
            "grid_kw": grid_kw,
            "grid_pct": round(grid_pct * 100),
        },
        "primary_source": primary,
    }


# --- History ---


@router.get("/history")
async def vehicle_history(
    hours: int = Query(default=24, ge=1, le=168),
    resolution: int = Query(default=5, ge=1, le=60),
):
    """Get historical vehicle charge readings.

    Args:
        hours: How many hours of history (1-168, default 24)
        resolution: Downsample to this many minutes between points (1-60, default 5)
    """
    vid = setup_store.get("selected_vehicle_id")
    if not vid:
        return {"readings": [], "vehicle_id": None}

    since = datetime.utcnow() - timedelta(hours=hours)

    async with async_session() as session:
        result = await session.execute(
            select(VehicleChargeReading)
            .where(
                VehicleChargeReading.vehicle_id == vid,
                VehicleChargeReading.timestamp >= since,
            )
            .order_by(VehicleChargeReading.timestamp.asc())
        )
        readings = result.scalars().all()

    # Downsample if needed
    if resolution > 1 and readings:
        downsampled = []
        last_time = None
        interval = timedelta(minutes=resolution)
        for r in readings:
            if last_time is None or (r.timestamp - last_time) >= interval:
                downsampled.append(r)
                last_time = r.timestamp
        readings = downsampled

    return {
        "vehicle_id": vid,
        "readings": [
            {
                "timestamp": r.timestamp.isoformat(),
                "battery_level": r.battery_level,
                "battery_range": r.battery_range,
                "charging_state": r.charging_state,
                "charge_rate": r.charge_rate,
                "charger_power": r.charger_power,
                "charge_energy_added": r.charge_energy_added,
                "charge_limit_soc": r.charge_limit_soc,
            }
            for r in readings
        ],
    }


# --- Smart Schedule ---


@router.get("/schedule")
async def get_schedule():
    """Get the current smart charge schedule configuration."""
    schedule = setup_store.get("ev_schedule", {})
    if not isinstance(schedule, dict):
        schedule = {}

    # Return with defaults
    return {
        "strategy": schedule.get("strategy", "off"),
        "solar_surplus_threshold_kw": schedule.get("solar_surplus_threshold_kw", 1.5),
        "solar_surplus_min_soc": schedule.get("solar_surplus_min_soc", 20),
        "departure_time": schedule.get("departure_time", "07:30"),
        "departure_target_soc": schedule.get("departure_target_soc", 80),
        "battery_capacity_kwh": schedule.get("battery_capacity_kwh", 75.0),
        "grid_charge_limit": schedule.get("grid_charge_limit", 0),
        "solar_charge_limit": schedule.get("solar_charge_limit", 0),
    }


@router.post("/schedule")
async def save_schedule(config: ScheduleConfigRequest):
    """Save the smart charge schedule configuration."""
    if config.strategy not in ("off", "tou_aware", "solar_surplus", "departure"):
        raise HTTPException(status_code=400, detail="Invalid strategy")

    schedule_data = config.model_dump()
    setup_store.set("ev_schedule", schedule_data)

    logger.info("EV schedule updated: strategy=%s", config.strategy)
    return {"status": "ok", "schedule": schedule_data}
