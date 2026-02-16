"""Webhook retry service with exponential backoff and dead letter queue."""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from collections import deque

import httpx

logger = logging.getLogger(__name__)

# Configuration
MAX_RETRIES = 5
INITIAL_DELAY_SECONDS = 5
MAX_DELAY_SECONDS = 300  # 5 minutes
BACKOFF_MULTIPLIER = 2
DEAD_LETTER_MAX_SIZE = 100

# In-memory queues
_retry_queue: deque = deque()
_dead_letter_queue: deque = deque(maxlen=DEAD_LETTER_MAX_SIZE)
_processing = False


@dataclass
class WebhookMessage:
    """A webhook message with retry metadata."""
    url: str
    payload: dict
    created_at: datetime = field(default_factory=datetime.utcnow)
    attempts: int = 0
    last_attempt: Optional[datetime] = None
    last_error: Optional[str] = None
    next_retry_at: Optional[float] = None
    
    def calculate_next_retry(self) -> float:
        """Calculate next retry time using exponential backoff."""
        delay = min(
            INITIAL_DELAY_SECONDS * (BACKOFF_MULTIPLIER ** self.attempts),
            MAX_DELAY_SECONDS
        )
        return time.time() + delay


async def send_with_retry(url: str, payload: dict) -> bool:
    """Send webhook with automatic retry on failure.
    
    Returns True if sent successfully, False if queued for retry.
    """
    message = WebhookMessage(url=url, payload=payload)
    
    # Try immediate send
    success, error = await _attempt_send(message)
    if success:
        return True
    
    # Queue for retry
    message.last_error = error
    message.next_retry_at = message.calculate_next_retry()
    _retry_queue.append(message)
    logger.warning("Webhook queued for retry: %s (error: %s)", url, error)
    
    # Start retry processor if not running
    _ensure_processor_running()
    
    return False


async def _attempt_send(message: WebhookMessage) -> tuple[bool, Optional[str]]:
    """Attempt to send a webhook message."""
    message.attempts += 1
    message.last_attempt = datetime.utcnow()
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                message.url,
                json=message.payload,
                timeout=10.0
            )
            response.raise_for_status()
        
        logger.info("Webhook sent successfully: %s (attempt %d)", 
                   message.url, message.attempts)
        return True, None
        
    except httpx.TimeoutException:
        return False, "Timeout"
    except httpx.HTTPStatusError as e:
        return False, f"HTTP {e.response.status_code}"
    except Exception as e:
        return False, str(e)


def _ensure_processor_running():
    """Ensure the retry processor task is running."""
    global _processing
    if not _processing:
        asyncio.create_task(_process_retry_queue())


async def _process_retry_queue():
    """Process the retry queue with exponential backoff."""
    global _processing
    _processing = True
    
    try:
        while _retry_queue:
            now = time.time()
            
            # Find messages ready for retry
            ready = []
            remaining = deque()
            
            while _retry_queue:
                msg = _retry_queue.popleft()
                if msg.next_retry_at and msg.next_retry_at <= now:
                    ready.append(msg)
                else:
                    remaining.append(msg)
            
            # Put back messages not ready yet
            _retry_queue.extend(remaining)
            
            # Process ready messages
            for msg in ready:
                success, error = await _attempt_send(msg)
                
                if success:
                    continue
                
                msg.last_error = error
                
                if msg.attempts >= MAX_RETRIES:
                    # Move to dead letter queue
                    _dead_letter_queue.append(msg)
                    logger.error("Webhook moved to dead letter queue after %d attempts: %s",
                               msg.attempts, msg.url)
                else:
                    # Schedule next retry
                    msg.next_retry_at = msg.calculate_next_retry()
                    _retry_queue.append(msg)
                    logger.warning("Webhook retry %d/%d scheduled for %s",
                                 msg.attempts, MAX_RETRIES, msg.url)
            
            # Wait before next check
            if _retry_queue:
                await asyncio.sleep(1)
    finally:
        _processing = False


def get_queue_stats() -> dict:
    """Get statistics about the webhook queues."""
    return {
        "retry_queue_size": len(_retry_queue),
        "dead_letter_queue_size": len(_dead_letter_queue),
        "processing": _processing,
        "retry_queue": [
            {
                "url": msg.url,
                "attempts": msg.attempts,
                "last_error": msg.last_error,
                "created_at": msg.created_at.isoformat(),
            }
            for msg in list(_retry_queue)[:10]  # Limit to 10
        ],
        "dead_letter_queue": [
            {
                "url": msg.url,
                "attempts": msg.attempts,
                "last_error": msg.last_error,
                "created_at": msg.created_at.isoformat(),
            }
            for msg in list(_dead_letter_queue)[:10]  # Limit to 10
        ],
    }

