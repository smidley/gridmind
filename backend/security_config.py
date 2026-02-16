"""Security configuration and secrets management."""

import os
import secrets
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# JWT secret key for session token signing
_JWT_SECRET_KEY = None


def get_jwt_secret_key() -> str:
    """Get or generate JWT secret key.
    
    Priority:
    1. GRIDMIND_JWT_SECRET_KEY environment variable
    2. Persisted secret in data/.jwt_secret file
    3. Generate new secret and persist it
    """
    global _JWT_SECRET_KEY
    
    if _JWT_SECRET_KEY:
        return _JWT_SECRET_KEY
    
    # Try environment variable first
    env_secret = os.environ.get("GRIDMIND_JWT_SECRET_KEY")
    if env_secret:
        _JWT_SECRET_KEY = env_secret
        logger.info("Using JWT secret from environment variable")
        return _JWT_SECRET_KEY
    
    # Try persisted secret file
    from config import settings
    secret_file = Path(settings.data_dir) / ".jwt_secret"
    
    if secret_file.exists():
        try:
            _JWT_SECRET_KEY = secret_file.read_text().strip()
            logger.info("Loaded JWT secret from %s", secret_file)
            return _JWT_SECRET_KEY
        except Exception as e:
            logger.warning("Failed to read JWT secret file: %s", e)
    
    # Generate new secret and persist it
    _JWT_SECRET_KEY = secrets.token_urlsafe(32)
    try:
        secret_file.parent.mkdir(parents=True, exist_ok=True)
        secret_file.write_text(_JWT_SECRET_KEY)
        secret_file.chmod(0o600)  # Read/write for owner only
        logger.info("Generated new JWT secret and saved to %s", secret_file)
    except Exception as e:
        logger.warning("Failed to persist JWT secret: %s", e)
    
    return _JWT_SECRET_KEY


def should_use_secure_cookies() -> bool:
    """Determine if secure cookies should be used.
    
    Returns True unless explicitly in debug mode.
    This ensures cookies are only sent over HTTPS in production.
    """
    from config import settings
    
    # Check environment variable override
    env_secure = os.environ.get("GRIDMIND_SESSION_COOKIE_SECURE")
    if env_secure is not None:
        return env_secure.lower() in ("true", "1", "yes")
    
    # Default: secure cookies unless in debug mode
    return not settings.debug


def get_openai_api_key() -> str:
    """Get OpenAI API key from environment variable.
    
    Returns empty string if not configured.
    """
    return os.environ.get("GRIDMIND_OPENAI_API_KEY", "")


def validate_secrets() -> dict[str, bool]:
    """Validate that all required secrets are configured.
    
    Returns a dict of secret names and whether they're configured.
    """
    from config import settings
    
    return {
        "jwt_secret": bool(get_jwt_secret_key()),
        "tesla_client_id": bool(settings.tesla_client_id),
        "tesla_client_secret": bool(settings.tesla_client_secret),
        "smtp_password": bool(settings.smtp_password) if settings.smtp_host else None,
        "openai_api_key": bool(get_openai_api_key()) or None,  # Optional
    }


def log_security_status():
    """Log security configuration status at startup."""
    from config import settings
    
    logger.info("Security configuration:")
    logger.info("  - Debug mode: %s", settings.debug)
    logger.info("  - Secure cookies: %s", should_use_secure_cookies())
    logger.info("  - JWT secret: %s", "configured" if get_jwt_secret_key() else "MISSING")
    
    secrets_status = validate_secrets()
    for secret_name, configured in secrets_status.items():
        if configured is None:
            continue  # Optional secret
        status = "✓ configured" if configured else "✗ MISSING"
        logger.info("  - %s: %s", secret_name, status)

