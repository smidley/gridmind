"""API routes for live Powerwall status and Tesla auth."""

from fastapi import APIRouter, HTTPException

from tesla.client import tesla_client, TeslaAuthError, TeslaAPIError
from tesla.commands import get_live_status, get_site_config
from tesla.models import AuthStatus, TokenExchangeRequest
from services.collector import get_latest_status
from services import setup_store

router = APIRouter(prefix="/api", tags=["status"])


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
