"""Automation actions - executable commands triggered by rules."""

import logging

from tesla.commands import (
    set_operation_mode,
    set_backup_reserve,
    set_storm_mode,
    set_grid_import_export,
)
from services.notifications import send_notification

logger = logging.getLogger(__name__)


async def execute_actions(actions: list[dict]) -> tuple[bool, list[str]]:
    """Execute a list of actions from a rule.

    Returns:
        (all_succeeded, list_of_error_messages)
    """
    errors = []

    for action in actions:
        action_type = action.get("type", "")
        try:
            await _execute_single_action(action_type, action)
            logger.info("Action executed: %s", action_type)
        except Exception as e:
            error_msg = f"Action '{action_type}' failed: {e}"
            logger.error(error_msg)
            errors.append(error_msg)

    return len(errors) == 0, errors


async def _execute_single_action(action_type: str, action: dict):
    """Execute a single action."""

    if action_type == "set_mode":
        mode = action.get("value", "self_consumption")
        await set_operation_mode(mode)

    elif action_type == "set_reserve":
        reserve = float(action.get("value", 20))
        await set_backup_reserve(reserve)

    elif action_type == "set_storm_mode":
        enabled = action.get("value", False)
        await set_storm_mode(enabled)

    elif action_type == "set_grid_charging":
        # disallow_charge = True means grid charging is OFF
        enabled = action.get("value", False)
        await set_grid_import_export(
            disallow_charge_from_grid_with_solar_installed=not enabled
        )

    elif action_type == "set_export_rule":
        rule = action.get("value", "pv_only")
        await set_grid_import_export(customer_preferred_export_rule=rule)

    elif action_type == "ev_charge_start":
        from services import setup_store as ss
        vid = ss.get("selected_vehicle_id")
        if vid:
            from tesla.vehicle_commands import charge_start
            await charge_start(vid)

    elif action_type == "ev_charge_stop":
        from services import setup_store as ss
        vid = ss.get("selected_vehicle_id")
        if vid:
            from tesla.vehicle_commands import charge_stop
            await charge_stop(vid)

    elif action_type == "ev_set_amps":
        from services import setup_store as ss
        vid = ss.get("selected_vehicle_id")
        if vid:
            from tesla.vehicle_commands import set_charging_amps
            amps = int(action.get("value", 16))
            await set_charging_amps(vid, amps)

    elif action_type == "notify":
        title = action.get("title", "Automation Alert")
        message = action.get("message", "A GridMind automation was triggered.")
        level = action.get("level", "info")
        await send_notification(title, message, level)

    else:
        raise ValueError(f"Unknown action type: {action_type}")
