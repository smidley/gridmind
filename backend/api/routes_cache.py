"""API routes for cache management."""

import logging
from fastapi import APIRouter, Depends

from services.app_auth import require_auth
from services import cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cache", tags=["cache"])


@router.get("/stats")
async def get_cache_stats(_: str = Depends(require_auth)):
    """Get cache statistics and entry list.
    
    Returns:
        - total_entries: Total number of cache entries
        - active_entries: Number of non-expired entries
        - expired_entries: Number of expired entries
        - entries: List of cache entries with age and expiration info
    """
    return await cache.get_stats()


@router.post("/clear")
async def clear_cache(_: str = Depends(require_auth)):
    """Clear all cache entries.
    
    Use this to force fresh data from external APIs.
    """
    await cache.clear()
    return {"status": "ok", "message": "Cache cleared"}


@router.delete("/{key}")
async def delete_cache_entry(key: str, _: str = Depends(require_auth)):
    """Delete a specific cache entry by key.
    
    Args:
        key: The cache key to delete
    """
    await cache.delete(key)
    return {"status": "ok", "message": f"Cache entry '{key}' deleted"}

