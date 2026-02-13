"""Automation engine - evaluates rules and executes actions on a schedule."""

import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from config import settings
from database import async_session, AutomationRule, RuleExecutionLog
from automation.rules import evaluate_rule
from automation.actions import execute_actions
from services.collector import collect_data, update_daily_summary, get_latest_status
from services.vehicle_collector import collect_vehicle_data
from services.weather import fetch_solar_forecast

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def setup_scheduler():
    """Configure and start the automation scheduler."""

    # Restore GridMind Optimize state from persistent storage
    from automation.optimizer import init as optimizer_init
    optimizer_init()

    # Core data collection - every 30 seconds
    scheduler.add_job(
        collect_data,
        IntervalTrigger(seconds=settings.poll_interval_seconds),
        id="data_collector",
        name="Powerwall Data Collector",
        replace_existing=True,
    )

    # Daily summary - every hour
    scheduler.add_job(
        update_daily_summary,
        IntervalTrigger(hours=1),
        id="daily_summary",
        name="Daily Energy Summary",
        replace_existing=True,
    )

    # Rule evaluation - every minute
    scheduler.add_job(
        evaluate_all_rules,
        IntervalTrigger(minutes=1),
        id="rule_evaluator",
        name="Automation Rule Evaluator",
        replace_existing=True,
    )

    # GridMind Optimize - every 2 minutes
    from automation.optimizer import evaluate as optimizer_evaluate
    scheduler.add_job(
        optimizer_evaluate,
        IntervalTrigger(minutes=2),
        id="gridmind_optimizer",
        name="GridMind Optimize Engine",
        replace_existing=True,
    )

    # Solar forecast - every 6 hours
    scheduler.add_job(
        fetch_solar_forecast,
        IntervalTrigger(hours=6),
        id="solar_forecast",
        name="Solar Forecast Update",
        replace_existing=True,
    )

    # Vehicle data collection - every 30 seconds (adaptive polling handled internally)
    scheduler.add_job(
        collect_vehicle_data,
        IntervalTrigger(seconds=30),
        id="vehicle_collector",
        name="Vehicle Data Collector",
        replace_existing=True,
    )

    # EV charge scheduler - every 2 minutes
    from automation.charge_scheduler import evaluate as charge_scheduler_evaluate
    scheduler.add_job(
        charge_scheduler_evaluate,
        IntervalTrigger(minutes=2),
        id="ev_charge_scheduler",
        name="EV Charge Scheduler",
        replace_existing=True,
    )

    # Periodic cleanup of expired login rate-limit entries
    from main import _cleanup_login_attempts
    scheduler.add_job(
        _cleanup_login_attempts,
        IntervalTrigger(minutes=30),
        id="login_cleanup",
        name="Login Rate-Limit Cleanup",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Automation scheduler started")


def shutdown_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Automation scheduler stopped")


async def evaluate_all_rules():
    """Evaluate all enabled automation rules against current state."""
    # Check if a higher-priority controller is active
    from services.mode_manager import check_automation_allowed
    allowed, reason = check_automation_allowed()
    if not allowed:
        logger.debug("Rule evaluation skipped: %s", reason)
        return

    status = get_latest_status()
    if status is None:
        logger.debug("No current status available, skipping rule evaluation")
        return

    async with async_session() as session:
        result = await session.execute(
            select(AutomationRule)
            .where(AutomationRule.enabled == True)
            .order_by(AutomationRule.priority.desc())
        )
        rules = result.scalars().all()

    if not rules:
        return

    now = datetime.now()

    for rule in rules:
        try:
            triggered = await evaluate_rule(rule, status, now)

            if triggered:
                logger.info("Rule triggered: %s (id=%d)", rule.name, rule.id)

                # Execute actions
                success, errors = await execute_actions(rule.actions)

                # Log execution
                async with async_session() as session:
                    log_entry = RuleExecutionLog(
                        rule_id=rule.id,
                        rule_name=rule.name,
                        trigger_type=rule.trigger_type,
                        actions_executed=rule.actions,
                        success=success,
                        error_message="; ".join(errors) if errors else None,
                    )
                    session.add(log_entry)

                    # Update rule execution tracking
                    db_rule = await session.get(AutomationRule, rule.id)
                    if db_rule:
                        db_rule.last_triggered = now
                        db_rule.trigger_count = (db_rule.trigger_count or 0) + 1
                        if db_rule.one_shot:
                            db_rule.enabled = False
                            logger.info("One-shot rule disabled: %s", rule.name)

                    await session.commit()

        except Exception as e:
            logger.exception("Error evaluating rule %s: %s", rule.name, e)
