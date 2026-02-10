"""Database models and setup for GridMind."""

import datetime
from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    Boolean,
    DateTime,
    Text,
    JSON,
    create_engine,
)
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings


class Base(DeclarativeBase):
    pass


# --- Energy Data Models ---


class EnergyReading(Base):
    """Time-series energy readings from the Powerwall."""

    __tablename__ = "energy_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    # Battery
    battery_soc = Column(Float, nullable=True)  # State of charge (0-100)
    battery_power = Column(Float, nullable=True)  # Watts (+ = charging, - = discharging)

    # Solar
    solar_power = Column(Float, nullable=True)  # Watts generated

    # Grid
    grid_power = Column(Float, nullable=True)  # Watts (+ = importing, - = exporting)
    grid_status = Column(String(20), nullable=True)  # "connected", "islanded"

    # Home
    home_power = Column(Float, nullable=True)  # Watts consumed by home

    # Powerwall state
    operation_mode = Column(String(50), nullable=True)  # "self_consumption", "autonomous"
    backup_reserve = Column(Float, nullable=True)  # Reserve percentage
    storm_mode = Column(Boolean, nullable=True)


class DailyEnergySummary(Base):
    """Daily aggregated energy data."""

    __tablename__ = "daily_energy_summary"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(10), unique=True, index=True)  # YYYY-MM-DD

    solar_generated_kwh = Column(Float, default=0.0)
    grid_imported_kwh = Column(Float, default=0.0)
    grid_exported_kwh = Column(Float, default=0.0)
    home_consumed_kwh = Column(Float, default=0.0)
    battery_charged_kwh = Column(Float, default=0.0)
    battery_discharged_kwh = Column(Float, default=0.0)


# --- Automation Models ---


class AutomationRule(Base):
    """User-defined automation rules."""

    __tablename__ = "automation_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    priority = Column(Integer, default=0)  # Higher = higher priority
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Trigger configuration
    trigger_type = Column(String(50), nullable=False)
    # "time" | "soc" | "load" | "grid_status" | "solar_forecast"
    trigger_config = Column(JSON, nullable=False)
    # Examples:
    # time: {"time": "14:00", "days": ["mon","tue","wed","thu","fri"]}
    # soc: {"operator": "<=", "value": 20}
    # load: {"operator": ">=", "value": 5000}  # watts
    # grid_status: {"status": "islanded"}

    # Conditions (optional additional checks)
    conditions = Column(JSON, nullable=True)
    # e.g., [{"type": "soc", "operator": ">=", "value": 50}]

    # Actions to execute
    actions = Column(JSON, nullable=False)
    # e.g., [{"type": "set_mode", "value": "self_consumption"},
    #        {"type": "set_reserve", "value": 80},
    #        {"type": "notify", "message": "Switched to self-powered"}]

    # Execution tracking
    last_triggered = Column(DateTime, nullable=True)
    trigger_count = Column(Integer, default=0)
    one_shot = Column(Boolean, default=False)  # Auto-disable after first trigger


class TOURateSchedule(Base):
    """Time-of-use rate schedule entries."""

    __tablename__ = "tou_rate_schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)  # "Peak", "Off-Peak", "Shoulder"
    rate_cents = Column(Float, nullable=False)  # Cost in cents per kWh
    start_time = Column(String(5), nullable=False)  # "HH:MM"
    end_time = Column(String(5), nullable=False)  # "HH:MM"
    days = Column(JSON, nullable=False)  # ["mon","tue",...]
    season = Column(String(20), nullable=True)  # "summer", "winter", null = all


class SolarForecast(Base):
    """Cached solar generation forecasts."""

    __tablename__ = "solar_forecasts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(10), index=True)  # YYYY-MM-DD
    hour = Column(Integer)  # 0-23
    irradiance_wm2 = Column(Float)  # Solar irradiance W/m²
    estimated_generation_w = Column(Float)  # Estimated solar generation watts
    cloud_cover_pct = Column(Float)  # Cloud cover percentage
    fetched_at = Column(DateTime, default=datetime.datetime.utcnow)


class RuleExecutionLog(Base):
    """Log of automation rule executions."""

    __tablename__ = "rule_execution_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    rule_id = Column(Integer, nullable=False)
    rule_name = Column(String(200), nullable=False)
    trigger_type = Column(String(50), nullable=False)
    actions_executed = Column(JSON, nullable=False)
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)


class AppSettings(Base):
    """Key-value store for app configuration that persists across restarts."""

    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


# --- Database Engine ---

engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    """Get a database session."""
    async with async_session() as session:
        yield session
