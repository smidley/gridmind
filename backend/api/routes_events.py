"""VPP Peak Events API — schedule and manage utility demand response events."""

import logging
import uuid
from datetime import datetime, date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import setup_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    name: str
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    rate_per_kwh: float


def _get_events() -> list[dict]:
    """Get all peak events from setup store."""
    events = setup_store.get("peak_events", [])
    if not isinstance(events, list):
        return []
    return events


def _save_events(events: list[dict]):
    """Save peak events to setup store."""
    setup_store.set("peak_events", events)


def get_active_event() -> dict | None:
    """Get the currently active VPP event, if any.

    Used by the optimizer to check if an event is happening right now.
    """
    from zoneinfo import ZoneInfo
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")

    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    for event in _get_events():
        if event.get("status") not in ("scheduled", "active"):
            continue
        if event.get("date") != today_str:
            continue
        if event.get("start_time", "") <= current_time < event.get("end_time", ""):
            return event

    return None


def get_next_event() -> dict | None:
    """Get the next upcoming event (for dashboard display)."""
    from zoneinfo import ZoneInfo
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")

    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    upcoming = []
    for event in _get_events():
        if event.get("status") not in ("scheduled", "active"):
            continue
        evt_date = event.get("date", "")
        evt_start = event.get("start_time", "")
        if evt_date > today_str or (evt_date == today_str and evt_start > current_time):
            upcoming.append(event)

    if not upcoming:
        return None

    upcoming.sort(key=lambda e: (e.get("date", ""), e.get("start_time", "")))
    return upcoming[0]


def get_recently_completed_event() -> dict | None:
    """Get an event that completed within the last 3 hours (for celebration display)."""
    from zoneinfo import ZoneInfo
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")

    now = datetime.now(tz)

    for event in reversed(_get_events()):
        if event.get("status") != "completed":
            continue
        completed_at = event.get("completed_at")
        if completed_at:
            try:
                completed_dt = datetime.fromisoformat(completed_at)
                if not completed_dt.tzinfo:
                    completed_dt = completed_dt.replace(tzinfo=tz)
                hours_ago = (now - completed_dt).total_seconds() / 3600
                if hours_ago <= 3:
                    return event
            except Exception:
                pass

    return None


def mark_event_active(event_id: str):
    """Mark an event as active (called by optimizer when event starts)."""
    events = _get_events()
    for event in events:
        if event.get("id") == event_id:
            event["status"] = "active"
            break
    _save_events(events)


def complete_event(event_id: str, exported_kwh: float, earnings: float):
    """Mark an event as completed with results (called by optimizer when event ends)."""
    from zoneinfo import ZoneInfo
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")

    events = _get_events()
    for event in events:
        if event.get("id") == event_id:
            event["status"] = "completed"
            event["completed_at"] = datetime.now(tz).isoformat()
            event["result"] = {
                "exported_kwh": round(exported_kwh, 2),
                "earnings": round(earnings, 2),
            }
            break
    _save_events(events)


@router.get("")
async def list_events():
    """List all peak events."""
    events = _get_events()

    # Auto-expire old scheduled events that never ran
    from zoneinfo import ZoneInfo
    tz_name = setup_store.get_timezone()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")

    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")
    changed = False

    for event in events:
        if event.get("status") == "scheduled":
            evt_date = event.get("date", "")
            evt_end = event.get("end_time", "")
            if evt_date < today_str or (evt_date == today_str and evt_end <= current_time):
                event["status"] = "expired"
                changed = True

    if changed:
        _save_events(events)

    return {
        "events": events,
        "active": get_active_event(),
        "next": get_next_event(),
        "recently_completed": get_recently_completed_event(),
    }


@router.post("")
async def create_event(data: EventCreate):
    """Schedule a new VPP peak event."""
    # Validate date
    try:
        evt_date = datetime.strptime(data.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # Validate times
    try:
        datetime.strptime(data.start_time, "%H:%M")
        datetime.strptime(data.end_time, "%H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid time format. Use HH:MM.")

    if data.start_time >= data.end_time:
        raise HTTPException(status_code=400, detail="Start time must be before end time.")

    if data.rate_per_kwh <= 0:
        raise HTTPException(status_code=400, detail="Rate must be positive.")

    event = {
        "id": f"evt_{uuid.uuid4().hex[:12]}",
        "name": data.name.strip() or "VPP Peak Event",
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "rate_per_kwh": data.rate_per_kwh,
        "status": "scheduled",
        "created_at": datetime.now().isoformat(),
        "result": None,
    }

    events = _get_events()
    events.append(event)
    _save_events(events)

    logger.info("VPP event scheduled: %s on %s %s-%s at $%.2f/kWh",
                event["name"], data.date, data.start_time, data.end_time, data.rate_per_kwh)

    return {"status": "ok", "event": event}


@router.delete("/{event_id}")
async def delete_event(event_id: str):
    """Cancel or delete a peak event."""
    events = _get_events()
    event = next((e for e in events if e.get("id") == event_id), None)

    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    if event.get("status") == "active":
        raise HTTPException(status_code=409, detail="Cannot delete an active event. Wait for it to complete.")

    events = [e for e in events if e.get("id") != event_id]
    _save_events(events)

    logger.info("VPP event deleted: %s", event_id)
    return {"status": "ok"}


@router.get("/next")
async def next_event():
    """Get the next upcoming event."""
    return {"event": get_next_event()}


@router.get("/active")
async def active_event():
    """Get the currently active event."""
    return {"event": get_active_event()}


@router.get("/stats")
async def event_stats():
    """Get aggregate VPP event statistics."""
    events = _get_events()
    completed = [e for e in events if e.get("status") == "completed" and e.get("result")]

    total_events = len(completed)
    total_exported = sum(e["result"]["exported_kwh"] for e in completed)
    total_earnings = sum(e["result"]["earnings"] for e in completed)
    avg_rate = total_earnings / total_exported if total_exported > 0 else 0

    return {
        "total_events": total_events,
        "total_exported_kwh": round(total_exported, 2),
        "total_earnings": round(total_earnings, 2),
        "avg_rate_per_kwh": round(avg_rate, 2),
        "events": [
            {
                "name": e.get("name"),
                "date": e.get("date"),
                "start_time": e.get("start_time"),
                "end_time": e.get("end_time"),
                "rate_per_kwh": e.get("rate_per_kwh"),
                "exported_kwh": e["result"]["exported_kwh"],
                "earnings": e["result"]["earnings"],
            }
            for e in completed
        ],
    }
