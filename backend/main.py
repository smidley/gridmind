"""GridMind - Tesla Powerwall 3 Automation App."""

import asyncio
import json
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import settings
from database import init_db
from automation.engine import setup_scheduler, shutdown_scheduler
from services.collector import register_status_listener, unregister_status_listener
from services.vehicle_collector import register_vehicle_listener, unregister_vehicle_listener
from api.routes_status import router as status_router
from api.routes_rules import router as rules_router
from api.routes_history import router as history_router
from api.routes_settings import router as settings_router
from api.routes_vehicle import router as vehicle_router
from api.routes_health import router as health_router
from api.routes_ai import router as ai_router
from api.routes_achievements import router as achievements_router

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("gridmind")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("Starting GridMind v%s", settings.app_version)

    # Initialize database
    await init_db()
    logger.info("Database initialized")

    # Log persistent state restoration
    from services import setup_store
    if setup_store.is_setup_complete():
        logger.info("Tesla credentials: configured")
    if setup_store.is_location_configured():
        logger.info("Location: configured (%s)", setup_store.get_address() or f"{setup_store.get_latitude()},{setup_store.get_longitude()}")
    if setup_store.get("gridmind_optimize_enabled"):
        logger.info("GridMind Optimize: will restore on scheduler start")
    if setup_store.get("offgrid_active"):
        logger.warning("Off-Grid Mode was active at shutdown -- will remain in last known state. Check Settings.")

    # Start automation scheduler (also restores optimizer state)
    setup_scheduler()

    yield

    # Shutdown
    shutdown_scheduler()
    from tesla.client import tesla_client
    await tesla_client.close()
    logger.info("GridMind stopped")


app = FastAPI(
    title="GridMind",
    description="Tesla Powerwall 3 Automation",
    version=settings.app_version,
    lifespan=lifespan,
)

# CORS - restrict to dev servers in debug mode, allow all in production
# (production runs behind a reverse proxy on the same origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"] if settings.debug else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limit control endpoints (POST/PUT/DELETE) to prevent abuse
from middleware.rate_limit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware, max_requests=10, window_seconds=60)

# CSRF protection for state-changing endpoints
from middleware.csrf import CSRFMiddleware
app.add_middleware(CSRFMiddleware)

# --- App Authentication ---

# Paths that don't require authentication
AUTH_EXEMPT_PATHS = {
    "/api/app-auth/login",
    "/api/app-auth/status",
    "/api/csrf-token",
    "/api/health",
    "/auth/callback",
    "/ws",
}
AUTH_EXEMPT_PREFIXES = ("/assets/", "/favicon")


class LoginRequest(BaseModel):
    username: str
    password: str


class SetPasswordRequest(BaseModel):
    username: str
    password: str


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Check authentication for all API routes when auth is enabled."""
    from services.app_auth import is_auth_enabled, verify_session_token

    # Skip auth check if not enabled
    if not is_auth_enabled():
        return await call_next(request)

    path = request.url.path

    # Skip exempt paths
    if path in AUTH_EXEMPT_PATHS or any(path.startswith(p) for p in AUTH_EXEMPT_PREFIXES):
        return await call_next(request)

    # SPA routes (non-API, non-asset) serve index.html — let frontend handle auth
    if not path.startswith("/api/"):
        return await call_next(request)

    # Check session cookie
    token = request.cookies.get("gridmind_session")
    if token and verify_session_token(token):
        return await call_next(request)

    return JSONResponse(status_code=401, content={"detail": "Authentication required"})


@app.get("/api/csrf-token")
async def csrf_token(request: Request):
    """Get a CSRF token for state-changing requests."""
    from middleware.csrf import get_csrf_token
    return {"csrf_token": get_csrf_token(request)}


@app.get("/api/app-auth/status")
async def app_auth_status():
    """Check if app authentication is enabled and if the current session is valid."""
    from services.app_auth import is_auth_enabled, verify_session_token

    return {
        "auth_enabled": is_auth_enabled(),
    }


# Login rate limiting — track failed attempts per IP
_login_attempts: dict[str, list[float]] = {}  # IP -> list of failed attempt timestamps
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 900  # 15 minutes


def _check_rate_limit(ip: str) -> tuple[bool, int]:
    """Check if an IP is rate limited. Returns (allowed, seconds_remaining)."""
    import time
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    # Remove attempts older than lockout window
    attempts = [t for t in attempts if now - t < LOGIN_LOCKOUT_SECONDS]
    if attempts:
        _login_attempts[ip] = attempts
    else:
        _login_attempts.pop(ip, None)  # Clean up empty entries
    if len(attempts) >= LOGIN_MAX_ATTEMPTS:
        remaining = int(LOGIN_LOCKOUT_SECONDS - (now - attempts[0]))
        return False, max(remaining, 1)
    return True, 0


def _record_failed_attempt(ip: str):
    """Record a failed login attempt."""
    import time
    _login_attempts.setdefault(ip, []).append(time.time())


def _clear_attempts(ip: str):
    """Clear failed attempts after successful login."""
    _login_attempts.pop(ip, None)


def _cleanup_login_attempts():
    """Periodic cleanup of expired login attempt records."""
    import time
    now = time.time()
    expired = [ip for ip, attempts in _login_attempts.items()
               if all(now - t >= LOGIN_LOCKOUT_SECONDS for t in attempts)]
    for ip in expired:
        del _login_attempts[ip]
    if expired:
        logger.debug("Cleaned up %d expired login rate-limit entries", len(expired))


@app.post("/api/app-auth/login")
async def app_auth_login(data: LoginRequest, request: Request, response: Response):
    """Log in with username and password. Rate limited: 5 attempts per 15 minutes."""
    from services.app_auth import verify_password, create_session_token, is_auth_enabled

    if not is_auth_enabled():
        return {"status": "ok", "message": "Authentication not enabled"}

    # Rate limit check
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0].strip()
    allowed, lockout_remaining = _check_rate_limit(client_ip)
    if not allowed:
        logger.warning("Login rate limited for IP %s (%ds remaining)", client_ip, lockout_remaining)
        return JSONResponse(
            status_code=429,
            content={"detail": f"Too many failed attempts. Try again in {lockout_remaining // 60} minutes."},
        )

    if not verify_password(data.username, data.password):
        _record_failed_attempt(client_ip)
        attempts_left = LOGIN_MAX_ATTEMPTS - len(_login_attempts.get(client_ip, []))
        return JSONResponse(
            status_code=401,
            content={"detail": f"Invalid username or password. {max(attempts_left, 0)} attempts remaining."},
        )

    _clear_attempts(client_ip)
    token = create_session_token(data.username)
    response.set_cookie(
        key="gridmind_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,  # 30 days
        secure=not settings.debug,  # Secure in production (HTTPS via reverse proxy)
    )

    return {"status": "ok", "username": data.username}


@app.post("/api/app-auth/logout")
async def app_auth_logout(response: Response):
    """Log out by clearing the session cookie."""
    response.delete_cookie("gridmind_session")
    return {"status": "ok"}


@app.post("/api/app-auth/set-password")
async def app_auth_set_password(data: SetPasswordRequest, request: Request):
    """Set or update the login password. Requires existing session if auth is already enabled."""
    from services.app_auth import is_auth_enabled, verify_session_token, set_password

    # If auth is already enabled, require a valid session
    if is_auth_enabled():
        token = request.cookies.get("gridmind_session")
        if not token or not verify_session_token(token):
            return JSONResponse(status_code=401, content={"detail": "Must be logged in to change password"})

    try:
        set_password(data.username, data.password)
        return {"status": "ok"}
    except ValueError as e:
        return JSONResponse(status_code=400, content={"detail": str(e)})


@app.post("/api/app-auth/disable")
async def app_auth_disable(request: Request):
    """Disable authentication entirely."""
    from services.app_auth import is_auth_enabled, verify_session_token, remove_password

    if is_auth_enabled():
        token = request.cookies.get("gridmind_session")
        if not token or not verify_session_token(token):
            return JSONResponse(status_code=401, content={"detail": "Must be logged in to disable auth"})

    remove_password()
    return {"status": "ok"}


# Register API routes
app.include_router(status_router)
app.include_router(rules_router)
app.include_router(history_router)
app.include_router(settings_router)
app.include_router(vehicle_router)
app.include_router(health_router)
app.include_router(ai_router)
app.include_router(achievements_router)


# --- WebSocket for real-time updates ---

connected_clients: set[WebSocket] = set()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time Powerwall and vehicle status updates."""
    await websocket.accept()
    connected_clients.add(websocket)
    logger.info("WebSocket client connected (%d total)", len(connected_clients))

    async def on_status_update(status):
        """Broadcast Powerwall status to this client."""
        try:
            data = status.model_dump(mode="json")
            data["_type"] = "powerwall"
            await websocket.send_json(data)
        except Exception as e:
            logger.warning("WebSocket send failed (powerwall): %s", e)

    async def on_vehicle_update(vehicle_status):
        """Broadcast vehicle status to this client."""
        try:
            data = vehicle_status.model_dump(mode="json")
            data["_type"] = "vehicle"
            await websocket.send_json(data)
        except Exception as e:
            logger.warning("WebSocket send failed (vehicle): %s", e)

    register_status_listener(on_status_update)
    register_vehicle_listener(on_vehicle_update)

    try:
        while True:
            # Keep connection alive, handle incoming messages
            data = await websocket.receive_text()
            # Client can send ping/pong or commands
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.discard(websocket)
        unregister_status_listener(on_status_update)
        unregister_vehicle_listener(on_vehicle_update)
        logger.info("WebSocket client disconnected (%d remaining)", len(connected_clients))


# --- Health check ---

@app.get("/api/health")
async def health():
    """Health check endpoint."""
    from tesla.client import tesla_client
    from services.collector import get_latest_status

    import os
    from services import setup_store

    status = get_latest_status()
    data_dir = settings.data_dir
    volume_mounted = os.path.isdir(data_dir) and os.access(data_dir, os.W_OK)
    setup_exists = os.path.isfile(os.path.join(data_dir, "setup.json"))

    return {
        "status": "ok",
        "version": settings.app_version,
        "authenticated": tesla_client.is_authenticated,
        "energy_site_id": tesla_client.energy_site_id,
        "has_data": status is not None,
        "data_volume_mounted": volume_mounted,
        "setup_persisted": setup_exists,
        "optimize_enabled": bool(setup_store.get("gridmind_optimize_enabled")),
        "offgrid_active": bool(setup_store.get("offgrid_active")),
        "selected_vehicle_id": setup_store.get("selected_vehicle_id"),
        "ev_schedule_strategy": (setup_store.get("ev_schedule") or {}).get("strategy", "off"),
    }


# --- OAuth callback (must be at /auth/callback, not /api/auth/callback) ---

@app.get("/auth/callback")
async def auth_callback_redirect(code: str = "", state: str = ""):
    """Handle the OAuth redirect from Tesla (browser GET redirect)."""
    from fastapi.responses import HTMLResponse
    from tesla.client import tesla_client, TeslaAuthError, TeslaAPIError

    if not code:
        return HTMLResponse(
            content='<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f172a;color:white;"><div style="text-align:center;"><h1>Error</h1><p>No authorization code received.</p><p><a href="/settings" style="color:#60a5fa;">Back to Settings</a></p></div></body></html>',
            status_code=400,
        )

    try:
        await tesla_client.exchange_code(code)
        try:
            await tesla_client.auto_discover_site()
        except TeslaAPIError:
            pass

        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head><title>GridMind - Auth Success</title></head>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: white;">
                <div style="text-align: center;">
                    <h1 style="color: #fbbf24;">&#9889; Authentication Successful!</h1>
                    <p style="color: #94a3b8;">GridMind is now connected to your Tesla account.</p>
                    <p style="margin-top: 24px;"><a href="/settings" style="color: #0f172a; background: #3b82f6; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Return to Settings</a></p>
                </div>
            </body>
            </html>
            """,
            status_code=200,
        )
    except TeslaAuthError as e:
        return HTMLResponse(
            content=f'<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f172a;color:white;"><div style="text-align:center;"><h1 style="color:#ef4444;">Authentication Failed</h1><p style="color:#94a3b8;">{str(e)}</p><p><a href="/settings" style="color:#60a5fa;">Back to Settings</a></p></div></body></html>',
            status_code=400,
        )


# Serve frontend static files (in production, built React app)
# Mounted under /assets so API routes and the SPA catch-all take priority
import os
from fastapi.responses import FileResponse

frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    # Serve static assets (JS, CSS, images) directly
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Serve static files (favicon, PWA manifest, service worker, icons)
    @app.get("/favicon.svg")
    async def favicon():
        path = os.path.join(frontend_dist, "favicon.svg")
        if os.path.isfile(path):
            return FileResponse(path, media_type="image/svg+xml")

    @app.get("/manifest.json")
    async def pwa_manifest():
        path = os.path.join(frontend_dist, "manifest.json")
        if os.path.isfile(path):
            return FileResponse(path, media_type="application/manifest+json")

    @app.get("/sw.js")
    async def service_worker():
        path = os.path.join(frontend_dist, "sw.js")
        if os.path.isfile(path):
            return FileResponse(path, media_type="application/javascript",
                                headers={"Service-Worker-Allowed": "/"})

    @app.get("/icon-192.png")
    async def icon_192():
        path = os.path.join(frontend_dist, "icon-192.png")
        if os.path.isfile(path):
            return FileResponse(path, media_type="image/png")

    @app.get("/icon-512.png")
    async def icon_512():
        path = os.path.join(frontend_dist, "icon-512.png")
        if os.path.isfile(path):
            return FileResponse(path, media_type="image/png")

    @app.get("/apple-touch-icon.png")
    async def apple_touch_icon():
        path = os.path.join(frontend_dist, "apple-touch-icon.png")
        if os.path.isfile(path):
            return FileResponse(path, media_type="image/png")

    # SPA catch-all: serve index.html for any unmatched route
    # This must be registered LAST so API routes take priority
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        """Serve the React SPA for any non-API route."""
        # Don't intercept API or WebSocket paths
        if full_path.startswith("api/") or full_path.startswith("ws"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        index_path = os.path.join(frontend_dist, "index.html")
        return FileResponse(index_path, media_type="text/html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
