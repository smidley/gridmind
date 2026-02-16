#!/usr/bin/env python3
"""Script to register new routers in main.py.

This script adds the necessary imports and router registrations for:
- routes_backup
- routes_notification_templates
"""

import sys
from pathlib import Path

def main():
    main_py = Path(__file__).parent / "backend" / "main.py"
    
    if not main_py.exists():
        print(f"Error: {main_py} not found")
        sys.exit(1)
    
    content = main_py.read_text()
    
    # Check if already registered
    if "routes_backup" in content and "routes_notification_templates" in content:
        print("✓ Routers already registered")
        return
    
    # Add imports after achievements_router
    import_line = "from api.routes_achievements import router as achievements_router"
    new_imports = """from api.routes_achievements import router as achievements_router
from api.routes_backup import router as backup_router
from api.routes_notification_templates import router as notification_templates_router"""
    
    if import_line in content and "routes_backup" not in content:
        content = content.replace(import_line, new_imports)
        print("✓ Added router imports")
    
    # Add router registrations after achievements_router
    register_line = "app.include_router(achievements_router)"
    new_registrations = """app.include_router(achievements_router)
app.include_router(backup_router)
app.include_router(notification_templates_router)"""
    
    if register_line in content and "backup_router" not in content:
        content = content.replace(register_line, new_registrations)
        print("✓ Added router registrations")
    
    # Write back
    main_py.write_text(content)
    print(f"✓ Updated {main_py}")

if __name__ == "__main__":
    main()

