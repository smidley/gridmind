"""Persistent setup settings store.

Stores Tesla credentials, location, and other first-run configuration
in a JSON file within the data directory. These settings are managed
through the web UI rather than environment variables.
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional

from config import settings

logger = logging.getLogger(__name__)

_STORE_FILE = os.path.join(settings.data_dir, "setup.json")
_store: dict = {}


def _load():
    """Load settings from disk."""
    global _store
    path = Path(_STORE_FILE)
    if path.exists():
        try:
            _store = json.loads(path.read_text())
            logger.info("Loaded setup settings from %s", _STORE_FILE)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load setup settings: %s", e)
            _store = {}
    else:
        _store = {}


def _save():
    """Persist settings to disk."""
    path = Path(_STORE_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_store, indent=2))
    logger.info("Saved setup settings to %s", _STORE_FILE)


# Initialize on import
_load()


# --- Getters ---


def get(key: str, default=None):
    """Get a setup setting value."""
    return _store.get(key, default)


def get_all() -> dict:
    """Get all setup settings (with secrets masked)."""
    result = dict(_store)
    # Mask sensitive values for API responses
    if "tesla_client_secret" in result:
        secret = result["tesla_client_secret"]
        if len(secret) > 8:
            result["tesla_client_secret_masked"] = f"{secret[:4]}...{secret[-4:]}"
        else:
            result["tesla_client_secret_masked"] = "****"
        del result["tesla_client_secret"]
    return result


def get_raw(key: str, default=None):
    """Get a raw setting value (including secrets). For internal use only."""
    return _store.get(key, default)


# --- Setters ---


def set(key: str, value):
    """Set a single setup setting."""
    _store[key] = value
    _save()


def update(data: dict):
    """Update multiple setup settings at once."""
    _store.update(data)
    _save()


# --- Convenience accessors ---


def get_tesla_client_id() -> str:
    """Get Tesla client ID (setup store first, then env var fallback)."""
    return _store.get("tesla_client_id", "") or settings.tesla_client_id


def get_tesla_client_secret() -> str:
    """Get Tesla client secret (setup store first, then env var fallback)."""
    return _store.get("tesla_client_secret", "") or settings.tesla_client_secret


def get_tesla_redirect_uri() -> str:
    """Get Tesla redirect URI (setup store first, then env var fallback)."""
    return _store.get("tesla_redirect_uri", "") or settings.tesla_redirect_uri


def get_latitude() -> float:
    """Get latitude (setup store first, then env var fallback)."""
    val = _store.get("latitude")
    if val is not None and val != 0:
        return float(val)
    return settings.latitude


def get_longitude() -> float:
    """Get longitude (setup store first, then env var fallback)."""
    val = _store.get("longitude")
    if val is not None and val != 0:
        return float(val)
    return settings.longitude


def get_timezone() -> str:
    """Get timezone (setup store first, then env var fallback)."""
    return _store.get("timezone", "") or settings.timezone


def get_address() -> str:
    """Get the stored address string."""
    return _store.get("address", "")


def is_setup_complete() -> bool:
    """Check if the minimum required setup has been done."""
    return bool(get_tesla_client_id()) and bool(get_tesla_client_secret())


def is_location_configured() -> bool:
    """Check if location has been set."""
    lat = get_latitude()
    lon = get_longitude()
    return lat != 0.0 and lon != 0.0
