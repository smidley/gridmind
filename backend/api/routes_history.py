"""API routes for historical energy data and charts."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, EnergyReading, DailyEnergySummary
from services.weather import get_forecast_summary
from tesla.client import tesla_client, TeslaAPIError
from tesla.commands import get_energy_history

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("/readings")
async def get_readings(
    hours: int = Query(default=24, ge=1, le=168),
    resolution: int = Query(default=1, ge=1, le=60, description="Minutes between samples"),
    db: AsyncSession = Depends(get_db),
):
    """Get energy readings for the specified time window.

    Args:
        hours: Number of hours to look back (1-168, default 24)
        resolution: Resolution in minutes (1-60, default 1 = every reading)
    """
    since = datetime.utcnow() - timedelta(hours=hours)

    result = await db.execute(
        select(EnergyReading)
        .where(EnergyReading.timestamp >= since)
        .order_by(EnergyReading.timestamp)
    )
    readings = result.scalars().all()

    # Downsample if resolution > 1 minute
    if resolution > 1 and readings:
        sampled = []
        last_time = None
        for r in readings:
            if last_time is None or (r.timestamp - last_time).total_seconds() >= resolution * 60:
                sampled.append(r)
                last_time = r.timestamp
        readings = sampled

    return {
        "count": len(readings),
        "readings": [
            {
                "timestamp": r.timestamp.isoformat(),
                "battery_soc": r.battery_soc,
                "battery_power": r.battery_power,
                "solar_power": r.solar_power,
                "grid_power": r.grid_power,
                "home_power": r.home_power,
                "grid_status": r.grid_status,
            }
            for r in readings
        ],
    }


@router.get("/daily")
async def get_daily_summary(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Get daily energy summaries."""
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    result = await db.execute(
        select(DailyEnergySummary)
        .where(DailyEnergySummary.date >= since)
        .order_by(DailyEnergySummary.date)
    )
    summaries = result.scalars().all()

    return {
        "count": len(summaries),
        "summaries": [
            {
                "date": s.date,
                "solar_generated_kwh": s.solar_generated_kwh,
                "grid_imported_kwh": s.grid_imported_kwh,
                "grid_exported_kwh": s.grid_exported_kwh,
                "home_consumed_kwh": s.home_consumed_kwh,
                "battery_charged_kwh": s.battery_charged_kwh,
                "battery_discharged_kwh": s.battery_discharged_kwh,
            }
            for s in summaries
        ],
    }


@router.get("/today")
async def get_today_totals():
    """Get today's energy totals from the Powerwall via Tesla's energy history API.

    This returns actual data from the Powerwall covering the full day from midnight,
    regardless of when GridMind started collecting.
    """
    if not tesla_client.is_authenticated:
        return {
            "solar_generated_kwh": 0,
            "grid_imported_kwh": 0,
            "grid_exported_kwh": 0,
            "home_consumed_kwh": 0,
            "battery_charged_kwh": 0,
            "battery_discharged_kwh": 0,
            "source": "none",
        }

    try:
        data = await get_energy_history(period="day", kind="energy")
        time_series = data.get("time_series", [])

        # Sum up all intervals for today
        solar_kwh = 0.0
        grid_import_kwh = 0.0
        grid_export_kwh = 0.0
        home_kwh = 0.0
        battery_charged_kwh = 0.0
        battery_discharged_kwh = 0.0

        for entry in time_series:
            solar_kwh += max(entry.get("solar_energy_exported", 0), 0) / 1000
            home_kwh += max(entry.get("consumer_energy_imported_from_grid", 0) +
                          entry.get("consumer_energy_imported_from_solar", 0) +
                          entry.get("consumer_energy_imported_from_battery", 0), 0) / 1000

            grid_from = entry.get("grid_energy_imported", 0)
            grid_to = entry.get("grid_energy_exported_from_solar", 0) + entry.get("grid_energy_exported_from_battery", 0)
            grid_import_kwh += max(grid_from, 0) / 1000
            grid_export_kwh += max(grid_to, 0) / 1000

            battery_charged_kwh += max(entry.get("battery_energy_imported_from_grid", 0) +
                                      entry.get("battery_energy_imported_from_solar", 0), 0) / 1000
            battery_discharged_kwh += max(entry.get("battery_energy_exported", 0), 0) / 1000

        return {
            "solar_generated_kwh": round(solar_kwh, 2),
            "grid_imported_kwh": round(grid_import_kwh, 2),
            "grid_exported_kwh": round(grid_export_kwh, 2),
            "home_consumed_kwh": round(home_kwh, 2),
            "battery_charged_kwh": round(battery_charged_kwh, 2),
            "battery_discharged_kwh": round(battery_discharged_kwh, 2),
            "source": "tesla",
        }
    except TeslaAPIError as e:
        # Fallback to local readings if Tesla API fails
        return await _compute_today_from_readings()
    except Exception as e:
        return await _compute_today_from_readings()


async def _compute_today_from_readings():
    """Fallback: compute today's totals from local readings."""
    from datetime import date
    from database import async_session

    start_of_day = datetime.combine(date.today(), datetime.min.time())

    async with async_session() as session:
        result = await session.execute(
            select(EnergyReading)
            .where(EnergyReading.timestamp >= start_of_day)
            .order_by(EnergyReading.timestamp)
        )
        readings = result.scalars().all()

    if not readings:
        return {
            "solar_generated_kwh": 0,
            "grid_imported_kwh": 0,
            "grid_exported_kwh": 0,
            "home_consumed_kwh": 0,
            "battery_charged_kwh": 0,
            "battery_discharged_kwh": 0,
            "source": "local",
        }

    total_seconds = (readings[-1].timestamp - readings[0].timestamp).total_seconds() if len(readings) > 1 else 30
    avg_interval_hours = (total_seconds / max(len(readings) - 1, 1)) / 3600

    return {
        "solar_generated_kwh": round(sum(max(r.solar_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "grid_imported_kwh": round(sum(max(r.grid_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "grid_exported_kwh": round(sum(abs(min(r.grid_power or 0, 0)) for r in readings) * avg_interval_hours / 1000, 2),
        "home_consumed_kwh": round(sum(max(r.home_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "battery_charged_kwh": round(sum(max(r.battery_power or 0, 0) for r in readings) * avg_interval_hours / 1000, 2),
        "battery_discharged_kwh": round(sum(abs(min(r.battery_power or 0, 0)) for r in readings) * avg_interval_hours / 1000, 2),
        "source": "local",
    }


@router.get("/forecast")
async def solar_forecast():
    """Get solar generation forecast for today and tomorrow."""
    return await get_forecast_summary()
