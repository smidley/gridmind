"""Rate limiting middleware for control endpoints."""

import time
from collections import defaultdict
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limit control endpoints to prevent abuse."""
    
    def __init__(self, app, max_requests: int = 10, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Check rate limit for control endpoints."""
        # Only rate limit control endpoints (POST/PUT/DELETE to specific paths)
        if request.method in ("POST", "PUT", "DELETE"):
            control_paths = (
                "/api/powerwall/",
                "/api/vehicle/charge/",
                "/api/vehicle/wake",
                "/api/settings/offgrid",
            )
            
            if any(request.url.path.startswith(path) for path in control_paths):
                client_ip = self._get_client_ip(request)
                
                if not self._check_rate_limit(client_ip):
                    return JSONResponse(
                        status_code=429,
                        content={
                            "detail": f"Rate limit exceeded. Maximum {self.max_requests} control requests per {self.window_seconds} seconds."
                        },
                    )
        
        return await call_next(request)
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request."""
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
    
    def _check_rate_limit(self, client_ip: str) -> bool:
        """Check if client is within rate limit."""
        now = time.time()
        cutoff = now - self.window_seconds
        
        # Clean old requests
        self._requests[client_ip] = [
            ts for ts in self._requests[client_ip] if ts > cutoff
        ]
        
        # Check limit
        if len(self._requests[client_ip]) >= self.max_requests:
            return False
        
        # Record this request
        self._requests[client_ip].append(now)
        return True

