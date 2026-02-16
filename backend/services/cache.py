"""Centralized caching service for API responses and expensive operations."""

import time
import logging
from typing import Any, Callable, Optional
from functools import wraps
import asyncio

logger = logging.getLogger(__name__)

# In-memory cache storage
_cache: dict[str, dict[str, Any]] = {}
_cache_lock = asyncio.Lock()


class CacheEntry:
    """Cache entry with value and expiration time."""
    
    def __init__(self, value: Any, ttl: int):
        self.value = value
        self.expires_at = time.time() + ttl
        self.created_at = time.time()
    
    def is_expired(self) -> bool:
        """Check if cache entry has expired."""
        return time.time() > self.expires_at
    
    def age_seconds(self) -> float:
        """Get age of cache entry in seconds."""
        return time.time() - self.created_at


async def get(key: str) -> Optional[Any]:
    """Get value from cache if it exists and hasn't expired."""
    async with _cache_lock:
        if key not in _cache:
            return None
        
        entry = _cache[key]
        if entry.is_expired():
            del _cache[key]
            logger.debug("Cache expired: %s (age: %.1fs)", key, entry.age_seconds())
            return None
        
        logger.debug("Cache hit: %s (age: %.1fs)", key, entry.age_seconds())
        return entry.value


async def set(key: str, value: Any, ttl: int = 300):
    """Set value in cache with TTL in seconds."""
    async with _cache_lock:
        _cache[key] = CacheEntry(value, ttl)
        logger.debug("Cache set: %s (ttl: %ds)", key, ttl)


async def delete(key: str):
    """Delete a specific cache entry."""
    async with _cache_lock:
        if key in _cache:
            del _cache[key]
            logger.debug("Cache deleted: %s", key)


async def clear():
    """Clear all cache entries."""
    async with _cache_lock:
        count = len(_cache)
        _cache.clear()
        logger.info("Cache cleared: %d entries removed", count)


async def get_stats() -> dict:
    """Get cache statistics."""
    async with _cache_lock:
        total = len(_cache)
        expired = sum(1 for entry in _cache.values() if entry.is_expired())
        active = total - expired
        
        entries = []
        for key, entry in _cache.items():
            entries.append({
                "key": key,
                "age_seconds": round(entry.age_seconds(), 1),
                "expires_in": round(entry.expires_at - time.time(), 1),
                "expired": entry.is_expired(),
            })
        
        return {
            "total_entries": total,
            "active_entries": active,
            "expired_entries": expired,
            "entries": sorted(entries, key=lambda x: x["age_seconds"], reverse=True),
        }


def cached(ttl: int = 300, key_prefix: str = ""):
    """Decorator to cache async function results.
    
    Args:
        ttl: Time to live in seconds (default: 5 minutes)
        key_prefix: Optional prefix for cache key
    
    Example:
        @cached(ttl=3600, key_prefix="solar_forecast")
        async def fetch_solar_forecast():
            # expensive API call
            return data
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key from function name and arguments
            cache_key = f"{key_prefix}:{func.__name__}" if key_prefix else func.__name__
            
            # Add args/kwargs to key if present
            if args:
                cache_key += f":{str(args)}"
            if kwargs:
                cache_key += f":{str(sorted(kwargs.items()))}"
            
            # Try to get from cache
            cached_value = await get(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Cache miss - call function
            logger.debug("Cache miss: %s - calling function", cache_key)
            result = await func(*args, **kwargs)
            
            # Store in cache
            await set(cache_key, result, ttl)
            
            return result
        
        return wrapper
    return decorator


async def get_or_set(key: str, factory: Callable, ttl: int = 300) -> Any:
    """Get value from cache or compute it using factory function.
    
    Args:
        key: Cache key
        factory: Async function to call if cache miss
        ttl: Time to live in seconds
    
    Example:
        result = await get_or_set(
            "solar_forecast",
            fetch_solar_forecast,
            ttl=3600
        )
    """
    cached_value = await get(key)
    if cached_value is not None:
        return cached_value
    
    # Cache miss - call factory
    result = await factory()
    await set(key, result, ttl)
    
    return result

