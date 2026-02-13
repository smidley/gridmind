"""Pydantic models for Tesla Powerwall and Vehicle data."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# --- Powerwall Models ---


class PowerwallStatus(BaseModel):
    """Current Powerwall system status."""

    timestamp: datetime
    battery_soc: float  # State of charge 0-100
    battery_power: float  # Watts (+ = charging, - = discharging)
    solar_power: float  # Watts generated
    grid_power: float  # Watts (+ = importing, - = exporting)
    home_power: float  # Watts consumed
    grid_status: str  # "connected" | "islanded"
    operation_mode: str  # "self_consumption" | "autonomous"
    backup_reserve: float  # Reserve percentage
    storm_mode: bool


class EnergySite(BaseModel):
    """Energy site summary."""

    energy_site_id: str
    site_name: str
    battery_count: int
    resource_type: str


class SiteConfig(BaseModel):
    """Site configuration details."""

    operation_mode: str
    backup_reserve_percent: float
    storm_mode_enabled: bool
    default_real_mode: str


class AuthStatus(BaseModel):
    """Tesla authentication status."""

    authenticated: bool
    energy_site_id: Optional[str] = None
    site_name: Optional[str] = None
    auth_url: Optional[str] = None


class TokenExchangeRequest(BaseModel):
    """Request to exchange an OAuth authorization code."""

    code: str
    state: Optional[str] = None


class SetModeRequest(BaseModel):
    """Request to set Powerwall operation mode."""

    mode: str  # "self_consumption" | "autonomous"


class SetReserveRequest(BaseModel):
    """Request to set backup reserve percentage."""

    reserve_percent: float  # 0-100


class SetGridChargingRequest(BaseModel):
    """Request to enable/disable grid charging."""

    enabled: bool


class SetStormModeRequest(BaseModel):
    """Request to enable/disable storm mode."""

    enabled: bool


# --- Vehicle Models ---


class VehicleSummary(BaseModel):
    """Basic vehicle identification info."""

    id: str  # Tesla internal ID
    vehicle_id: str  # Vehicle ID
    display_name: str  # User-set name
    state: str  # "online", "asleep", "offline"
    vin: str


class ChargeState(BaseModel):
    """Vehicle charge state details."""

    battery_level: int  # SOC 0-100
    battery_range: float  # Rated range in miles
    charging_state: str  # "Disconnected", "Stopped", "Charging", "Complete", "NoPower"
    charge_limit_soc: int  # Target charge limit %
    charge_rate: float  # Charge speed in mph
    charger_power: float  # Charge power in kW
    charger_voltage: int  # Charger voltage
    charger_actual_current: int  # Actual charging amps
    time_to_full_charge: float  # Hours until full
    charge_energy_added: float  # kWh added this session
    charge_miles_added_rated: float  # Rated miles added
    scheduled_charging_mode: str = "Off"  # "Off", "StartAt", "DepartBy"
    scheduled_charging_start_time: Optional[int] = None  # Minutes after midnight
    conn_charge_cable: str = ""  # Cable type, e.g. "IEC" or "SAE"
    fast_charger_present: bool = False
    charge_current_request: int = 0  # Requested amps
    charge_current_request_max: int = 0  # Max available amps
    charger_phases: Optional[int] = None  # 1 or 3 phase
    off_peak_charging_enabled: bool = False  # TOU charging enabled
    off_peak_charging_times: str = ""  # "all_week", "weekdays", etc.
    off_peak_hours_end_time: int = 0  # Minutes after midnight
    preconditioning_enabled: bool = False


class VehicleStatus(BaseModel):
    """Full vehicle status combining summary and charge data."""

    timestamp: datetime
    vehicle: VehicleSummary
    charge_state: Optional[ChargeState] = None  # None when vehicle scopes not available
    odometer: Optional[float] = None  # Miles
    software_version: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    missing_scopes: bool = False  # True when vehicle_device_data scope not granted


# --- Vehicle Request Models ---


class ChargeLimitRequest(BaseModel):
    """Request to set charge limit percentage."""

    percent: int  # 50-100


class ChargingAmpsRequest(BaseModel):
    """Request to set charging amperage."""

    amps: int  # 1-48


class ScheduleConfigRequest(BaseModel):
    """Request to save EV smart charge schedule configuration."""

    strategy: str = "off"  # "off", "tou_aware", "solar_surplus", "departure"
    solar_surplus_threshold_kw: float = 1.5
    solar_surplus_min_soc: int = 20
    departure_time: str = "07:30"  # HH:MM
    departure_target_soc: int = 80
    battery_capacity_kwh: float = 75.0
    # Hybrid charge limits: charge from any source up to grid_limit,
    # then only charge from solar surplus up to solar_limit
    grid_charge_limit: int = 0    # 0 = disabled (use Tesla charge_limit_soc), 50-100
    solar_charge_limit: int = 0   # 0 = disabled, must be >= grid_charge_limit
