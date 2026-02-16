"""API routes for notification rule templates."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AutomationRule

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notification-templates", tags=["notification-templates"])


class TemplateResponse(BaseModel):
    """Response model for a notification template."""
    id: str
    name: str
    description: str
    category: str
    trigger_type: str
    trigger_config: dict
    conditions: Optional[list[dict]]
    actions: list[dict]
    priority: int


# Predefined notification templates
TEMPLATES = [
    {
        "id": "grid-outage",
        "name": "Grid Outage Alert",
        "description": "Notify when grid goes offline (islanded mode)",
        "category": "Grid",
        "trigger_type": "grid_status",
        "trigger_config": {"status": "islanded"},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "⚡ Grid Outage Detected",
                "message": "Your Powerwall has switched to islanded mode. Running on battery backup.",
                "severity": "critical"
            }
        ],
        "priority": 10
    },
    {
        "id": "battery-low",
        "name": "Low Battery Warning",
        "description": "Alert when battery drops below 20%",
        "category": "Battery",
        "trigger_type": "soc",
        "trigger_config": {"operator": "<=", "value": 20},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "🔋 Low Battery",
                "message": "Battery level has dropped to 20% or below.",
                "severity": "warning"
            }
        ],
        "priority": 8
    },
    {
        "id": "battery-full",
        "name": "Battery Fully Charged",
        "description": "Notify when battery reaches 100%",
        "category": "Battery",
        "trigger_type": "soc",
        "trigger_config": {"operator": ">=", "value": 100},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "✅ Battery Fully Charged",
                "message": "Your Powerwall is now at 100% capacity.",
                "severity": "info"
            }
        ],
        "priority": 3
    },
    {
        "id": "peak-rates-starting",
        "name": "Peak Rates Starting",
        "description": "Alert before peak electricity rates begin (4 PM weekdays)",
        "category": "TOU",
        "trigger_type": "time",
        "trigger_config": {"time": "15:55", "days": ["mon", "tue", "wed", "thu", "fri"]},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "💰 Peak Rates Starting Soon",
                "message": "Peak electricity rates begin in 5 minutes. Consider reducing usage.",
                "severity": "info"
            }
        ],
        "priority": 5
    },
    {
        "id": "high-solar-production",
        "name": "High Solar Production",
        "description": "Notify when solar exceeds 5 kW",
        "category": "Solar",
        "trigger_type": "solar",
        "trigger_config": {"operator": ">=", "value": 5000},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "☀️ Excellent Solar Production",
                "message": "Your solar panels are generating over 5 kW!",
                "severity": "info"
            }
        ],
        "priority": 2
    },
    {
        "id": "high-home-load",
        "name": "High Home Load Alert",
        "description": "Alert when home consumption exceeds 8 kW",
        "category": "Load",
        "trigger_type": "load",
        "trigger_config": {"operator": ">=", "value": 8000},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "⚠️ High Power Usage",
                "message": "Your home is currently using over 8 kW. Consider reducing load.",
                "severity": "warning"
            }
        ],
        "priority": 6
    },
    {
        "id": "exporting-to-grid",
        "name": "Exporting to Grid",
        "description": "Notify when exporting more than 3 kW to grid",
        "category": "Grid",
        "trigger_type": "grid_power",
        "trigger_config": {"operator": "<=", "value": -3000},
        "conditions": None,
        "actions": [
            {
                "type": "notify",
                "title": "📤 Exporting Power",
                "message": "You're exporting over 3 kW to the grid. Earning credits!",
                "severity": "info"
            }
        ],
        "priority": 2
    }
]


@router.get("", response_model=list[TemplateResponse])
async def list_templates():
    """Get all available notification templates."""
    return TEMPLATES


@router.post("/{template_id}/apply")
async def apply_template(template_id: str, db: AsyncSession = Depends(get_db)):
    """Create an automation rule from a template."""
    template = next((t for t in TEMPLATES if t["id"] == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Create automation rule from template
    rule = AutomationRule(
        name=template["name"],
        description=template["description"],
        enabled=True,
        priority=template["priority"],
        trigger_type=template["trigger_type"],
        trigger_config=template["trigger_config"],
        conditions=template["conditions"],
        actions=template["actions"],
        one_shot=False
    )
    
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    
    logger.info("Applied notification template: %s (rule_id=%d)", template["name"], rule.id)
    
    return {"status": "ok", "rule_id": rule.id, "template_id": template_id}

