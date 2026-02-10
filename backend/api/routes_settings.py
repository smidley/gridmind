"""API routes for app settings and Powerwall control."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db, AppSettings, TOURateSchedule
from tesla.client import tesla_client, TeslaAPIError
from tesla.commands import (
    set_operation_mode,
    set_backup_reserve,
    set_storm_mode,
    set_grid_import_export,
)
from services import setup_store
from services.geocoding import geocode_address

router = APIRouter(prefix="/api/settings", tags=["settings"])


# --- Setup / First-Run Configuration ---


class SetupStatusResponse(BaseModel):
    setup_complete: bool
    has_credentials: bool
    has_location: bool
    authenticated: bool


class TeslaCredentialsRequest(BaseModel):
    client_id: str
    client_secret: str
    redirect_uri: str = "http://localhost:8080/auth/callback"


class LocationAddressRequest(BaseModel):
    address: str


class LocationCoordsRequest(BaseModel):
    latitude: float
    longitude: float
    timezone: str = ""
    address: str = ""


@router.get("/setup/status")
async def setup_status():
    """Check if first-run setup has been completed."""
    return SetupStatusResponse(
        setup_complete=setup_store.is_setup_complete(),
        has_credentials=bool(setup_store.get_tesla_client_id()),
        has_location=setup_store.is_location_configured(),
        authenticated=tesla_client.is_authenticated,
    ).model_dump()


@router.get("/setup")
async def get_setup():
    """Get current setup configuration (secrets masked)."""
    data = setup_store.get_all()
    return data


@router.post("/setup/credentials")
async def save_credentials(req: TeslaCredentialsRequest):
    """Save Tesla Fleet API credentials."""
    if not req.client_id.strip() or not req.client_secret.strip():
        raise HTTPException(status_code=400, detail="Client ID and Secret are required.")

    setup_store.update({
        "tesla_client_id": req.client_id.strip(),
        "tesla_client_secret": req.client_secret.strip(),
        "tesla_redirect_uri": req.redirect_uri.strip(),
    })

    return {
        "success": True,
        "message": "Tesla credentials saved. You can now connect your Tesla account.",
        "auth_url": tesla_client.get_auth_url(),
    }


@router.post("/setup/location/geocode")
async def geocode_location(req: LocationAddressRequest):
    """Look up coordinates from an address."""
    if not req.address.strip():
        raise HTTPException(status_code=400, detail="Address is required.")

    result = await geocode_address(req.address.strip())
    if not result:
        raise HTTPException(status_code=404, detail="Could not find that address. Try being more specific.")

    return result


@router.post("/setup/location")
async def save_location(req: LocationCoordsRequest):
    """Save location coordinates (typically after geocoding)."""
    if req.latitude == 0 and req.longitude == 0:
        raise HTTPException(status_code=400, detail="Invalid coordinates.")

    data = {
        "latitude": req.latitude,
        "longitude": req.longitude,
    }
    if req.timezone:
        data["timezone"] = req.timezone
    if req.address:
        data["address"] = req.address

    setup_store.update(data)

    return {
        "success": True,
        "latitude": req.latitude,
        "longitude": req.longitude,
        "timezone": req.timezone or setup_store.get_timezone(),
    }


# --- Powerwall Control ---


class ModeRequest(BaseModel):
    mode: str  # "self_consumption" | "autonomous"


class ReserveRequest(BaseModel):
    reserve_percent: float


class StormModeRequest(BaseModel):
    enabled: bool


class GridChargingRequest(BaseModel):
    enabled: bool


class ExportRuleRequest(BaseModel):
    rule: str  # "pv_only" | "battery_ok" | "never"


@router.post("/powerwall/mode")
async def control_mode(req: ModeRequest):
    """Set the Powerwall operation mode."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        result = await set_operation_mode(req.mode)
        return {"success": True, "mode": req.mode}
    except (TeslaAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/powerwall/reserve")
async def control_reserve(req: ReserveRequest):
    """Set the backup reserve percentage."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        result = await set_backup_reserve(req.reserve_percent)
        return {"success": True, "reserve_percent": req.reserve_percent}
    except TeslaAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/powerwall/storm-mode")
async def control_storm_mode(req: StormModeRequest):
    """Enable or disable storm mode."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        result = await set_storm_mode(req.enabled)
        return {"success": True, "storm_mode": req.enabled}
    except TeslaAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/powerwall/grid-charging")
async def control_grid_charging(req: GridChargingRequest):
    """Enable or disable grid charging."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        result = await set_grid_import_export(
            disallow_charge_from_grid_with_solar_installed=not req.enabled
        )
        return {"success": True, "grid_charging": req.enabled}
    except TeslaAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/powerwall/export-rule")
async def control_export_rule(req: ExportRuleRequest):
    """Set the energy export rule."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        result = await set_grid_import_export(customer_preferred_export_rule=req.rule)
        return {"success": True, "export_rule": req.rule}
    except (TeslaAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- TOU Rate Schedule ---


class TOURateCreate(BaseModel):
    name: str
    rate_cents: float
    start_time: str  # "HH:MM"
    end_time: str  # "HH:MM"
    days: list[str]  # ["mon", "tue", ...]
    season: Optional[str] = None


@router.get("/tou-rates")
async def list_tou_rates(db: AsyncSession = Depends(get_db)):
    """List all TOU rate schedule entries."""
    result = await db.execute(
        select(TOURateSchedule).order_by(TOURateSchedule.start_time)
    )
    rates = result.scalars().all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "rate_cents": r.rate_cents,
            "start_time": r.start_time,
            "end_time": r.end_time,
            "days": r.days,
            "season": r.season,
        }
        for r in rates
    ]


@router.post("/tou-rates", status_code=201)
async def create_tou_rate(data: TOURateCreate, db: AsyncSession = Depends(get_db)):
    """Create a TOU rate schedule entry."""
    rate = TOURateSchedule(
        name=data.name,
        rate_cents=data.rate_cents,
        start_time=data.start_time,
        end_time=data.end_time,
        days=data.days,
        season=data.season,
    )
    db.add(rate)
    await db.commit()
    await db.refresh(rate)
    return {"id": rate.id, "name": rate.name}


@router.delete("/tou-rates/{rate_id}")
async def delete_tou_rate(rate_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a TOU rate entry."""
    rate = await db.get(TOURateSchedule, rate_id)
    if not rate:
        raise HTTPException(status_code=404, detail="Rate not found")
    await db.delete(rate)
    await db.commit()
    return {"deleted": True}


# --- App Settings Key-Value ---


class AppSettingUpdate(BaseModel):
    value: str


@router.get("/app")
async def get_app_settings(db: AsyncSession = Depends(get_db)):
    """Get all app settings."""
    result = await db.execute(select(AppSettings))
    rows = result.scalars().all()
    return {row.key: row.value for row in rows}


@router.put("/app/{key}")
async def set_app_setting(key: str, data: AppSettingUpdate, db: AsyncSession = Depends(get_db)):
    """Set an app setting value."""
    existing = await db.get(AppSettings, key)
    if existing:
        existing.value = data.value
    else:
        setting = AppSettings(key=key, value=data.value)
        db.add(setting)
    await db.commit()
    return {"key": key, "value": data.value}
