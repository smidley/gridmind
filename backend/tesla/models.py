"""Pydantic models for Tesla Powerwall data."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


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
