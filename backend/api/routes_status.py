"""API routes for live Powerwall status and Tesla auth."""

from fastapi import APIRouter, HTTPException

from tesla.client import tesla_client, TeslaAuthError, TeslaAPIError
from tesla.commands import get_live_status, get_site_config
from tesla.models import AuthStatus, TokenExchangeRequest
from services.collector import get_latest_status
from services import setup_store

router = APIRouter(prefix="/api", tags=["status"])


@router.get("/mode-status")
async def mode_status():
    """Get the current mode manager status -- who's in control."""
    from services.mode_manager import get_active_controller, check_manual_change_allowed
    active = get_active_controller()
    allowed, reason = check_manual_change_allowed()
    return {
        "active_controller": active,
        "manual_allowed": allowed,
        "block_reason": reason if not allowed else None,
    }


@router.get("/status")
async def current_status():
    """Get the latest cached Powerwall status."""
    status = get_latest_status()
    if status is None:
        # Try a live fetch if no cached data
        if tesla_client.is_authenticated:
            try:
                status = await get_live_status()
                return status.model_dump()
            except Exception:
                pass
        return None
    return status.model_dump()


@router.get("/site/config")
async def site_config():
    """Get the current site configuration."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla")
    try:
        config = await get_site_config()
        return config
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.get("/site/info")
async def site_info_raw():
    """Get full raw site info from Tesla (for debugging and battery details)."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla")
    try:
        from tesla.commands import get_site_info
        return await get_site_info()
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.get("/site/tariff")
async def site_tariff():
    """Get the current TOU rate period and tariff info from Tesla."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla")
    try:
        from tesla.commands import get_site_info
        from datetime import datetime
        from zoneinfo import ZoneInfo
        info = await get_site_info()
        tariff = info.get("tariff_content", {})

        if not tariff:
            return {"configured": False}

        # Use the user's configured timezone for TOU period calculation
        user_tz_name = setup_store.get_timezone()
        try:
            user_tz = ZoneInfo(user_tz_name)
        except Exception:
            user_tz = ZoneInfo("America/New_York")

        now = datetime.now(user_tz)
        day_of_week = now.weekday()  # 0=Monday, 6=Sunday
        hour = now.hour
        minute = now.minute

        # Parse the tariff to find current period
        current_period = "OFF_PEAK"
        current_rate = 0.0

        seasons = tariff.get("seasons", {})
        energy_charges = tariff.get("energy_charges", {})

        # Find the active season
        for season_name, season_data in seasons.items():
            from_month = season_data.get("fromMonth", 1)
            to_month = season_data.get("toMonth", 12)
            if from_month <= now.month <= to_month:
                tou_periods = season_data.get("tou_periods", {})

                for period_name, schedules in tou_periods.items():
                    # schedules is a list of time ranges
                    schedule_list = schedules if isinstance(schedules, list) else []
                    for sched in schedule_list:
                        from_dow = sched.get("fromDayOfWeek", 0)
                        to_dow = sched.get("toDayOfWeek", 6)
                        from_hr = sched.get("fromHour", 0)
                        from_min = sched.get("fromMinute", 0)
                        to_hr = sched.get("toHour", 0)
                        to_min = sched.get("toMinute", 0)

                        # Check day of week
                        if not (from_dow <= day_of_week <= to_dow):
                            continue

                        # Weekend all-day (fromHour=0, toHour=0)
                        if from_hr == 0 and to_hr == 0 and from_min == 0 and to_min == 0:
                            current_period = period_name
                            break

                        # Check time range (handles overnight spans like 21:00-7:00)
                        current_minutes = hour * 60 + minute
                        from_minutes = from_hr * 60 + from_min
                        to_minutes = to_hr * 60 + to_min

                        if from_minutes < to_minutes:
                            # Normal range (e.g., 7:00 - 17:00)
                            if from_minutes <= current_minutes < to_minutes:
                                current_period = period_name
                                break
                        else:
                            # Overnight range (e.g., 21:00 - 7:00)
                            if current_minutes >= from_minutes or current_minutes < to_minutes:
                                current_period = period_name
                                break

                # Get rate for current period and season
                season_charges = energy_charges.get(season_name, {})
                current_rate = season_charges.get(current_period, 0)
                break

        # Format period name for display
        period_display = {
            "OFF_PEAK": "Off-Peak",
            "ON_PEAK": "Peak",
            "PARTIAL_PEAK": "Mid-Peak",
        }

        # Get all rates for display
        rate_schedule = {}
        for season_name, season_data in seasons.items():
            tou_periods = season_data.get("tou_periods", {})
            season_charges = energy_charges.get(season_name, {})
            for period_name, schedules in tou_periods.items():
                schedule_list = schedules if isinstance(schedules, list) else []
                rate_schedule[period_name] = {
                    "display_name": period_display.get(period_name, period_name),
                    "rate": season_charges.get(period_name, 0),
                    "schedules": schedule_list,
                }

        return {
            "configured": True,
            "utility": tariff.get("utility", ""),
            "plan_name": tariff.get("name", ""),
            "plan_code": tariff.get("code", ""),
            "currency": tariff.get("currency", "USD"),
            "current_period": current_period,
            "current_period_display": period_display.get(current_period, current_period),
            "current_rate": current_rate,
            "rate_schedule": rate_schedule,
        }
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.get("/grid/energy-mix")
async def grid_energy_mix():
    """Get current grid energy source mix from EIA API.

    Returns fuel type breakdown (hydro, wind, solar, gas, etc.) and
    clean/fossil percentages for the user's balancing authority region.
    Requires EIA API key to be configured in Settings.
    """
    from services.grid_mix import get_cached_mix, fetch_grid_mix, get_eia_api_key, get_balancing_authority

    api_key = get_eia_api_key()
    if not api_key:
        return {"configured": False, "message": "EIA API key not configured. Get a free key at https://www.eia.gov/opendata/register.php"}

    ba = get_balancing_authority()
    if not ba:
        return {
            "configured": True,
            "error": "Could not determine your grid region. Set your balancing authority in Settings.",
            "debug": {"api_key_length": len(api_key), "address": setup_store.get_address() or "(none)",
                      "lat": setup_store.get_latitude(), "lon": setup_store.get_longitude()},
        }

    # Try cache first, fetch if stale
    mix = get_cached_mix()
    if not mix:
        mix = await fetch_grid_mix()

    if not mix:
        return {
            "configured": True,
            "balancing_authority": ba,
            "error": "No grid mix data available yet. Check container logs for EIA API errors.",
        }

    return {"configured": True, **mix}


@router.get("/site/list")
async def list_sites():
    """List available energy sites on the Tesla account."""
    if not tesla_client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with Tesla")
    try:
        sites = await tesla_client.list_energy_sites()
        return {"sites": sites}
    except TeslaAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


# --- Tesla Auth ---


@router.get("/auth/status")
async def auth_status():
    """Check Tesla authentication status."""
    result = AuthStatus(
        authenticated=tesla_client.is_authenticated,
        energy_site_id=tesla_client.energy_site_id,
    )

    # Always include the auth URL if credentials are configured
    # (needed for re-authentication to update scopes)
    if setup_store.get_tesla_client_id():
        result.auth_url = tesla_client.get_auth_url()

    return result.model_dump()


@router.get("/auth/url")
async def get_auth_url():
    """Get the Tesla OAuth authorization URL."""
    if not setup_store.get_tesla_client_id():
        raise HTTPException(
            status_code=400,
            detail="Tesla client_id not configured. Enter it in Settings.",
        )
    return {"auth_url": tesla_client.get_auth_url()}


@router.post("/auth/callback")
async def auth_callback(request: TokenExchangeRequest):
    """Exchange an authorization code for tokens."""
    try:
        tokens = await tesla_client.exchange_code(request.code)

        # Auto-discover energy site
        try:
            site_id = await tesla_client.auto_discover_site()
        except TeslaAPIError:
            site_id = None

        return {
            "success": True,
            "energy_site_id": site_id,
            "message": "Successfully authenticated with Tesla!",
        }
    except TeslaAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/auth/callback")
async def auth_callback_redirect(code: str = "", state: str = ""):
    """Handle the OAuth redirect from Tesla (GET request from browser)."""
    if not code:
        raise HTTPException(status_code=400, detail="No authorization code received")

    try:
        await tesla_client.exchange_code(code)
        try:
            await tesla_client.auto_discover_site()
        except TeslaAPIError:
            pass

        # Return a simple HTML page that tells the user to go back to the dashboard
        from fastapi.responses import HTMLResponse
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head><title>GridMind - Auth Success</title></head>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: white;">
                <div style="text-align: center;">
                    <h1>⚡ Authentication Successful!</h1>
                    <p>GridMind is now connected to your Tesla account.</p>
                    <p><a href="/" style="color: #60a5fa;">Return to Dashboard</a></p>
                </div>
            </body>
            </html>
            """,
            status_code=200,
        )
    except TeslaAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))
