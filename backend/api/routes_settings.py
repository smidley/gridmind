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


class SolarCapacityRequest(BaseModel):
    capacity_kw: float  # Total panel capacity in kW


@router.post("/setup/solar-capacity")
async def save_solar_capacity(req: SolarCapacityRequest):
    """Save the solar panel system capacity for forecast calibration."""
    if req.capacity_kw <= 0:
        raise HTTPException(status_code=400, detail="Capacity must be greater than 0.")
    setup_store.set("solar_capacity_kw", req.capacity_kw)
    return {"success": True, "solar_capacity_kw": req.capacity_kw}


@router.post("/setup/generate-keys")
async def generate_keys():
    """Generate an EC key pair for Tesla Fleet API registration.

    The public key must be hosted at a publicly accessible URL.
    The private key is stored locally in the GridMind data directory.
    """
    import subprocess
    import os

    data_dir = settings.data_dir
    private_key_path = os.path.join(data_dir, "private-key.pem")
    public_key_path = os.path.join(data_dir, "public-key.pem")

    # Check if keys already exist
    if os.path.exists(private_key_path) and os.path.exists(public_key_path):
        with open(public_key_path, "r") as f:
            public_key = f.read()
        return {
            "exists": True,
            "public_key": public_key,
            "message": "Keys already exist. Public key shown below.",
        }

    # Generate new key pair
    try:
        os.makedirs(data_dir, exist_ok=True)

        # Generate private key
        subprocess.run(
            ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", private_key_path],
            check=True, capture_output=True,
        )

        # Extract public key
        subprocess.run(
            ["openssl", "ec", "-in", private_key_path, "-pubout", "-out", public_key_path],
            check=True, capture_output=True,
        )

        with open(public_key_path, "r") as f:
            public_key = f.read()

        return {
            "exists": False,
            "public_key": public_key,
            "message": "Key pair generated! Host the public key below at your domain.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Key generation failed: {e}")


@router.get("/setup/public-key")
async def get_public_key():
    """Get the generated public key content."""
    import os

    public_key_path = os.path.join(settings.data_dir, "public-key.pem")
    if not os.path.exists(public_key_path):
        raise HTTPException(status_code=404, detail="No public key found. Generate keys first.")

    with open(public_key_path, "r") as f:
        return {"public_key": f.read()}


class RegisterRequest(BaseModel):
    domain: str  # e.g., "smidley.github.io"


@router.post("/setup/register")
async def register_fleet_api(req: RegisterRequest):
    """Register the app with Tesla's Fleet API regional endpoint.

    This is a one-time step required before making API calls.
    The domain must be an internet-accessible domain that hosts your
    public key at /.well-known/appspecific/com.tesla.3p.public-key.pem
    """
    import httpx
    from config import settings as app_settings

    client_id = setup_store.get_tesla_client_id()
    client_secret = setup_store.get_tesla_client_secret()
    domain = req.domain.strip().lower()

    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Tesla credentials not configured.")
    if not domain:
        raise HTTPException(status_code=400, detail="Domain is required.")

    # Remove protocol prefix if user included it
    domain = domain.replace("https://", "").replace("http://", "").rstrip("/")

    # Save the domain for reference
    setup_store.set("fleet_api_domain", domain)

    # Step 1: Get a partner token via client credentials grant
    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                f"{app_settings.tesla_auth_url}/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": "openid energy_device_data energy_cmds",
                    "audience": app_settings.tesla_api_base_url,
                },
            )

        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to get partner token: {token_resp.text}",
            )

        partner_token = token_resp.json().get("access_token")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Partner token request failed: {e}")

    # Step 2: Register with the regional Fleet API endpoint
    try:
        async with httpx.AsyncClient() as client:
            register_resp = await client.post(
                f"{app_settings.tesla_api_base_url}/api/1/partner_accounts",
                headers={
                    "Authorization": f"Bearer {partner_token}",
                    "Content-Type": "application/json",
                },
                json={"domain": domain},
            )

        if register_resp.status_code >= 400:
            detail = register_resp.text
            # 409 means already registered, which is fine
            if register_resp.status_code == 409:
                return {"success": True, "message": "App is already registered with Tesla Fleet API."}
            raise HTTPException(
                status_code=400,
                detail=f"Registration failed ({register_resp.status_code}): {detail}",
            )

        return {"success": True, "message": "Successfully registered with Tesla Fleet API!"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration request failed: {e}")


@router.post("/setup/discover-site")
async def discover_site():
    """Manually trigger energy site auto-discovery."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla.")

    try:
        site_id = await tesla_client.auto_discover_site()
        return {"success": True, "energy_site_id": site_id}
    except TeslaAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
