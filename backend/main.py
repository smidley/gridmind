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


# Serve frontend static files (in production, built React app)
# This is mounted last so API routes take priority
import os
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
