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
                "capacity_kwh": site.get("battery_count", 0) * 13.5,  # PW3 = 13.5 kWh/unit
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

    # Calculate lifetime cycle estimate
    from services.battery_capacity import get_battery_capacity_sync
    cap_info = get_battery_capacity_sync()
    capacity = cap_info["capacity_kwh"]
    total_cycles = round(total_discharged / capacity, 1) if capacity > 0 else 0
    avg_daily_cycles = round(total_cycles / len(summaries), 3) if summaries else 0

    # Self-powered percentage: fraction of home consumption served by solar + battery
    # (not from grid). Grid imports also charge the battery, so imported > consumed
    # is normal. We cap grid_to_home at total_consumed to avoid negative values.
    # self_powered = (consumed - grid_to_home) / consumed
    grid_to_home = min(total_imported, total_consumed)
    self_powered_pct = round(
        max(0, min(100, (1 - grid_to_home / total_consumed) * 100)), 1
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
    # Skip short events caused by optimizer dumps — when GridMind Optimize is
    # dumping, the battery intentionally drops to 5%. Only alert if the low SOC
    # persists for an unusually long time (>3 hours), suggesting a real problem.
    from automation.optimizer import get_state as get_optimizer_state
    optimizer_enabled = get_optimizer_state().get("enabled", False)
    low_soc_min_duration = 180 if optimizer_enabled else 0  # 3 hours if optimizer active

    low_soc_start = None
    for r in readings:
        if r.battery_soc is not None and r.battery_soc < 10:
            if low_soc_start is None:
                low_soc_start = r.timestamp
        elif low_soc_start:
            duration_min = (r.timestamp - low_soc_start).total_seconds() / 60
            if duration_min > low_soc_min_duration:
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

    avg_daily = total_savings / days if days else 0
    yearly_estimate = avg_daily * 365

    # Break-even calculation
    system_cost = float(ss.get("system_cost") or 0)
    breakeven = None
    if system_cost > 0:
        remaining = max(system_cost - total_savings, 0)
        pct = min((total_savings / system_cost) * 100, 100) if system_cost > 0 else 0
        est_days = remaining / avg_daily if avg_daily > 0 else 0
        from datetime import date as date_type
        est_date = (date_type.today() + timedelta(days=int(est_days))).isoformat() if est_days > 0 else None
        breakeven = {
            "system_cost": round(system_cost, 2),
            "remaining": round(remaining, 2),
            "pct": round(pct, 1),
            "estimated_days": int(est_days),
            "estimated_years": round(est_days / 365, 1) if est_days > 0 else 0,
            "estimated_date": est_date,
            "paid_off": remaining <= 0,
        }

    return {
        "total_savings": round(total_savings, 2),
        "today_savings": round(today_savings, 2),
        "avg_daily_savings": round(avg_daily, 2),
        "would_have_paid": round(would_have_paid, 2),
        "actually_paid": round(actually_paid, 2),
        "export_credits": round(export_credits, 2),
        "avg_buy_rate": round(avg_buy_rate, 4),
        "avg_sell_rate": round(avg_sell_rate, 4),
        "days_tracked": days,
        "monthly_estimate": round(avg_daily * 30, 2),
        "yearly_estimate": round(yearly_estimate, 2),
        "breakeven": breakeven,
    }


@router.get("/health/capacity")
async def powerwall_capacity():
    """Estimate effective battery capacity from charge cycle data.

    Finds deep charge cycles (>30% SOC swing) and calculates the effective
    capacity (kWh per 100% SOC). Tracks round-trip efficiency and peak power
    over time for degradation trending.
    """
    EFFICIENCY_ESTIMATE = 0.92  # Typical round-trip efficiency for LFP

    # Get nominal capacity from centralized battery service
    from services.battery_capacity import get_battery_capacity
    cap_info = await get_battery_capacity()
    NOMINAL_CAPACITY = cap_info["capacity_kwh"]

    from zoneinfo import ZoneInfo
    from services import setup_store
    user_tz_name = setup_store.get_timezone()
    try:
        user_tz = ZoneInfo(user_tz_name)
    except Exception:
        user_tz = ZoneInfo("America/New_York")

    async with async_session() as session:
        # Get all daily stats for cycle analysis
        result = await session.execute(
            select(DailyEnergySummary)
            .order_by(DailyEnergySummary.date.asc())
        )
        daily_summaries = result.scalars().all()

        # Get all readings for cycle detection — group by LOCAL date in Python
        # to avoid UTC/local date mismatch (SQLite func.date uses UTC, but
        # DailyEnergySummary dates are local time)
        result = await session.execute(
            select(EnergyReading.timestamp, EnergyReading.battery_soc, EnergyReading.battery_power)
            .where(EnergyReading.battery_soc.isnot(None))
            .order_by(EnergyReading.timestamp.asc())
        )
        all_readings = result.all()

    # Group readings by local date
    from collections import defaultdict
    readings_by_day: dict[str, list] = defaultdict(list)
    for r in all_readings:
        ts = r.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=ZoneInfo("UTC"))
        local_dt = ts.astimezone(user_tz)
        day_str = local_dt.strftime("%Y-%m-%d")
        readings_by_day[day_str].append(r)

    # Build daily SOC/power stats from local-time-grouped readings
    daily_readings = []
    for day_str in sorted(readings_by_day.keys()):
        day_data = readings_by_day[day_str]
        socs = [r.battery_soc for r in day_data if r.battery_soc is not None]
        powers = [r.battery_power for r in day_data if r.battery_power is not None]
        if not socs:
            continue
        daily_readings.append({
            "day": day_str,
            "min_soc": min(socs),
            "max_soc": max(socs),
            "peak_discharge_w": max(powers) if powers else 0,
            "peak_charge_w": min(powers) if powers else 0,
        })

    # --- Capacity Estimation ---
    # Find days with deep cycles (SOC swing > 30%) where we have both
    # charged kWh and SOC data to estimate effective capacity
    capacity_estimates = []
    for dr in daily_readings:
        day_str = dr["day"]
        min_soc = dr["min_soc"] or 0
        max_soc = dr["max_soc"] or 0
        soc_swing = max_soc - min_soc

        if soc_swing < 30:
            continue  # Need a meaningful swing for estimation

        # Find matching daily summary for kWh data (both use local dates now)
        summary = next((s for s in daily_summaries if s.date == day_str), None)
        if not summary or not summary.battery_charged_kwh:
            continue

        # Estimate battery health by comparing discharged energy against
        # what a healthy battery should deliver for this specific SOC range.
        #
        # Use discharged kWh (energy OUT) — this is the actual usable energy
        # the battery delivered. No efficiency correction needed since we're
        # comparing output to expected output.
        #
        # health = discharged / (nominal * swing_fraction)
        # e.g. 20.76 kWh discharged for 80.1% swing of 27 kWh battery:
        #      expected = 27 * 0.801 = 21.63 kWh
        #      health = 20.76 / 21.63 = 96.0%
        charged = summary.battery_charged_kwh or 0
        discharged = summary.battery_discharged_kwh or 0

        if discharged <= 0:
            continue

        swing_fraction = soc_swing / 100
        expected_kwh = NOMINAL_CAPACITY * swing_fraction

        # Health = what we got / what we expected for this range
        health_pct = (discharged / expected_kwh) * 100 if expected_kwh > 0 else 0

        # Sanity check — health should be 50-105% (allow small measurement noise)
        if health_pct < 50 or health_pct > 105:
            continue  # Likely bad data or multi-cycle day

        # Cap at 100%
        health_pct = min(health_pct, 100.0)
        effective = min(discharged / swing_fraction, NOMINAL_CAPACITY)

        capacity_estimates.append({
            "date": day_str,
            "min_soc": round(min_soc, 1),
            "max_soc": round(max_soc, 1),
            "soc_swing_pct": round(soc_swing, 1),
            "charged_kwh": round(charged, 2),
            "discharged_kwh": round(discharged, 2),
            "expected_kwh": round(expected_kwh, 2),
            "estimated_capacity_kwh": round(effective, 2),
            "health_pct": round(health_pct, 1),
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
        peak_discharge = dr["peak_discharge_w"] or 0  # Max positive (discharge)
        peak_charge = abs(dr["peak_charge_w"] or 0)  # Min negative (charge), take abs
        if peak_discharge > 100 or peak_charge > 100:
            peak_power_data.append({
                "date": dr["day"],
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
