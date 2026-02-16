"""Validated Pydantic models for API requests with input validation."""

from typing import Literal
from pydantic import BaseModel, Field, field_validator


class ModeRequest(BaseModel):
    """Request to set Powerwall operation mode."""
    mode: Literal["self_consumption", "autonomous"] = Field(
        ...,
        description="Operation mode: 'self_consumption' for solar-first, 'autonomous' for time-based control"
    )


class ReserveRequest(BaseModel):
    """Request to set backup reserve percentage."""
    reserve_percent: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Backup reserve percentage (0-100)"
    )


class StormModeRequest(BaseModel):
    """Request to enable/disable storm mode."""
    enabled: bool = Field(
        ...,
        description="Whether to enable storm mode"
    )


class GridChargingRequest(BaseModel):
    """Request to enable/disable grid charging."""
    enabled: bool = Field(
        ...,
        description="Whether to allow charging from grid"
    )


class ExportRuleRequest(BaseModel):
    """Request to set grid export rule."""
    rule: Literal["pv_only", "battery_ok", "never"] = Field(
        ...,
        description="Export rule: 'pv_only' (solar only), 'battery_ok' (solar + battery), 'never' (no export)"
    )


class ChargeLimitRequest(BaseModel):
    """Request to set vehicle charge limit."""
    percent: int = Field(
        ...,
        ge=50,
        le=100,
        description="Charge limit percentage (50-100)"
    )


class ChargingAmpsRequest(BaseModel):
    """Request to set vehicle charging amperage."""
    amps: int = Field(
        ...,
        ge=1,
        le=48,
        description="Charging current in amps (1-48)"
    )
    
    @field_validator("amps")
    @classmethod
    def validate_amps(cls, v: int) -> int:
        """Validate charging amps are within safe range."""
        if v < 1:
            raise ValueError("Charging amps must be at least 1")
        if v > 48:
            raise ValueError("Charging amps cannot exceed 48 (typical max for home charging)")
        return v


class OffGridRequest(BaseModel):
    """Request to enable/disable off-grid mode."""
    enabled: bool = Field(
        ...,
        description="Whether to enable simulated off-grid mode"
    )


class ScheduledChargingRequest(BaseModel):
    """Request to configure scheduled charging."""
    enable: bool = Field(
        ...,
        description="Whether to enable scheduled charging"
    )
    time_minutes: int | None = Field(
        None,
        ge=0,
        le=1439,
        description="Minutes after midnight for charge start (0-1439)"
    )

