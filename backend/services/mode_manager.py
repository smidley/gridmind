"""Central mode manager -- prevents conflicting mode/settings combinations.

Tracks which "controller" currently owns the Powerwall settings and blocks
conflicting changes from other controllers.

Controllers:
- "manual"       : User making changes via Settings UI
- "automation"   : Automation rule engine
- "ev_scheduler" : EV smart charge scheduler
- "optimizer"    : GridMind Optimize
- "offgrid"      : Off-Grid mode
"""

import logging
from services import setup_store

logger = logging.getLogger(__name__)

# Priority: higher priority controllers can override lower ones
CONTROLLER_PRIORITY = {
    "manual": 0,
    "automation": 1,
    "ev_scheduler": 1,  # Same as automation -- doesn't conflict with Powerwall controls
    "optimizer": 2,
    "offgrid": 3,  # Highest -- off-grid overrides everything
}


def get_active_controller() -> str | None:
    """Get the currently active controller, if any special mode is active."""
    if setup_store.get("offgrid_active"):
        return "offgrid"
    if setup_store.get("gridmind_optimize_enabled"):
        # Only actively controlling during peak phases
        from automation.optimizer import get_state
        state = get_state()
        if state.get("phase") in ("peak_hold", "dumping"):
            return "optimizer"
    return None


def can_change(requesting_controller: str) -> tuple[bool, str]:
    """Check if a controller is allowed to make changes.

    Returns (allowed, reason).
    """
    active = get_active_controller()

    if active is None:
        return True, ""

    if requesting_controller == active:
        return True, ""

    req_priority = CONTROLLER_PRIORITY.get(requesting_controller, 0)
    active_priority = CONTROLLER_PRIORITY.get(active, 0)

    if req_priority >= active_priority:
        return True, ""

    # Blocked
    descriptions = {
        "offgrid": "Off-Grid Mode is active",
        "optimizer": "GridMind Optimize is controlling the Powerwall during peak hours",
    }
    reason = descriptions.get(active, f"{active} is active")

    return False, reason


def check_mode_conflict(enabling: str) -> tuple[bool, str]:
    """Check if enabling a mode would conflict with another active mode.

    Returns (has_conflict, message).
    """
    if enabling == "offgrid":
        if setup_store.get("gridmind_optimize_enabled"):
            from automation.optimizer import get_state
            state = get_state()
            if state.get("phase") in ("peak_hold", "dumping"):
                return True, "Cannot enable Off-Grid Mode while GridMind Optimize is actively managing peak hours. Disable GridMind Optimize first or wait until peak ends."
            # Optimizer is enabled but idle -- warn but allow
            return False, ""

    if enabling == "optimizer":
        if setup_store.get("offgrid_active"):
            return True, "Cannot enable GridMind Optimize while Off-Grid Mode is active. Disable Off-Grid Mode first."

    return False, ""


def check_manual_change_allowed() -> tuple[bool, str]:
    """Check if manual settings changes are allowed right now."""
    return can_change("manual")


def check_automation_allowed() -> tuple[bool, str]:
    """Check if automation rules can make changes right now."""
    active = get_active_controller()
    if active == "offgrid":
        return False, "Off-Grid Mode is active -- automation rules are paused"
    if active == "optimizer":
        return False, "GridMind Optimize is controlling the Powerwall -- automation rules are paused"
    return True, ""


def is_ev_scheduler_active() -> bool:
    """Check if the EV smart charge scheduler is actively controlling the vehicle."""
    schedule = setup_store.get("ev_schedule", {})
    if not isinstance(schedule, dict):
        return False
    return schedule.get("strategy", "off") != "off"


def check_ev_manual_allowed() -> tuple[bool, str]:
    """Check if manual EV charge controls are allowed.

    Unlike Powerwall controls, the EV scheduler doesn't fully block manual
    changes -- it just warns the user that their changes may be overridden.
    """
    if is_ev_scheduler_active():
        from automation.charge_scheduler import get_state
        state = get_state()
        strategy = state.get("strategy", "off")
        return True, f"EV smart scheduler ({strategy}) is active. Manual changes may be overridden."
    return True, ""
