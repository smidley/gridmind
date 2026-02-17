"""API routes for cache management."""

import logging
from fastapi import APIRouter

from services import cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cache", tags=["cache"])


@router.get("/stats")
async def get_cache_stats():
    """Get cache statistics and entry list."""
    return await cache.get_stats()


@router.post("/clear")
async def clear_cache():
    """Clear all cache entries. Use to force fresh data from external APIs."""
    await cache.clear()
    return {"status": "ok", "message": "Cache cleared"}


@router.delete("/{key}")
async def delete_cache_entry(key: str):
    """Delete a specific cache entry by key."""
    await cache.delete(key)
    return {"status": "ok", "message": f"Cache entry '{key}' deleted"}
