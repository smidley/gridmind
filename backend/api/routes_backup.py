"""API routes for backup and restore functionality."""

import io
import logging
import os
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/export")
async def export_backup():
    """Export database and configuration files as a ZIP archive.
    
    Returns a ZIP file containing:
    - gridmind.db (SQLite database)
    - setup.json (configuration)
    - tesla_tokens.json (Tesla API tokens)
    
    This allows users to backup their data and restore it later.
    """
    try:
        # Create a temporary ZIP file in memory
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add database file
            db_path = Path(settings.database_url.replace("sqlite+aiosqlite:///", ""))
            if db_path.exists():
                zip_file.write(db_path, arcname="gridmind.db")
                logger.info("Added database to backup: %s", db_path)
            else:
                logger.warning("Database file not found: %s", db_path)
            
            # Add setup configuration
            setup_path = Path(settings.data_dir) / "setup.json"
            if setup_path.exists():
                zip_file.write(setup_path, arcname="setup.json")
                logger.info("Added setup config to backup")
            
            # Add Tesla tokens
            token_path = Path(settings.tesla_token_file)
            if token_path.exists():
                zip_file.write(token_path, arcname="tesla_tokens.json")
                logger.info("Added Tesla tokens to backup")
            
            # Add metadata file
            metadata = {
                "backup_date": datetime.utcnow().isoformat(),
                "app_version": settings.app_version,
                "files_included": []
            }
            
            if db_path.exists():
                metadata["files_included"].append("gridmind.db")
            if setup_path.exists():
                metadata["files_included"].append("setup.json")
            if token_path.exists():
                metadata["files_included"].append("tesla_tokens.json")
            
            # Write metadata as JSON
            import json
            zip_file.writestr("backup_metadata.json", json.dumps(metadata, indent=2))
        
        # Prepare the response
        zip_buffer.seek(0)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"gridmind_backup_{timestamp}.zip"
        
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    
    except Exception as e:
        logger.error("Failed to create backup: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")


@router.get("/info")
async def backup_info():
    """Get information about what will be included in a backup."""
    db_path = Path(settings.database_url.replace("sqlite+aiosqlite:///", ""))
    setup_path = Path(settings.data_dir) / "setup.json"
    token_path = Path(settings.tesla_token_file)
    
    files = []
    total_size = 0
    
    if db_path.exists():
        size = db_path.stat().st_size
        files.append({
            "name": "gridmind.db",
            "description": "SQLite database with all energy readings, automation rules, and history",
            "size_bytes": size,
            "size_mb": round(size / 1024 / 1024, 2),
            "exists": True
        })
        total_size += size
    
    if setup_path.exists():
        size = setup_path.stat().st_size
        files.append({
            "name": "setup.json",
            "description": "App configuration including location, solar config, and settings",
            "size_bytes": size,
            "size_kb": round(size / 1024, 2),
            "exists": True
        })
        total_size += size
    
    if token_path.exists():
        size = token_path.stat().st_size
        files.append({
            "name": "tesla_tokens.json",
            "description": "Tesla API authentication tokens",
            "size_bytes": size,
            "size_kb": round(size / 1024, 2),
            "exists": True
        })
        total_size += size
    
    return {
        "files": files,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "app_version": settings.app_version,
    }

