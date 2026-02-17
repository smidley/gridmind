"""Application authentication — password-based login with JWT session cookies."""

import logging
import re
import secrets
import time
from typing import Optional

import bcrypt
import jwt

from services import setup_store

logger = logging.getLogger(__name__)

# JWT signing key — generated once and stored persistently
_JWT_ALGORITHM = "HS256"
_SESSION_DURATION = 60 * 60 * 24 * 30  # 30 days

# Password requirements
MIN_PASSWORD_LENGTH = 12
PASSWORD_PATTERN = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]'
)


def _get_jwt_secret() -> str:
    """Get or generate the JWT signing secret."""
    secret = setup_store.get("jwt_secret")
    if not secret:
        secret = secrets.token_hex(32)
        setup_store.set("jwt_secret", secret)
    return secret


def is_auth_configured() -> bool:
    """Check if a password has been set."""
    return bool(setup_store.get("auth_password_hash"))


def is_auth_enabled() -> bool:
    """Check if authentication is enabled (password set)."""
    return is_auth_configured()


def validate_password_strength(password: str) -> tuple[bool, str]:
    """Validate password meets security requirements.

    Returns:
        (is_valid, error_message)
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"Password must be at least {MIN_PASSWORD_LENGTH} characters"

    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"

    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"

    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"

    if not re.search(r'[@$!%*?&]', password):
        return False, "Password must contain at least one special character (@$!%*?&)"

    return True, ""


def set_password(username: str, password: str):
    """Set or update the login credentials."""
    is_valid, error_msg = validate_password_strength(password)
    if not is_valid:
        raise ValueError(error_msg)

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    setup_store.update({
        "auth_username": username,
        "auth_password_hash": password_hash,
    })
    logger.info("Authentication credentials updated for user: %s", username)


def verify_password(username: str, password: str) -> bool:
    """Verify login credentials."""
    stored_username = setup_store.get("auth_username", "")
    stored_hash = setup_store.get("auth_password_hash", "")

    if not stored_hash:
        return False

    if username != stored_username:
        return False

    return bcrypt.checkpw(password.encode(), stored_hash.encode())


def create_session_token(username: str) -> str:
    """Create a JWT session token."""
    payload = {
        "sub": username,
        "iat": int(time.time()),
        "exp": int(time.time()) + _SESSION_DURATION,
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=_JWT_ALGORITHM)


def verify_session_token(token: str) -> Optional[str]:
    """Verify a JWT session token. Returns username or None."""
    try:
        payload = jwt.decode(token, _get_jwt_secret(), algorithms=[_JWT_ALGORITHM])
        return payload.get("sub")
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def remove_password():
    """Disable authentication by removing stored credentials."""
    setup_store.update({
        "auth_username": "",
        "auth_password_hash": "",
    })
    logger.info("Authentication disabled")
