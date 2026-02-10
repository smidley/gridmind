"""Periodic data collector - polls Powerwall status and stores in database."""

import logging
from datetime import datetime, date

from sqlalchemy import select, func

from database import async_session, EnergyReading, DailyEnergySummary
from tesla.client import tesla_client, TeslaAuthError, TeslaAPIError
from tesla.commands import get_live_status
from tesla.models import PowerwallStatus

logger = logging.getLogger(__name__)

# In-memory cache for latest reading (used by WebSocket + dashboard)
_latest_status: PowerwallStatus | None = None
_status_listeners: list = []  # Callbacks for real-time updates


def get_latest_status() -> PowerwallStatus | None:
    """Get the most recent cached Powerwall status."""
    return _latest_status


def register_status_listener(callback):
    """Register a callback for real-time status updates."""
    _status_listeners.append(callback)


def unregister_status_listener(callback):
    """Remove a status update callback."""
    if callback in _status_listeners:
        _status_listeners.remove(callback)


async def collect_data():
    """Poll the Powerwall and store a reading. Called by the scheduler."""
    global _latest_status

    if not tesla_client.is_authenticated:
        logger.debug("Skipping data collection - not authenticated")
        return

    try:
        status = await get_live_status()
        _latest_status = status

        # Store in database
        async with async_session() as session:
            reading = EnergyReading(
                timestamp=status.timestamp,
                battery_soc=status.battery_soc,
                battery_power=status.battery_power,
                solar_power=status.solar_power,
                grid_power=status.grid_power,
                grid_status=status.grid_status,
                home_power=status.home_power,
                operation_mode=status.operation_mode,
                backup_reserve=status.backup_reserve,
                storm_mode=status.storm_mode,
            )
            session.add(reading)
            await session.commit()

        # Notify WebSocket listeners
        for listener in _status_listeners:
            try:
                await listener(status)
            except Exception as e:
                logger.warning("Status listener error: %s", e)

        logger.debug(
            "Collected: SOC=%.1f%% Solar=%.0fW Grid=%.0fW Home=%.0fW Battery=%.0fW",
            status.battery_soc,
            status.solar_power,
            status.grid_power,
            status.home_power,
            status.battery_power,
        )

    except TeslaAuthError as e:
        logger.error("Auth error during data collection: %s", e)
    except TeslaAPIError as e:
        logger.error("API error during data collection: %s", e)
    except Exception as e:
        logger.exception("Unexpected error during data collection: %s", e)


async def update_daily_summary():
    """Update the daily energy summary from readings. Run once per hour."""
    today = date.today().isoformat()

    async with async_session() as session:
        # Get today's readings
        start_of_day = datetime.combine(date.today(), datetime.min.time())
        result = await session.execute(
            select(EnergyReading).where(EnergyReading.timestamp >= start_of_day)
        )
        readings = result.scalars().all()

        if not readings:
            return

        # Calculate aggregates (approximate energy from power readings)
        # Each reading is ~30s apart, so watts * (30/3600) = Wh per reading
        interval_hours = 30 / 3600  # 30 seconds in hours

        solar_kwh = sum(max(r.solar_power or 0, 0) * interval_hours for r in readings) / 1000
        grid_import_kwh = sum(max(r.grid_power or 0, 0) * interval_hours for r in readings) / 1000
        grid_export_kwh = sum(abs(min(r.grid_power or 0, 0)) * interval_hours for r in readings) / 1000
        home_kwh = sum(max(r.home_power or 0, 0) * interval_hours for r in readings) / 1000
        battery_charged_kwh = sum(max(r.battery_power or 0, 0) * interval_hours for r in readings) / 1000
        battery_discharged_kwh = sum(abs(min(r.battery_power or 0, 0)) * interval_hours for r in readings) / 1000

        # Upsert daily summary
        existing = await session.execute(
            select(DailyEnergySummary).where(DailyEnergySummary.date == today)
        )
        summary = existing.scalar_one_or_none()

        if summary:
            summary.solar_generated_kwh = round(solar_kwh, 3)
            summary.grid_imported_kwh = round(grid_import_kwh, 3)
            summary.grid_exported_kwh = round(grid_export_kwh, 3)
            summary.home_consumed_kwh = round(home_kwh, 3)
            summary.battery_charged_kwh = round(battery_charged_kwh, 3)
            summary.battery_discharged_kwh = round(battery_discharged_kwh, 3)
        else:
            summary = DailyEnergySummary(
                date=today,
                solar_generated_kwh=round(solar_kwh, 3),
                grid_imported_kwh=round(grid_import_kwh, 3),
                grid_exported_kwh=round(grid_export_kwh, 3),
                home_consumed_kwh=round(home_kwh, 3),
                battery_charged_kwh=round(battery_charged_kwh, 3),
                battery_discharged_kwh=round(battery_discharged_kwh, 3),
            )
            session.add(summary)

        await session.commit()
        logger.info("Updated daily summary for %s", today)
