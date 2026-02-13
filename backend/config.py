"""GridMind application configuration."""

import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "GridMind"
    app_version: str = "1.1.3"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    data_dir: str = os.environ.get("GRIDMIND_DATA_DIR", str(Path(__file__).parent.parent / "data"))
    database_url: str = ""

    # Tesla Fleet API
    tesla_client_id: str = ""
    tesla_client_secret: str = ""
    tesla_redirect_uri: str = "http://localhost:8080/auth/callback"
    tesla_access_token: str = ""
    tesla_refresh_token: str = ""
    tesla_token_file: str = ""
    tesla_energy_site_id: str = ""

    # Fleet API URLs
    tesla_auth_url: str = "https://auth.tesla.com/oauth2/v3"
    tesla_api_base_url: str = "https://fleet-api.prd.na.vn.cloud.tesla.com"

    # Data Collection
    poll_interval_seconds: int = 30

    # Location (for solar forecast and sunrise/sunset)
    latitude: float = 0.0
    longitude: float = 0.0
    timezone: str = "America/New_York"

    # Notifications
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    notification_email: str = ""
    webhook_url: str = ""

    # Time-of-Use Rates (cents per kWh)
    tou_enabled: bool = False

    model_config = {
        "env_prefix": "GRIDMIND_",
        "env_file": ".env",
        "extra": "ignore",
    }

    def model_post_init(self, __context):
        """Set computed defaults after init."""
        if not self.database_url:
            os.makedirs(self.data_dir, exist_ok=True)
            self.database_url = f"sqlite+aiosqlite:///{self.data_dir}/gridmind.db"
        if not self.tesla_token_file:
            self.tesla_token_file = os.path.join(self.data_dir, "tesla_tokens.json")


settings = Settings()
