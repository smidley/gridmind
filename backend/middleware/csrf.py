"""CSRF protection middleware for state-changing operations."""

import logging
import secrets
from typing import Callable

from fastapi import Request, Response, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.datastructures import MutableHeaders

logger = logging.getLogger(__name__)

# CSRF token cookie name
CSRF_COOKIE_NAME = "gridmind_csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"

# Paths that require CSRF protection (state-changing operations)
PROTECTED_PATHS = [
    "/api/powerwall/mode",
    "/api/powerwall/reserve",
    "/api/powerwall/storm-mode",
    "/api/powerwall/grid-charging",
    "/api/powerwall/export-rule",
    "/api/vehicle/charge/start",
    "/api/vehicle/charge/stop",
    "/api/vehicle/charge/limit",
    "/api/vehicle/charge/amps",
    "/api/vehicle/wake",
    "/api/settings/offgrid",
    "/api/rules",  # Creating/updating automation rules
]


def generate_csrf_token() -> str:
    """Generate a new CSRF token."""
    return secrets.token_urlsafe(32)


def validate_csrf_token(request_token: str, cookie_token: str) -> bool:
    """Validate CSRF token using constant-time comparison."""
    if not request_token or not cookie_token:
        return False
    return secrets.compare_digest(request_token, cookie_token)


class CSRFMiddleware(BaseHTTPMiddleware):
    """Middleware to protect against CSRF attacks on state-changing endpoints.
    
    - Sets a CSRF token cookie on all responses
    - Validates CSRF token on POST/PUT/PATCH/DELETE requests to protected paths
    - Exempts GET/HEAD/OPTIONS requests (safe methods)
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Get or generate CSRF token
        csrf_token = request.cookies.get(CSRF_COOKIE_NAME)
        if not csrf_token:
            csrf_token = generate_csrf_token()
            logger.debug("Generated new CSRF token")

        # Check if this is a state-changing request to a protected path
        is_state_changing = request.method in ("POST", "PUT", "PATCH", "DELETE")
        is_protected = any(request.url.path.startswith(path) for path in PROTECTED_PATHS)

        if is_state_changing and is_protected:
            # Validate CSRF token
            request_token = request.headers.get(CSRF_HEADER_NAME)
            
            if not validate_csrf_token(request_token, csrf_token):
                logger.warning(
                    "CSRF validation failed for %s %s from %s",
                    request.method,
                    request.url.path,
                    request.client.host if request.client else "unknown"
                )
                raise HTTPException(
                    status_code=403,
                    detail="CSRF token validation failed. Please refresh the page and try again."
                )
            
            logger.debug("CSRF token validated for %s %s", request.method, request.url.path)

        # Process request
        response = await call_next(request)

        # Set CSRF token cookie on response (refresh on every request)
        from config import settings
        response.set_cookie(
            key=CSRF_COOKIE_NAME,
            value=csrf_token,
            httponly=False,  # Must be readable by JavaScript to send in headers
            secure=not settings.debug,  # HTTPS only in production
            samesite="lax",  # Lax allows normal navigation; strict breaks some flows
            max_age=86400,  # 24 hours
        )

        return response


def get_csrf_token(request: Request) -> str:
    """Get the current CSRF token from the request cookies.
    
    Use this in endpoints that need to return the CSRF token to the client.
    """
    token = request.cookies.get(CSRF_COOKIE_NAME)
    if not token:
        token = generate_csrf_token()
    return token

