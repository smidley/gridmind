"""Pytest configuration and shared fixtures for GridMind tests."""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

# Add backend to path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


@pytest.fixture
def mock_setup_store():
    """Mock setup_store for tests."""
    store_data = {
        "timezone": "America/Los_Angeles",
        "gridmind_optimize_enabled": False,
        "gridmind_optimize_peak_start": 17,
        "gridmind_optimize_peak_end": 21,
        "gridmind_optimize_buffer": 15,
    }
    
    mock = MagicMock()
    mock.get = lambda key, default=None: store_data.get(key, default)
    mock.set = lambda key, value: store_data.update({key: value})
    mock.get_timezone = lambda: store_data.get("timezone", "America/Los_Angeles")
    
    return mock


@pytest.fixture
def mock_powerwall_status():
    """Mock Powerwall status data."""
    return {
        "battery_soc": 85.0,
        "battery_power": 0,
        "grid_power": 500,
        "home_power": 1500,
        "solar_power": 2000,
        "grid_status": "SystemGridConnected",
    }


@pytest.fixture
def mock_solar_forecast_entries():
    """Mock solar forecast entries for testing."""
    from datetime import date
    today = date.today().strftime("%Y-%m-%d")
    
    # Simulate hourly forecast from 9am to 5pm
    entries = []
    for hour in range(9, 17):
        # Bell curve-ish production: peak at noon
        if hour < 12:
            watts = 1000 + (hour - 9) * 800
        else:
            watts = 3400 - (hour - 12) * 600
        
        entry = MagicMock()
        entry.date = today
        entry.hour = hour
        entry.estimated_generation_w = watts
        entries.append(entry)
    
    return entries


@pytest.fixture
def mock_energy_readings():
    """Mock energy readings for home load calculation."""
    readings = []
    for i in range(24):  # 24 readings over 2 hours (5 min intervals)
        reading = MagicMock()
        reading.timestamp = datetime.utcnow() - timedelta(minutes=5*i)
        reading.home_power = 1200 + (i % 5) * 100  # 1200-1600W variation
        readings.append(reading)
    return readings


@pytest.fixture
def mock_tesla_commands():
    """Mock Tesla API commands."""
    mock = MagicMock()
    mock.set_backup_reserve = AsyncMock(return_value={"success": True})
    mock.set_operation_mode = AsyncMock(return_value={"success": True})
    mock.get_site_config = AsyncMock(return_value={
        "operation_mode": "autonomous",
        "backup_reserve_percent": 20,
        "total_capacity_kwh": 27.0,
    })
    return mock


@pytest.fixture
def mock_tariff_data():
    """Mock Tesla tariff data for TOU period detection."""
    return {
        "tariff": {
            "name": "Tesla Tariff",
            "utility": "PG&E",
            "periods": {
                "ON_PEAK": {"start": 17, "end": 21},
                "PARTIAL_PEAK": {"start": 7, "end": 17},
                "OFF_PEAK": {"start": 21, "end": 7},
            }
        },
        "tou_periods": [
            {"tou_period_type": "OFF_PEAK", "start_hour": 0, "end_hour": 7},
            {"tou_period_type": "PARTIAL_PEAK", "start_hour": 7, "end_hour": 17},
            {"tou_period_type": "ON_PEAK", "start_hour": 17, "end_hour": 21},
            {"tou_period_type": "OFF_PEAK", "start_hour": 21, "end_hour": 24},
        ]
    }

