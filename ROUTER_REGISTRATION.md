# Router Registration Instructions

This PR adds two new API route modules that need to be registered in `backend/main.py`.

## Files Added

1. `backend/api/routes_backup.py` - Backup/restore functionality
2. `backend/api/routes_notification_templates.py` - Notification rule templates

## Manual Steps Required

### 1. Add Imports

Add these two lines after the existing router imports (around line 27):

```python
from api.routes_backup import router as backup_router
from api.routes_notification_templates import router as notification_templates_router
```

The imports section should look like:

```python
from api.routes_status import router as status_router
from api.routes_rules import router as rules_router
from api.routes_history import router as history_router
from api.routes_settings import router as settings_router
from api.routes_vehicle import router as vehicle_router
from api.routes_health import router as health_router
from api.routes_ai import router as ai_router
from api.routes_achievements import router as achievements_router
from api.routes_backup import router as backup_router
from api.routes_notification_templates import router as notification_templates_router
```

### 2. Register Routers

Add these two lines after the existing router registrations (around line 280):

```python
app.include_router(backup_router)
app.include_router(notification_templates_router)
```

The registration section should look like:

```python
# Register API routes
app.include_router(status_router)
app.include_router(rules_router)
app.include_router(history_router)
app.include_router(settings_router)
app.include_router(vehicle_router)
app.include_router(health_router)
app.include_router(ai_router)
app.include_router(achievements_router)
app.include_router(backup_router)
app.include_router(notification_templates_router)
```

## Testing

After making these changes, restart the backend and verify the new endpoints are available:

- `GET /api/backup/info` - Get backup information
- `GET /api/backup/export` - Download backup ZIP
- `GET /api/notification-templates` - List notification templates
- `POST /api/notification-templates/{id}/apply` - Apply a template

## Why Manual Registration?

The IDE's auto-formatter was automatically removing these imports during the PR creation process. Rather than fight with the formatter, this PR includes the route files and instructions for manual registration.

