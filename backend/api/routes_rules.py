"""API routes for automation rules CRUD."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AutomationRule, RuleExecutionLog

router = APIRouter(prefix="/api/rules", tags=["rules"])


# --- Request/Response Models ---


class RuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    enabled: bool = True
    priority: int = 0
    trigger_type: str
    trigger_config: dict
    conditions: Optional[list[dict]] = None
    actions: list[dict]
    one_shot: bool = False


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[dict] = None
    conditions: Optional[list[dict]] = None
    actions: Optional[list[dict]] = None
    one_shot: Optional[bool] = None


class RuleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    enabled: bool
    priority: int
    trigger_type: str
    trigger_config: dict
    conditions: Optional[list[dict]]
    actions: list[dict]
    one_shot: bool
    last_triggered: Optional[datetime]
    trigger_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Endpoints ---


@router.get("", response_model=list[RuleResponse])
async def list_rules(db: AsyncSession = Depends(get_db)):
    """List all automation rules."""
    result = await db.execute(
        select(AutomationRule).order_by(AutomationRule.priority.desc())
    )
    return result.scalars().all()


@router.get("/{rule_id}", response_model=RuleResponse)
async def get_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single automation rule."""
    rule = await db.get(AutomationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.post("", response_model=RuleResponse, status_code=201)
async def create_rule(data: RuleCreate, db: AsyncSession = Depends(get_db)):
    """Create a new automation rule."""
    _validate_rule(data.trigger_type, data.trigger_config, data.actions)

    rule = AutomationRule(
        name=data.name,
        description=data.description,
        enabled=data.enabled,
        priority=data.priority,
        trigger_type=data.trigger_type,
        trigger_config=data.trigger_config,
        conditions=data.conditions,
        actions=data.actions,
        one_shot=data.one_shot,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=RuleResponse)
async def update_rule(rule_id: int, data: RuleUpdate, db: AsyncSession = Depends(get_db)):
    """Update an existing automation rule."""
    rule = await db.get(AutomationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rule, field, value)

    rule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Delete an automation rule."""
    rule = await db.get(AutomationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    await db.delete(rule)
    await db.commit()
    return {"deleted": True}


@router.post("/{rule_id}/toggle")
async def toggle_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Toggle a rule's enabled state."""
    rule = await db.get(AutomationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule.enabled = not rule.enabled
    rule.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": rule.id, "enabled": rule.enabled}


# --- Execution Log ---


@router.get("/log/recent")
async def recent_executions(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Get recent rule execution log entries."""
    result = await db.execute(
        select(RuleExecutionLog)
        .order_by(RuleExecutionLog.timestamp.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.isoformat(),
            "rule_id": log.rule_id,
            "rule_name": log.rule_name,
            "trigger_type": log.trigger_type,
            "actions_executed": log.actions_executed,
            "success": log.success,
            "error_message": log.error_message,
        }
        for log in logs
    ]


# --- Validation ---

VALID_TRIGGER_TYPES = {"time", "soc", "load", "solar", "grid_power", "grid_status", "battery_power"}
VALID_ACTION_TYPES = {"set_mode", "set_reserve", "set_storm_mode", "set_grid_charging", "set_export_rule", "notify"}


def _validate_rule(trigger_type: str, trigger_config: dict, actions: list[dict]):
    """Validate rule configuration."""
    if trigger_type not in VALID_TRIGGER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid trigger type: {trigger_type}. Valid: {VALID_TRIGGER_TYPES}",
        )

    for action in actions:
        if action.get("type") not in VALID_ACTION_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid action type: {action.get('type')}. Valid: {VALID_ACTION_TYPES}",
            )
