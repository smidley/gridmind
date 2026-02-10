"""Rule evaluation logic for automation triggers and conditions."""

import logging
from datetime import datetime

from database import AutomationRule
from tesla.models import PowerwallStatus

logger = logging.getLogger(__name__)

# Track which rules have been triggered in the current evaluation window
# to prevent repeated firing within the same minute
_recently_triggered: dict[int, datetime] = {}
COOLDOWN_SECONDS = 120  # Minimum seconds between re-triggers of same rule


async def evaluate_rule(
    rule: AutomationRule,
    status: PowerwallStatus,
    now: datetime,
) -> bool:
    """Evaluate if a rule should trigger based on current state.

    Returns True if the rule should fire.
    """
    # Check cooldown
    last = _recently_triggered.get(rule.id)
    if last and (now - last).total_seconds() < COOLDOWN_SECONDS:
        return False

    # Evaluate trigger
    triggered = _evaluate_trigger(rule.trigger_type, rule.trigger_config, status, now)

    if not triggered:
        return False

    # Evaluate additional conditions (all must pass)
    if rule.conditions:
        for condition in rule.conditions:
            if not _evaluate_condition(condition, status, now):
                logger.debug("Rule %s: condition not met: %s", rule.name, condition)
                return False

    # Mark as triggered
    _recently_triggered[rule.id] = now

    return True


def _evaluate_trigger(
    trigger_type: str,
    config: dict,
    status: PowerwallStatus,
    now: datetime,
) -> bool:
    """Evaluate a single trigger."""

    if trigger_type == "time":
        return _check_time_trigger(config, now)
    elif trigger_type == "soc":
        return _check_numeric_trigger(config, status.battery_soc)
    elif trigger_type == "load":
        return _check_numeric_trigger(config, status.home_power)
    elif trigger_type == "solar":
        return _check_numeric_trigger(config, status.solar_power)
    elif trigger_type == "grid_power":
        return _check_numeric_trigger(config, status.grid_power)
    elif trigger_type == "grid_status":
        return status.grid_status == config.get("status")
    elif trigger_type == "battery_power":
        return _check_numeric_trigger(config, status.battery_power)
    else:
        logger.warning("Unknown trigger type: %s", trigger_type)
        return False


def _check_time_trigger(config: dict, now: datetime) -> bool:
    """Check if current time matches a time-based trigger."""
    target_time = config.get("time", "")
    days = config.get("days", [])

    if not target_time:
        return False

    # Parse target time
    try:
        hour, minute = map(int, target_time.split(":"))
    except (ValueError, AttributeError):
        logger.warning("Invalid time format: %s", target_time)
        return False

    # Check day of week (if specified)
    if days:
        day_names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        current_day = day_names[now.weekday()]
        if current_day not in days:
            return False

    # Check time (within 1-minute window)
    return now.hour == hour and now.minute == minute


def _check_numeric_trigger(config: dict, actual_value: float) -> bool:
    """Check a numeric comparison trigger (soc, load, solar, etc.)."""
    operator = config.get("operator", "==")
    threshold = config.get("value", 0)

    try:
        threshold = float(threshold)
    except (ValueError, TypeError):
        return False

    if operator == ">=":
        return actual_value >= threshold
    elif operator == "<=":
        return actual_value <= threshold
    elif operator == ">":
        return actual_value > threshold
    elif operator == "<":
        return actual_value < threshold
    elif operator == "==":
        return actual_value == threshold
    elif operator == "!=":
        return actual_value != threshold
    else:
        logger.warning("Unknown operator: %s", operator)
        return False


def _evaluate_condition(condition: dict, status: PowerwallStatus, now: datetime) -> bool:
    """Evaluate a single condition (same format as triggers)."""
    cond_type = condition.get("type", "")

    if cond_type == "time":
        return _check_time_trigger(condition, now)
    elif cond_type == "soc":
        return _check_numeric_trigger(condition, status.battery_soc)
    elif cond_type == "load":
        return _check_numeric_trigger(condition, status.home_power)
    elif cond_type == "solar":
        return _check_numeric_trigger(condition, status.solar_power)
    elif cond_type == "grid_status":
        return status.grid_status == condition.get("status")
    elif cond_type == "mode":
        return status.operation_mode == condition.get("value")
    else:
        logger.warning("Unknown condition type: %s", cond_type)
        return True  # Unknown conditions pass by default
