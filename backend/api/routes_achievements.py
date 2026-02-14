"""Achievements system — badges earned from energy milestones."""

import logging
from datetime import datetime, date, timedelta

from fastapi import APIRouter
from sqlalchemy import select, func

from database import async_session, EnergyReading, DailyEnergySummary, VehicleChargeReading
from services import setup_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["achievements"])


def _achievement(id: str, title: str, description: str, category: str, icon: str,
                 earned: bool, earned_value: str = "", earned_date: str = ""):
    return {
        "id": id,
        "title": title,
        "description": description,
        "category": category,
        "icon": icon,
        "earned": earned,
        "earned_value": earned_value,
        "earned_date": earned_date,
    }


@router.get("/achievements")
async def get_achievements():
    """Evaluate all achievements from existing data."""

    achievements = []

    # --- Gather data ---

    async with async_session() as session:
        # Daily summaries
        result = await session.execute(
            select(DailyEnergySummary).order_by(DailyEnergySummary.date.asc())
        )
        summaries = result.scalars().all()

        # Grid outage detection (readings where grid went islanded)
        outage_result = await session.execute(
            select(func.count()).where(EnergyReading.grid_status == "islanded")
        )
        islanded_count = outage_result.scalar() or 0

        # Solar miles
        solar_miles_result = await session.execute(
            select(
                func.sum(
                    VehicleChargeReading.charger_power * VehicleChargeReading.solar_fraction
                )
            ).where(
                VehicleChargeReading.solar_fraction.isnot(None),
                VehicleChargeReading.charger_power > 0,
            )
        )
        # Rough estimate: sum of (power * fraction) * 2min interval / 60 * 3.5 mi/kWh
        raw_solar_charge = solar_miles_result.scalar() or 0
        solar_miles_total = round(raw_solar_charge * (2 / 60) * 3.5, 1)

    # Totals from summaries
    total_solar = sum(s.solar_generated_kwh or 0 for s in summaries)
    total_exported = sum(s.grid_exported_kwh or 0 for s in summaries)
    total_imported = sum(s.grid_imported_kwh or 0 for s in summaries)
    total_consumed = sum(s.home_consumed_kwh or 0 for s in summaries)
    total_charged = sum(s.battery_charged_kwh or 0 for s in summaries)
    total_discharged = sum(s.battery_discharged_kwh or 0 for s in summaries)
    days_tracked = len(summaries)

    # Battery cycles (27 kWh nominal for 2x PW3)
    capacity = 27.0
    total_cycles = total_discharged / capacity if capacity > 0 else 0

    # Financial estimate
    avg_rate = 0.15  # Default fallback
    try:
        from tesla.client import tesla_client as tc
        if tc.is_authenticated:
            from tesla.commands import get_site_info
            info = await get_site_info()
            tariff = info.get("tariff_content", {})
            charges = tariff.get("energy_charges", {})
            rates = []
            for s in charges.values():
                for r in s.values():
                    if isinstance(r, (int, float)) and r > 0:
                        rates.append(r)
            if rates:
                avg_rate = sum(rates) / len(rates)
    except Exception:
        pass

    total_savings = max(0, (total_consumed - total_imported) * avg_rate + total_exported * avg_rate)

    # Consecutive solar days
    solar_streak = 0
    current_streak = 0
    for s in summaries:
        if (s.solar_generated_kwh or 0) > 0.5:
            current_streak += 1
            solar_streak = max(solar_streak, current_streak)
        else:
            current_streak = 0

    # Net zero days (exported >= imported)
    net_zero_days = sum(1 for s in summaries
                        if (s.grid_exported_kwh or 0) >= (s.grid_imported_kwh or 0) and (s.grid_exported_kwh or 0) > 0)

    # Self-powered days (zero or near-zero import)
    self_powered_days = sum(1 for s in summaries
                           if (s.grid_imported_kwh or 0) < 0.1 and (s.home_consumed_kwh or 0) > 1)

    # Perfect solar days (actual >= forecast — check if we have forecast data)
    # We'll approximate: days where solar > 90% of max observed
    max_solar_day = max((s.solar_generated_kwh or 0 for s in summaries), default=0)

    # Install age
    install_date = setup_store.get("gridmind_optimize_enabled")  # Just check tracked days
    days_running = days_tracked

    # Config completeness
    has_location = setup_store.is_location_configured()
    has_credentials = setup_store.is_setup_complete()
    has_vehicle = bool(setup_store.get("selected_vehicle_id"))
    has_solar_config = bool(setup_store.get("solar_capacity_kw"))
    fully_configured = has_location and has_credentials and has_vehicle and has_solar_config

    # --- Compute dates when cumulative thresholds were first crossed ---
    def _find_threshold_date(summaries, field, threshold):
        """Walk daily summaries and return the date when cumulative total first crossed threshold."""
        running = 0
        for s in summaries:
            running += getattr(s, field, 0) or 0
            if running >= threshold:
                return s.date
        return ""

    # Pre-compute milestone dates for solar
    solar_1_date = _find_threshold_date(summaries, "solar_generated_kwh", 1)
    solar_100_date = _find_threshold_date(summaries, "solar_generated_kwh", 100)
    solar_1000_date = _find_threshold_date(summaries, "solar_generated_kwh", 1000)
    solar_10000_date = _find_threshold_date(summaries, "solar_generated_kwh", 10000)

    # Pre-compute milestone dates for exports
    export_1000_date = _find_threshold_date(summaries, "grid_exported_kwh", 1000)

    # Pre-compute battery cycle dates
    cycle_1_date = _find_threshold_date(summaries, "battery_discharged_kwh", capacity)
    cycle_100_date = _find_threshold_date(summaries, "battery_discharged_kwh", capacity * 100)

    # Find first self-powered day, net-zero day, outage date
    first_self_powered_date = ""
    first_net_zero_date = ""
    for s in summaries:
        if not first_self_powered_date and (s.grid_imported_kwh or 0) < 0.1 and (s.home_consumed_kwh or 0) > 1:
            first_self_powered_date = s.date
        if not first_net_zero_date and (s.grid_exported_kwh or 0) >= (s.grid_imported_kwh or 0) and (s.grid_exported_kwh or 0) > 0:
            first_net_zero_date = s.date

    # Find solar streak date (when 7-day streak was first achieved)
    streak_7_date = ""
    cs = 0
    for s in summaries:
        if (s.solar_generated_kwh or 0) > 0.5:
            cs += 1
            if cs >= 7 and not streak_7_date:
                streak_7_date = s.date
        else:
            cs = 0

    # Financial milestone dates
    running_savings = 0
    savings_1_date = ""
    savings_100_date = ""
    savings_1000_date = ""
    for s in summaries:
        consumed = s.home_consumed_kwh or 0
        imported = s.grid_imported_kwh or 0
        exported = s.grid_exported_kwh or 0
        running_savings += max(0, (consumed - imported) * avg_rate + exported * avg_rate)
        if running_savings >= 1 and not savings_1_date:
            savings_1_date = s.date
        if running_savings >= 100 and not savings_100_date:
            savings_100_date = s.date
        if running_savings >= 1000 and not savings_1000_date:
            savings_1000_date = s.date

    # Days running milestones
    day_7_date = summaries[6].date if len(summaries) >= 7 else ""
    day_30_date = summaries[29].date if len(summaries) >= 30 else ""

    # --- Solar Achievements ---

    achievements.append(_achievement(
        "first_light", "First Light", "Generate your first kWh of solar energy", "solar", "sun",
        total_solar >= 1, f"{total_solar:.1f} kWh generated" if total_solar >= 1 else "", solar_1_date,
    ))
    achievements.append(_achievement(
        "solar_century", "Solar Century", "Generate 100 kWh of solar energy", "solar", "sun",
        total_solar >= 100, f"{total_solar:.0f} kWh generated" if total_solar >= 100 else "", solar_100_date,
    ))
    achievements.append(_achievement(
        "solar_kilowatt_club", "Solar Kilowatt Club", "Generate 1,000 kWh of solar energy", "solar", "sun",
        total_solar >= 1000, f"{total_solar:,.0f} kWh generated" if total_solar >= 1000 else "", solar_1000_date,
    ))
    achievements.append(_achievement(
        "solar_megawatt", "Solar Megawatt", "Generate 10,000 kWh of solar energy", "solar", "sun",
        total_solar >= 10000, f"{total_solar:,.0f} kWh generated" if total_solar >= 10000 else "", solar_10000_date,
    ))
    achievements.append(_achievement(
        "solar_streak_7", "Solar Streak", "7 consecutive days of solar generation", "solar", "sun",
        solar_streak >= 7, f"{solar_streak} day streak" if solar_streak >= 7 else "", streak_7_date,
    ))

    # --- Battery Achievements ---

    achievements.append(_achievement(
        "first_cycle", "First Cycle", "Complete your first full battery cycle", "battery", "battery",
        total_cycles >= 1, f"{total_cycles:.1f} cycles" if total_cycles >= 1 else "", cycle_1_date,
    ))
    achievements.append(_achievement(
        "century_cycles", "Century Cycles", "Complete 100 battery cycles", "battery", "battery",
        total_cycles >= 100, f"{total_cycles:.0f} cycles" if total_cycles >= 100 else "", cycle_100_date,
    ))

    # --- Grid Independence ---

    achievements.append(_achievement(
        "self_powered_day", "Self-Powered Day", "Go an entire day with zero grid imports", "grid", "shield",
        self_powered_days >= 1, f"{self_powered_days} day{'s' if self_powered_days != 1 else ''}" if self_powered_days >= 1 else "", first_self_powered_date,
    ))
    achievements.append(_achievement(
        "island_survivor", "Island Survivor", "Survive a grid outage on battery backup", "grid", "shield",
        islanded_count > 0, "Grid outage survived" if islanded_count > 0 else "",
    ))
    achievements.append(_achievement(
        "net_zero_day", "Net Zero Day", "Export more than you import in a single day", "grid", "zap",
        net_zero_days >= 1, f"{net_zero_days} net-zero day{'s' if net_zero_days != 1 else ''}" if net_zero_days >= 1 else "", first_net_zero_date,
    ))
    achievements.append(_achievement(
        "export_champion", "Export Champion", "Export 1,000 kWh to the grid", "grid", "zap",
        total_exported >= 1000, f"{total_exported:,.0f} kWh exported" if total_exported >= 1000 else "", export_1000_date,
    ))

    # --- Financial ---

    achievements.append(_achievement(
        "first_dollar", "First Dollar", "Earn your first dollar in energy savings", "financial", "dollar",
        total_savings >= 1, f"${total_savings:.2f} saved" if total_savings >= 1 else "", savings_1_date,
    ))
    achievements.append(_achievement(
        "hundred_club", "Hundred Club", "Save $100 in energy costs", "financial", "dollar",
        total_savings >= 100, f"${total_savings:,.0f} saved" if total_savings >= 100 else "", savings_100_date,
    ))
    achievements.append(_achievement(
        "thousand_club", "Thousand Club", "Save $1,000 in energy costs", "financial", "dollar",
        total_savings >= 1000, f"${total_savings:,.0f} saved" if total_savings >= 1000 else "", savings_1000_date,
    ))

    # --- EV / Vehicle ---

    achievements.append(_achievement(
        "sun_driver", "Sun Driver", "Charge your first mile from solar energy", "ev", "car",
        solar_miles_total >= 1, f"{solar_miles_total:.0f} solar miles" if solar_miles_total >= 1 else "",
    ))
    achievements.append(_achievement(
        "solar_road_trip", "Solar Road Trip", "Charge 100 miles from solar energy", "ev", "car",
        solar_miles_total >= 100, f"{solar_miles_total:.0f} solar miles" if solar_miles_total >= 100 else "",
    ))
    achievements.append(_achievement(
        "solar_century_drive", "Solar Century Drive", "Charge 1,000 miles from solar energy", "ev", "car",
        solar_miles_total >= 1000, f"{solar_miles_total:,.0f} solar miles" if solar_miles_total >= 1000 else "",
    ))

    # --- System ---

    achievements.append(_achievement(
        "fully_loaded", "Fully Loaded", "Configure all components: Powerwall, Solar, Vehicle, and Location", "system", "settings",
        fully_configured, "All systems configured" if fully_configured else "",
    ))
    achievements.append(_achievement(
        "week_warrior", "Week Warrior", "Run GridMind for 7 consecutive days", "system", "clock",
        days_running >= 7, f"{days_running} days tracked" if days_running >= 7 else "", day_7_date,
    ))
    achievements.append(_achievement(
        "month_monitor", "Month Monitor", "Run GridMind for 30 consecutive days", "system", "clock",
        days_running >= 30, f"{days_running} days tracked" if days_running >= 30 else "", day_30_date,
    ))

    earned_count = sum(1 for a in achievements if a["earned"])

    return {
        "achievements": achievements,
        "earned_count": earned_count,
        "total_count": len(achievements),
    }
