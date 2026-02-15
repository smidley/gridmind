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


class SolarConfigRequest(BaseModel):
    capacity_kw: float              # Total DC panel capacity in kW
    tilt: float = 30                # Panel tilt (degrees from horizontal, 0=flat, 90=vertical)
    azimuth: float = 0              # Panel azimuth (0=South, -90=East, 90=West, 180=North)
    dc_ac_ratio: float = 1.2        # DC/AC ratio (panels to inverter)
    inverter_efficiency: float = 0.96  # Inverter efficiency (0-1)
    system_losses: float = 14       # Total system losses % (wiring, soiling, shading, etc.)


@router.post("/setup/solar")
async def save_solar_config(req: SolarConfigRequest):
    """Save solar panel system configuration for forecast calibration."""
    if req.capacity_kw <= 0:
        raise HTTPException(status_code=400, detail="Capacity must be greater than 0.")

    setup_store.update({
        "solar_capacity_kw": req.capacity_kw,
        "solar_tilt": req.tilt,
        "solar_azimuth": req.azimuth,
        "solar_dc_ac_ratio": req.dc_ac_ratio,
        "solar_inverter_efficiency": req.inverter_efficiency,
        "solar_system_losses": req.system_losses,
    })

    return {"success": True, "message": "Solar configuration saved."}


@router.get("/setup/solar")
async def get_solar_config():
    """Get current solar panel configuration."""
    return {
        "capacity_kw": float(setup_store.get("solar_capacity_kw") or 0),
        "tilt": float(setup_store.get("solar_tilt") or 30),
        "azimuth": float(setup_store.get("solar_azimuth") or 0),
        "dc_ac_ratio": float(setup_store.get("solar_dc_ac_ratio") or 1.2),
        "inverter_efficiency": float(setup_store.get("solar_inverter_efficiency") or 0.96),
        "system_losses": float(setup_store.get("solar_system_losses") or 14),
        "configured": bool(setup_store.get("solar_capacity_kw")),
    }


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


# --- GridMind Optimize Mode ---


class OptimizeRequest(BaseModel):
    enabled: bool
    peak_start: int = 17     # Hour (24h format)
    peak_end: int = 21       # Hour (24h format)
    buffer_minutes: int = 15  # Safety buffer before peak ends
    min_reserve: int = 5     # Don't dump below this %


@router.post("/optimize")
async def toggle_optimize(req: OptimizeRequest):
    """Enable or disable GridMind Optimize mode."""
    from automation.optimizer import enable, disable, get_state

    if req.enabled:
        from services.mode_manager import check_mode_conflict
        has_conflict, msg = check_mode_conflict("optimizer")
        if has_conflict:
            raise HTTPException(status_code=409, detail=msg)
        enable(
            peak_start=req.peak_start,
            peak_end=req.peak_end,
            buffer=req.buffer_minutes,
            min_reserve=req.min_reserve,
        )
        return {"success": True, "enabled": True, "message": "GridMind Optimize enabled", "state": get_state()}
    else:
        disable()
        return {"success": True, "enabled": False, "message": "GridMind Optimize disabled"}


@router.get("/optimize/status")
async def optimize_status():
    """Get the current GridMind Optimize status and calculations."""
    from automation.optimizer import get_state
    return get_state()


# --- Grid Mix / EIA Settings ---


@router.post("/grid-mix/config")
async def set_grid_mix_config(data: dict):
    """Configure EIA API key and optional balancing authority override.

    Body: {"eia_api_key": "...", "balancing_authority": "BPA"}
    """
    updates = {}
    if "eia_api_key" in data:
        updates["eia_api_key"] = data["eia_api_key"].strip()
    if "balancing_authority" in data:
        updates["grid_balancing_authority"] = data["balancing_authority"].strip().upper() if data["balancing_authority"] else ""
    if "clean_grid_enabled" in data:
        updates["gridmind_clean_grid_enabled"] = bool(data["clean_grid_enabled"])
    if "fossil_threshold_pct" in data:
        updates["gridmind_fossil_threshold_pct"] = max(10, min(90, int(data["fossil_threshold_pct"])))

    if updates:
        setup_store.update(updates)

    # Trigger immediate fetch if API key was just configured
    if "eia_api_key" in updates and updates["eia_api_key"]:
        try:
            from services.grid_mix import fetch_grid_mix
            result = await fetch_grid_mix()
            if result:
                return {"status": "ok", "updated": list(updates.keys()), "grid_mix": result}
        except Exception:
            pass

    return {"status": "ok", "updated": list(updates.keys())}


@router.get("/grid-mix/config")
async def get_grid_mix_config():
    """Get current grid mix configuration."""
    from services.grid_mix import get_balancing_authority
    detected_ba = get_balancing_authority()
    return {
        "eia_api_key_configured": bool(setup_store.get("eia_api_key")),
        "balancing_authority": setup_store.get("grid_balancing_authority", ""),
        "detected_balancing_authority": detected_ba or "",
        "clean_grid_enabled": bool(setup_store.get("gridmind_clean_grid_enabled")),
        "fossil_threshold_pct": int(setup_store.get("gridmind_fossil_threshold_pct") or 50),
    }


# --- Off-Grid Mode ---


class OffGridRequest(BaseModel):
    enabled: bool


@router.post("/offgrid")
async def toggle_off_grid(req: OffGridRequest):
    """Toggle simulated off-grid mode.

    When enabled: self-consumption mode, no grid charging, no grid export, reserve 0%.
    When disabled: restores to autonomous (time-based) mode with previous settings.
    """
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Check for conflicts
    if req.enabled:
        from services.mode_manager import check_mode_conflict
        has_conflict, msg = check_mode_conflict("offgrid")
        if has_conflict:
            raise HTTPException(status_code=409, detail=msg)

    try:
        if req.enabled:
            # Get actual current settings from Tesla before modifying
            from tesla.commands import get_site_config
            current_config = await get_site_config()
            pre_mode = current_config.get("operation_mode", "autonomous")
            pre_reserve = current_config.get("backup_reserve_percent", 20)
            pre_export = current_config.get("export_rule", "battery_ok")

            setup_store.set("pre_offgrid_mode", pre_mode)
            setup_store.set("pre_offgrid_reserve", pre_reserve)
            setup_store.set("pre_offgrid_export", pre_export)
            setup_store.set("offgrid_active", True)

            # Go off-grid: self-powered, no grid interaction
            await set_operation_mode("self_consumption")
            await set_grid_import_export(
                disallow_charge_from_grid_with_solar_installed=True,
                customer_preferred_export_rule="never",
            )
            await set_backup_reserve(0)

            return {"success": True, "offgrid": True, "message": f"Off-grid mode activated. Saved previous state: {pre_mode} with {pre_reserve}% reserve."}
        else:
            # Restore previous settings
            prev_mode = setup_store.get("pre_offgrid_mode") or "autonomous"
            prev_reserve = float(setup_store.get("pre_offgrid_reserve") or 20)
            prev_export = setup_store.get("pre_offgrid_export") or "battery_ok"

            # Restore in order: mode first, then export rule, then reserve
            await set_operation_mode(prev_mode)
            await set_grid_import_export(
                disallow_charge_from_grid_with_solar_installed=False,
                customer_preferred_export_rule=prev_export,
            )
            await set_backup_reserve(prev_reserve)

            # Mark as inactive only after all commands succeed
            setup_store.set("offgrid_active", False)

            return {"success": True, "offgrid": False, "message": f"Off-grid mode deactivated. Restored to {prev_mode} with {prev_reserve}% reserve."}
    except (TeslaAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/offgrid/status")
async def offgrid_status():
    """Check if off-grid mode is currently active."""
    return {"active": bool(setup_store.get("offgrid_active"))}


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
    from services.mode_manager import check_manual_change_allowed
    allowed, reason = check_manual_change_allowed()
    if not allowed:
        raise HTTPException(status_code=409, detail=f"Cannot change mode: {reason}")
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
    from services.mode_manager import check_manual_change_allowed
    allowed, reason = check_manual_change_allowed()
    if not allowed:
        raise HTTPException(status_code=409, detail=f"Cannot change reserve: {reason}")
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
    from services.mode_manager import check_manual_change_allowed
    allowed, reason = check_manual_change_allowed()
    if not allowed:
        raise HTTPException(status_code=409, detail=f"Cannot change grid charging: {reason}")
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
    from services.mode_manager import check_manual_change_allowed
    allowed, reason = check_manual_change_allowed()
    if not allowed:
        raise HTTPException(status_code=409, detail=f"Cannot change export rule: {reason}")
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


# --- Notification Settings ---


class NotificationConfig(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    email: str = ""
    webhook_url: str = ""


@router.get("/notifications")
async def get_notification_config():
    """Get notification configuration."""
    from services import setup_store
    return {
        "smtp_host": setup_store.get("notify_smtp_host", ""),
        "smtp_port": setup_store.get("notify_smtp_port", 587),
        "smtp_username": setup_store.get("notify_smtp_username", ""),
        "smtp_password_set": bool(setup_store.get_raw("notify_smtp_password", "")),
        "smtp_from": setup_store.get("notify_smtp_from", ""),
        "email": setup_store.get("notify_email", ""),
        "webhook_url": setup_store.get("notify_webhook_url", ""),
        "configured": bool(setup_store.get("notify_smtp_host") and setup_store.get("notify_email")) or bool(setup_store.get("notify_webhook_url")),
    }


@router.post("/notifications")
async def save_notification_config(data: NotificationConfig):
    """Save notification configuration."""
    from services import setup_store
    updates = {
        "notify_smtp_host": data.smtp_host,
        "notify_smtp_port": data.smtp_port,
        "notify_smtp_username": data.smtp_username,
        "notify_smtp_from": data.smtp_from,
        "notify_email": data.email,
        "notify_webhook_url": data.webhook_url,
    }
    # Only update password if provided (non-empty)
    if data.smtp_password:
        updates["notify_smtp_password"] = data.smtp_password
    setup_store.update(updates)
    return {"status": "ok"}


@router.post("/notifications/test")
async def test_notification():
    """Send a test notification via all configured channels."""
    from services.notifications import send_notification, is_configured
    if not is_configured():
        raise HTTPException(status_code=400, detail="No notification channels configured")
    results = await send_notification(
        "Test Notification",
        "This is a test notification from GridMind. If you received this, notifications are working!",
        "info",
    )
    return {"results": [{"channel": r[0], "success": r[1]} for r in results]}
