"""Powerwall health monitoring routes — diagnostics, alerts, connectivity."""

import logging
from datetime import datetime, timedelta, date

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, func, and_

from database import async_session, EnergyReading, DailyEnergySummary
from tesla.client import tesla_client, TeslaAPIError
from services.collector import get_latest_status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/powerwall", tags=["powerwall-health"])


def _require_auth():
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla")


@router.get("/health")
async def powerwall_health():
    """Comprehensive Powerwall health report."""
    _require_auth()

    try:
        # Get site info for hardware details
        site_data = await tesla_client.get(tesla_client._site_url("/site_info"))
        site = site_data.get("response", {})
        components = site.get("components", {})

        # Get backup time remaining
        backup_time = None
        try:
            bt_data = await tesla_client.get(tesla_client._site_url("/backup_time_remaining"))
            backup_time = bt_data.get("response", {}).get("time_remaining_hours")
        except TeslaAPIError:
            pass

        # Get live status
        live_data = await tesla_client.get(tesla_client._site_url("/live_status"))
        live = live_data.get("response", {})

        # Gateway info
        gateways = components.get("gateways", [])
        batteries = components.get("batteries", [])
        gateway = gateways[0] if gateways else {}

        # Installation age
        install_date = site.get("installation_date", "")
        days_since_install = None
        if install_date:
            try:
                install_dt = datetime.fromisoformat(install_date.replace("Z", "+00:00"))
                days_since_install = (datetime.now(install_dt.tzinfo) - install_dt).days
            except (ValueError, TypeError):
                pass

        # Build hardware list
        hardware = []
        for gw in gateways:
            hardware.append({
                "type": "gateway",
                "name": gw.get("part_name", "Gateway"),
                "serial": gw.get("serial_number", ""),
                "part_number": gw.get("part_number", ""),
                "firmware": gw.get("firmware_version", ""),
                "firmware_date": gw.get("updated_datetime", ""),
                "active": gw.get("is_active", True),
            })
        for b in batteries:
            name = b.get("part_name", "")
            if name == "Unknown" or not name:
                name = "Expansion Pack"
            hardware.append({
                "type": "battery",
                "name": name,
                "serial": b.get("serial_number", ""),
                "part_number": b.get("part_number", ""),
                "active": b.get("is_active", True),
            })

        # Wall connectors
        for wc in components.get("wall_connectors", []):
            hardware.append({
                "type": "wall_connector",
                "name": wc.get("part_name", "Wall Connector"),
                "serial": wc.get("serial_number", ""),
                "part_number": wc.get("part_number", ""),
                "active": wc.get("is_active", True),
            })

        # Connectivity
        grid_status = live.get("grid_status", "Unknown")
        island_status = live.get("island_status", "Unknown")

        return {
            "system": {
                "site_name": site.get("site_name", ""),
                "battery_count": site.get("battery_count", 0),
                "capacity_kwh": site.get("battery_count", 0) * 13.5,
                "nameplate_power_w": site.get("nameplate_power", 0),
                "nameplate_power_kw": round(site.get("nameplate_power", 0) / 1000, 1),
                "firmware": site.get("version", ""),
                "installation_date": install_date,
                "days_since_install": days_since_install,
                "utility": site.get("utility", ""),
                "tariff_id": site.get("tariff_id", ""),
            },
            "connectivity": {
                "grid_status": grid_status,
                "island_status": island_status,
                "grid_connected": grid_status == "Active",
                "storm_mode_active": live.get("storm_mode_active", False),
                "storm_mode_capable": components.get("storm_mode_capable", False),
            },
            "battery": {
                "soc": live.get("percentage_charged", 0),
                "power_w": live.get("battery_power", 0),
                "backup_reserve_pct": site.get("backup_reserve_percent", 0),
                "backup_time_remaining_hours": backup_time,
                "operation_mode": site.get("default_real_mode", ""),
            },
            "hardware": hardware,
            "capabilities": {
                "tou_capable": components.get("tou_capable", False),
                "storm_mode_capable": components.get("storm_mode_capable", False),
                "grid_services_enabled": components.get("grid_services_enabled", False),
                "backup_time_remaining_enabled": components.get("backup_time_remaining_enabled", False),
                "set_islanding_mode_enabled": components.get("set_islanding_mode_enabled", False),
            },
        }

    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.get("/health/throughput")
async def powerwall_throughput(days: int = 30):
    """Battery throughput statistics — daily charge/discharge totals for health trending."""
    days = min(days, 365)

    async with async_session() as session:
        since = date.today() - timedelta(days=days)
        result = await session.execute(
            select(DailyEnergySummary)
            .where(DailyEnergySummary.date >= since.isoformat())
            .order_by(DailyEnergySummary.date.asc())
        )
        summaries = result.scalars().all()

    if not summaries:
        return {"days": [], "totals": {}}

    daily = []
    total_charged = 0.0
    total_discharged = 0.0
    total_solar = 0.0
    total_exported = 0.0
    total_imported = 0.0
    total_consumed = 0.0

    for s in summaries:
        charged = s.battery_charged_kwh or 0
        discharged = s.battery_discharged_kwh or 0
        total_charged += charged
        total_discharged += discharged
        total_solar += s.solar_generated_kwh or 0
        total_exported += s.grid_exported_kwh or 0
        total_imported += s.grid_imported_kwh or 0
        total_consumed += s.home_consumed_kwh or 0

        daily.append({
            "date": s.date,
            "charged_kwh": round(charged, 2),
            "discharged_kwh": round(discharged, 2),
            "solar_kwh": round(s.solar_generated_kwh or 0, 2),
            "consumed_kwh": round(s.home_consumed_kwh or 0, 2),
            "exported_kwh": round(s.grid_exported_kwh or 0, 2),
            "imported_kwh": round(s.grid_imported_kwh or 0, 2),
        })

    # Calculate lifetime cycle estimate (based on 13.5 kWh per PW3)
    capacity = 13.5 * 2  # User has 2 batteries
    total_cycles = round(total_discharged / capacity, 1) if capacity > 0 else 0
    avg_daily_cycles = round(total_cycles / len(summaries), 3) if summaries else 0

    # Self-powered percentage (clamped 0-100)
    self_powered_pct = round(
        max(0, (1 - total_imported / total_consumed)) * 100, 1
    ) if total_consumed > 0 else 0

    return {
        "days": daily,
        "totals": {
            "total_charged_kwh": round(total_charged, 1),
            "total_discharged_kwh": round(total_discharged, 1),
            "total_solar_kwh": round(total_solar, 1),
            "total_exported_kwh": round(total_exported, 1),
            "total_imported_kwh": round(total_imported, 1),
            "total_consumed_kwh": round(total_consumed, 1),
            "total_cycles": total_cycles,
            "avg_daily_cycles": avg_daily_cycles,
            "self_powered_pct": self_powered_pct,
            "days_tracked": len(summaries),
        },
    }


@router.get("/health/alerts")
async def powerwall_alerts():
    """Detect health alerts from recent readings — grid outages, low SOC events, connectivity issues."""

    alerts = []
    now = datetime.utcnow()

    async with async_session() as session:
        # Check last 7 days of readings for anomalies
        since = now - timedelta(days=7)
        result = await session.execute(
            select(EnergyReading)
            .where(EnergyReading.timestamp >= since)
            .order_by(EnergyReading.timestamp.asc())
        )
        readings = result.scalars().all()

    if not readings:
        return {"alerts": [], "checked_at": now.isoformat()}

    # Detect grid outages (transitions from connected to islanded)
    prev_grid = None
    outage_start = None
    for r in readings:
        gs = r.grid_status
        if prev_grid == "connected" and gs == "islanded":
            outage_start = r.timestamp
        elif prev_grid == "islanded" and gs == "connected" and outage_start:
            duration_min = (r.timestamp - outage_start).total_seconds() / 60
            alerts.append({
                "type": "grid_outage",
                "severity": "warning" if duration_min < 30 else "critical",
                "message": f"Grid outage for {duration_min:.0f} minutes",
                "started": outage_start.isoformat(),
                "ended": r.timestamp.isoformat(),
                "duration_minutes": round(duration_min, 1),
            })
            outage_start = None
        prev_grid = gs

    # If still islanded
    if outage_start and prev_grid == "islanded":
        duration_min = (now - outage_start).total_seconds() / 60
        alerts.append({
            "type": "grid_outage",
            "severity": "critical",
            "message": f"Grid outage ongoing ({duration_min:.0f} min)",
            "started": outage_start.isoformat(),
            "ended": None,
            "duration_minutes": round(duration_min, 1),
        })

    # Detect low SOC events (below 10%)
    low_soc_start = None
    for r in readings:
        if r.battery_soc is not None and r.battery_soc < 10:
            if low_soc_start is None:
                low_soc_start = r.timestamp
        elif low_soc_start:
            duration_min = (r.timestamp - low_soc_start).total_seconds() / 60
            alerts.append({
                "type": "low_battery",
                "severity": "warning",
                "message": f"Battery below 10% for {duration_min:.0f} minutes",
                "started": low_soc_start.isoformat(),
                "ended": r.timestamp.isoformat(),
                "duration_minutes": round(duration_min, 1),
            })
            low_soc_start = None

    # Current status alerts
    latest = get_latest_status()
    if latest:
        if latest.grid_status == "islanded":
            alerts.append({
                "type": "grid_status",
                "severity": "critical",
                "message": "Currently islanded — grid is disconnected",
                "started": now.isoformat(),
                "ended": None,
            })
        if latest.battery_soc < 10:
            alerts.append({
                "type": "low_battery",
                "severity": "warning",
                "message": f"Battery critically low at {latest.battery_soc:.0f}%",
                "started": now.isoformat(),
                "ended": None,
            })
        if latest.storm_mode:
            alerts.append({
                "type": "storm_mode",
                "severity": "info",
                "message": "Storm Watch is active — battery reserved for backup",
                "started": now.isoformat(),
                "ended": None,
            })

    # Firmware version change detection
    try:
        from tesla.commands import get_site_info as _get_info
        info = await _get_info()
        current_fw = info.get("version", "")
        if current_fw:
            last_fw = setup_store.get("last_known_firmware", "")
            if last_fw and last_fw != current_fw:
                alerts.append({
                    "type": "firmware_update",
                    "severity": "info",
                    "message": f"Firmware updated: {last_fw} → {current_fw}",
                    "started": now.isoformat(),
                    "ended": None,
                })
            # Always update the stored version
            if current_fw != last_fw:
                setup_store.set("last_known_firmware", current_fw)
    except Exception:
        pass

    # Sort: ongoing first, then by time descending
    alerts.sort(key=lambda a: (a.get("ended") is not None, a.get("started", "")), reverse=True)

    return {"alerts": alerts, "checked_at": now.isoformat()}


@router.get("/health/savings")
async def powerwall_savings():
    """Calculate cost savings from having solar + battery vs grid-only.

    Computes what you would have paid at full TOU rates for all consumption,
    minus what you actually paid (imports only). The difference is your savings.
    """
    from tesla.client import tesla_client as tc, TeslaAPIError
    from tesla.commands import get_site_info
    from services import setup_store as ss
    from zoneinfo import ZoneInfo

    if not tc.is_authenticated:
        return {"error": "Not authenticated"}

    try:
        info = await get_site_info()
    except TeslaAPIError:
        return {"error": "Could not fetch site info"}

    tariff = info.get("tariff_content", {})
    if not tariff:
        return {"error": "No tariff configured"}

    user_tz_name = ss.get_timezone()
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/New_York")

    # Get rate info — find a reasonable average buy rate
    seasons = tariff.get("seasons", {})
    energy_charges = tariff.get("energy_charges", {})

    # Collect all buy rates to find avg
    all_rates = []
    for season_data in energy_charges.values():
        for rate in season_data.values():
            if isinstance(rate, (int, float)) and rate > 0:
                all_rates.append(rate)
    avg_buy_rate = sum(all_rates) / len(all_rates) if all_rates else 0.15  # $/kWh

    # Get throughput data
    async with async_session() as session:
        result = await session.execute(
            select(DailyEnergySummary).order_by(DailyEnergySummary.date.asc())
        )
        summaries = result.scalars().all()

    if not summaries:
        return {"error": "No energy data yet"}

    total_consumed = sum(s.home_consumed_kwh or 0 for s in summaries)
    total_imported = sum(s.grid_imported_kwh or 0 for s in summaries)
    total_exported = sum(s.grid_exported_kwh or 0 for s in summaries)
    total_solar = sum(s.solar_generated_kwh or 0 for s in summaries)

    # What you WOULD have paid without solar/battery (all consumption from grid)
    would_have_paid = total_consumed * avg_buy_rate

    # What you actually paid (only grid imports, at avg rate)
    actually_paid = total_imported * avg_buy_rate

    # Export credits (sell rate is typically lower)
    sell_tariff = tariff.get("sell_tariff", {})
    sell_charges = sell_tariff.get("energy_charges", energy_charges)
    sell_rates = []
    for season_data in sell_charges.values():
        for rate in season_data.values():
            if isinstance(rate, (int, float)) and rate > 0:
                sell_rates.append(rate)
    avg_sell_rate = sum(sell_rates) / len(sell_rates) if sell_rates else avg_buy_rate
    export_credits = total_exported * avg_sell_rate

    total_savings = (would_have_paid - actually_paid) + export_credits
    days = len(summaries)

    # Today's savings
    today_summary = summaries[-1] if summaries else None
    today_savings = 0
    if today_summary:
        today_consumed = today_summary.home_consumed_kwh or 0
        today_imported = today_summary.grid_imported_kwh or 0
        today_exported = today_summary.grid_exported_kwh or 0
        today_savings = ((today_consumed - today_imported) * avg_buy_rate) + (today_exported * avg_sell_rate)

    return {
        "total_savings": round(total_savings, 2),
        "today_savings": round(today_savings, 2),
        "avg_daily_savings": round(total_savings / days, 2) if days else 0,
        "would_have_paid": round(would_have_paid, 2),
        "actually_paid": round(actually_paid, 2),
        "export_credits": round(export_credits, 2),
        "avg_buy_rate": round(avg_buy_rate, 4),
        "avg_sell_rate": round(avg_sell_rate, 4),
        "days_tracked": days,
        "monthly_estimate": round((total_savings / days) * 30, 2) if days else 0,
    }


@router.get("/health/capacity")
async def powerwall_capacity():
    """Estimate effective battery capacity from charge cycle data.

    Finds deep charge cycles (>30% SOC swing) and calculates the effective
    capacity (kWh per 100% SOC). Tracks round-trip efficiency and peak power
    over time for degradation trending.
    """
    NOMINAL_CAPACITY = 27.0  # 2 × 13.5 kWh PW3
    EFFICIENCY_ESTIMATE = 0.92  # Typical round-trip efficiency for LFP

    async with async_session() as session:
        # Get all daily stats for cycle analysis
        result = await session.execute(
            select(DailyEnergySummary)
            .order_by(DailyEnergySummary.date.asc())
        )
        daily_summaries = result.scalars().all()

        # Get readings for detailed cycle detection
        result = await session.execute(
            select(
                func.date(EnergyReading.timestamp).label("day"),
                func.min(EnergyReading.battery_soc).label("min_soc"),
                func.max(EnergyReading.battery_soc).label("max_soc"),
                func.max(EnergyReading.battery_power).label("peak_discharge_w"),
                func.min(EnergyReading.battery_power).label("peak_charge_w"),
            )
            .group_by(func.date(EnergyReading.timestamp))
            .order_by(func.date(EnergyReading.timestamp).asc())
        )
        daily_readings = result.all()

    # --- Capacity Estimation ---
    # Find days with deep cycles (SOC swing > 30%) where we have both
    # charged kWh and SOC data to estimate effective capacity
    capacity_estimates = []
    for dr in daily_readings:
        day_str = dr.day
        min_soc = dr.min_soc or 0
        max_soc = dr.max_soc or 0
        soc_swing = max_soc - min_soc

        if soc_swing < 30:
            continue  # Need a meaningful swing for estimation

        # Find matching daily summary for kWh data
        summary = next((s for s in daily_summaries if s.date == day_str), None)
        if not summary or not summary.battery_charged_kwh:
            continue

        # Estimate capacity from charged kWh and SOC range
        # effective_capacity = charged_kwh / (soc_swing / 100) * efficiency
        charged = summary.battery_charged_kwh
        effective = (charged * EFFICIENCY_ESTIMATE) / (soc_swing / 100)

        # Sanity check — should be in the ballpark of nominal
        if effective < NOMINAL_CAPACITY * 0.5 or effective > NOMINAL_CAPACITY * 1.3:
            continue  # Likely bad data or partial cycles

        capacity_estimates.append({
            "date": day_str,
            "min_soc": round(min_soc, 1),
            "max_soc": round(max_soc, 1),
            "soc_swing_pct": round(soc_swing, 1),
            "charged_kwh": round(charged, 2),
            "estimated_capacity_kwh": round(effective, 2),
            "health_pct": round((effective / NOMINAL_CAPACITY) * 100, 1),
        })

    # --- Round-Trip Efficiency ---
    efficiency_data = []
    for s in daily_summaries:
        charged = s.battery_charged_kwh or 0
        discharged = s.battery_discharged_kwh or 0
        if charged > 1 and discharged > 1:  # Need meaningful throughput
            eff = discharged / charged
            if 0.5 < eff < 1.1:  # Sanity check
                efficiency_data.append({
                    "date": s.date,
                    "charged_kwh": round(charged, 2),
                    "discharged_kwh": round(discharged, 2),
                    "efficiency_pct": round(eff * 100, 1),
                })

    # --- Peak Power Tracking ---
    peak_power_data = []
    for dr in daily_readings:
        peak_discharge = dr.peak_discharge_w or 0  # Max positive (discharge)
        peak_charge = abs(dr.peak_charge_w or 0)  # Min negative (charge), take abs
        if peak_discharge > 100 or peak_charge > 100:
            peak_power_data.append({
                "date": dr.day,
                "peak_discharge_kw": round(peak_discharge / 1000, 2),
                "peak_charge_kw": round(peak_charge / 1000, 2),
            })

    # --- Summary ---
    latest_capacity = capacity_estimates[-1] if capacity_estimates else None
    avg_efficiency = (
        round(sum(e["efficiency_pct"] for e in efficiency_data) / len(efficiency_data), 1)
        if efficiency_data else None
    )

    return {
        "nominal_capacity_kwh": NOMINAL_CAPACITY,
        "latest_estimate": latest_capacity,
        "capacity_trend": capacity_estimates,
        "efficiency_trend": efficiency_data,
        "avg_efficiency_pct": avg_efficiency,
        "peak_power_trend": peak_power_data,
        "data_points": len(capacity_estimates),
        "note": "Capacity estimates improve with more deep charge cycles. At least 30% SOC swing required for estimation.",
    }
