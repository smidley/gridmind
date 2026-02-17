"""Database optimization utilities.

Provides functions to add indexes and optimize query performance.
Run these after database creation or during maintenance windows.
"""

import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session

logger = logging.getLogger(__name__)

# Composite indexes to improve query performance
INDEXES_TO_CREATE = [
    # EnergyReading: timestamp + battery_soc for SOC history queries
    {
        "name": "ix_energy_readings_timestamp_soc",
        "table": "energy_readings",
        "columns": ["timestamp", "battery_soc"],
    },
    # EnergyReading: timestamp + solar_power for solar production queries
    {
        "name": "ix_energy_readings_timestamp_solar",
        "table": "energy_readings",
        "columns": ["timestamp", "solar_power"],
    },
    # EnergyReading: timestamp + grid_power for grid import/export queries
    {
        "name": "ix_energy_readings_timestamp_grid",
        "table": "energy_readings",
        "columns": ["timestamp", "grid_power"],
    },
    # VehicleReading: vehicle_id + timestamp for per-vehicle history
    {
        "name": "ix_vehicle_readings_vehicle_timestamp",
        "table": "vehicle_readings",
        "columns": ["vehicle_id", "timestamp"],
    },
    # VehicleReading: timestamp + battery_level for charge history
    {
        "name": "ix_vehicle_readings_timestamp_battery",
        "table": "vehicle_readings",
        "columns": ["timestamp", "battery_level"],
    },
    # DailyEnergySummary: date for range queries (already has unique index)
    # AutomationRule: enabled + priority for rule evaluation
    {
        "name": "ix_automation_rules_enabled_priority",
        "table": "automation_rules",
        "columns": ["enabled", "priority"],
    },
]


async def create_indexes() -> dict:
    """Create composite indexes for improved query performance.
    
    Returns dict with created/skipped/failed counts.
    """
    results = {"created": [], "skipped": [], "failed": []}
    
    async with async_session() as session:
        for idx in INDEXES_TO_CREATE:
            try:
                # Check if index already exists
                check_sql = text(f"""
                    SELECT name FROM sqlite_master 
                    WHERE type='index' AND name='{idx["name"]}'
                """)
                result = await session.execute(check_sql)
                exists = result.scalar() is not None
                
                if exists:
                    results["skipped"].append(idx["name"])
                    logger.debug("Index already exists: %s", idx["name"])
                    continue
                
                # Create the index
                columns = ", ".join(idx["columns"])
                create_sql = text(f"""
                    CREATE INDEX {idx["name"]} 
                    ON {idx["table"]} ({columns})
                """)
                await session.execute(create_sql)
                await session.commit()
                
                results["created"].append(idx["name"])
                logger.info("Created index: %s on %s(%s)", 
                           idx["name"], idx["table"], columns)
                
            except Exception as e:
                results["failed"].append({"name": idx["name"], "error": str(e)})
                logger.error("Failed to create index %s: %s", idx["name"], e)
    
    return results


async def analyze_tables() -> dict:
    """Run ANALYZE on tables to update query planner statistics.
    
    SQLite uses these statistics to choose optimal query plans.
    """
    tables = [
        "energy_readings",
        "daily_energy_summary",
        "vehicle_readings",
        "automation_rules",
        "rule_execution_log",
        "solar_forecast",
    ]
    
    results = {"analyzed": [], "failed": []}
    
    async with async_session() as session:
        for table in tables:
            try:
                await session.execute(text(f"ANALYZE {table}"))
                results["analyzed"].append(table)
                logger.info("Analyzed table: %s", table)
            except Exception as e:
                results["failed"].append({"table": table, "error": str(e)})
                logger.warning("Failed to analyze %s: %s", table, e)
        
        await session.commit()
    
    return results


async def get_table_stats() -> dict:
    """Get row counts and size estimates for all tables."""
    tables = [
        "energy_readings",
        "daily_energy_summary",
        "vehicle_readings",
        "automation_rules",
        "rule_execution_log",
        "solar_forecast",
    ]
    
    stats = {}
    
    async with async_session() as session:
        for table in tables:
            try:
                result = await session.execute(
                    text(f"SELECT COUNT(*) FROM {table}")
                )
                count = result.scalar()
                stats[table] = {"row_count": count}
            except Exception as e:
                stats[table] = {"error": str(e)}
    
    return stats


async def vacuum_database() -> bool:
    """Run VACUUM to reclaim space and defragment the database.
    
    Note: This can take a while for large databases.
    """
    try:
        async with async_session() as session:
            await session.execute(text("VACUUM"))
            await session.commit()
        logger.info("Database vacuumed successfully")
        return True
    except Exception as e:
        logger.error("Failed to vacuum database: %s", e)
        return False

