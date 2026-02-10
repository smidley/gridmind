"""Tesla Fleet API client with OAuth token management."""

import json
import time
import logging
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import httpx

from config import settings
from services import setup_store

logger = logging.getLogger(__name__)


class TeslaAuthError(Exception):
    """Raised when Tesla authentication fails."""
    pass


class TeslaAPIError(Exception):
    """Raised when a Tesla API call fails."""
    def __init__(self, message: str, status_code: int = 0):
        self.status_code = status_code
        super().__init__(message)


class TeslaFleetClient:
    """Client for Tesla Fleet API with automatic token refresh."""

    SCOPES = "openid energy_device_data energy_cmds offline_access"

    def __init__(self):
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._token_expiry: float = 0
        self._energy_site_id: Optional[str] = None
        self._http_client: Optional[httpx.AsyncClient] = None
        self._load_tokens()

    def _load_tokens(self):
        """Load saved tokens from disk."""
        token_file = Path(settings.tesla_token_file)
        if token_file.exists():
            try:
                data = json.loads(token_file.read_text())
                self._access_token = data.get("access_token")
                self._refresh_token = data.get("refresh_token")
                self._token_expiry = data.get("token_expiry", 0)
                self._energy_site_id = data.get("energy_site_id")
                logger.info("Loaded Tesla tokens from %s", token_file)
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning("Failed to load tokens: %s", e)
        # Also check env/settings overrides
        if settings.tesla_access_token:
            self._access_token = settings.tesla_access_token
        if settings.tesla_refresh_token:
            self._refresh_token = settings.tesla_refresh_token
        if settings.tesla_energy_site_id:
            self._energy_site_id = settings.tesla_energy_site_id

    def _save_tokens(self):
        """Persist tokens to disk."""
        token_file = Path(settings.tesla_token_file)
        token_file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "access_token": self._access_token,
            "refresh_token": self._refresh_token,
            "token_expiry": self._token_expiry,
            "energy_site_id": self._energy_site_id,
        }
        token_file.write_text(json.dumps(data, indent=2))
        logger.info("Saved Tesla tokens to %s", token_file)

    @property
    def is_authenticated(self) -> bool:
        """Check if we have valid credentials."""
        return bool(self._access_token)

    @property
    def energy_site_id(self) -> Optional[str]:
        return self._energy_site_id

    @energy_site_id.setter
    def energy_site_id(self, value: str):
        self._energy_site_id = value
        self._save_tokens()

    async def get_http_client(self) -> httpx.AsyncClient:
        """Get or create an async HTTP client."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                base_url=settings.tesla_api_base_url,
                timeout=30.0,
            )
        return self._http_client

    async def close(self):
        """Close the HTTP client."""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()

    # --- OAuth Flow ---

    def get_auth_url(self, state: str = "gridmind") -> str:
        """Generate the Tesla OAuth authorization URL."""
        params = {
            "response_type": "code",
            "client_id": setup_store.get_tesla_client_id(),
            "redirect_uri": setup_store.get_tesla_redirect_uri(),
            "scope": self.SCOPES,
            "state": state,
        }
        return f"{settings.tesla_auth_url}/authorize?{urlencode(params)}"

    async def exchange_code(self, authorization_code: str) -> dict:
        """Exchange an authorization code for access + refresh tokens."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.tesla_auth_url}/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": setup_store.get_tesla_client_id(),
                    "client_secret": setup_store.get_tesla_client_secret(),
                    "code": authorization_code,
                    "redirect_uri": setup_store.get_tesla_redirect_uri(),
                },
            )

        if response.status_code != 200:
            raise TeslaAuthError(
                f"Token exchange failed ({response.status_code}): {response.text}"
            )

        data = response.json()
        self._access_token = data["access_token"]
        self._refresh_token = data.get("refresh_token")
        self._token_expiry = time.time() + data.get("expires_in", 28800)
        self._save_tokens()

        logger.info("Successfully authenticated with Tesla Fleet API")
        return data

    async def refresh_access_token(self):
        """Refresh the access token using the refresh token."""
        if not self._refresh_token:
            raise TeslaAuthError("No refresh token available. Re-authenticate required.")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.tesla_auth_url}/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": setup_store.get_tesla_client_id(),
                    "refresh_token": self._refresh_token,
                },
            )

        if response.status_code != 200:
            raise TeslaAuthError(
                f"Token refresh failed ({response.status_code}): {response.text}"
            )

        data = response.json()
        self._access_token = data["access_token"]
        if "refresh_token" in data:
            self._refresh_token = data["refresh_token"]
        self._token_expiry = time.time() + data.get("expires_in", 28800)
        self._save_tokens()

        logger.info("Refreshed Tesla access token")

    async def _ensure_token(self):
        """Ensure we have a valid access token, refreshing if needed."""
        if not self._access_token:
            raise TeslaAuthError("Not authenticated. Please complete OAuth setup.")

        # Refresh if token expires within 5 minutes
        if self._token_expiry and time.time() > (self._token_expiry - 300):
            await self.refresh_access_token()

    # --- API Calls ---

    async def _request(self, method: str, endpoint: str, **kwargs) -> dict:
        """Make an authenticated API request with auto-retry on token expiry."""
        await self._ensure_token()
        client = await self.get_http_client()

        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

        response = await client.request(method, endpoint, headers=headers, **kwargs)

        # If unauthorized, try refreshing token once
        if response.status_code == 401:
            logger.warning("Got 401, attempting token refresh...")
            await self.refresh_access_token()
            headers["Authorization"] = f"Bearer {self._access_token}"
            response = await client.request(method, endpoint, headers=headers, **kwargs)

        if response.status_code >= 400:
            raise TeslaAPIError(
                f"API error {response.status_code}: {response.text}",
                status_code=response.status_code,
            )

        return response.json()

    async def get(self, endpoint: str, **kwargs) -> dict:
        return await self._request("GET", endpoint, **kwargs)

    async def post(self, endpoint: str, **kwargs) -> dict:
        return await self._request("POST", endpoint, **kwargs)

    # --- Energy Site Discovery ---

    async def list_energy_sites(self) -> list[dict]:
        """List all energy products (Powerwall sites) on the account."""
        data = await self.get("/api/1/products")
        sites = []
        for product in data.get("response", []):
            if "energy_site_id" in product:
                sites.append({
                    "energy_site_id": str(product["energy_site_id"]),
                    "site_name": product.get("site_name", "Unknown"),
                    "battery_count": product.get("battery_count", 0),
                    "resource_type": product.get("resource_type", ""),
                })
        return sites

    async def auto_discover_site(self) -> str:
        """Discover and set the energy site ID automatically."""
        sites = await self.list_energy_sites()
        if not sites:
            raise TeslaAPIError("No energy sites found on this account.")
        # Use the first site with batteries
        site = next((s for s in sites if s["battery_count"] > 0), sites[0])
        self._energy_site_id = site["energy_site_id"]
        self._save_tokens()
        logger.info("Auto-discovered energy site: %s (%s)", site["site_name"], self._energy_site_id)
        return self._energy_site_id

    def _site_url(self, path: str = "") -> str:
        """Build the energy site API URL."""
        if not self._energy_site_id:
            raise TeslaAPIError("No energy site configured. Run setup first.")
        return f"/api/1/energy_sites/{self._energy_site_id}{path}"


# Singleton client instance
tesla_client = TeslaFleetClient()
