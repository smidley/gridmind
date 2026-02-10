"""GridMind - Tesla Powerwall 3 Automation App."""

import asyncio
import json
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database import init_db
from automation.engine import setup_scheduler, shutdown_scheduler
from services.collector import register_status_listener, unregister_status_listener
from api.routes_status import router as status_router
from api.routes_rules import router as rules_router
from api.routes_history import router as history_router
from api.routes_settings import router as settings_router

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

    # Start automation scheduler
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

# CORS - allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(status_router)
app.include_router(rules_router)
app.include_router(history_router)
app.include_router(settings_router)


# --- WebSocket for real-time updates ---

connected_clients: set[WebSocket] = set()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time Powerwall status updates."""
    await websocket.accept()
    connected_clients.add(websocket)
    logger.info("WebSocket client connected (%d total)", len(connected_clients))

    async def on_status_update(status):
        """Broadcast status to this client."""
        try:
            await websocket.send_json(status.model_dump(mode="json"))
        except Exception:
            pass

    register_status_listener(on_status_update)

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
        logger.info("WebSocket client disconnected (%d remaining)", len(connected_clients))


# --- Health check ---

@app.get("/api/health")
async def health():
    """Health check endpoint."""
    from tesla.client import tesla_client
    from services.collector import get_latest_status

    status = get_latest_status()
    return {
        "status": "ok",
        "version": settings.app_version,
        "authenticated": tesla_client.is_authenticated,
        "energy_site_id": tesla_client.energy_site_id,
        "has_data": status is not None,
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

    # Serve other static files (favicon, etc.)
    @app.get("/favicon.svg")
    async def favicon():
        path = os.path.join(frontend_dist, "favicon.svg")
        if os.path.isfile(path):
            return FileResponse(path, media_type="image/svg+xml")

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
