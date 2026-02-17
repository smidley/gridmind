"""API routes for database management and optimization."""

import logging
from fastapi import APIRouter, Depends, Query

from services.app_auth import require_auth
from services import db_optimize

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/db", tags=["database"])


@router.get("/stats")
async def get_database_stats(_: str = Depends(require_auth)):
    """Get database table statistics.
    
    Returns row counts for all tables.
    """
    return await db_optimize.get_table_stats()


@router.post("/optimize")
async def optimize_database(_: str = Depends(require_auth)):
    """Run database optimization tasks.
    
    Creates composite indexes and updates query planner statistics.
    This is safe to run at any time and will skip existing indexes.
    
    Returns:
        - indexes: Created/skipped/failed index counts
        - analyze: Tables analyzed for query optimization
    """
    index_results = await db_optimize.create_indexes()
    analyze_results = await db_optimize.analyze_tables()
    
    return {
        "indexes": index_results,
        "analyze": analyze_results,
    }


@router.post("/vacuum")
async def vacuum_database(_: str = Depends(require_auth)):
    """Run VACUUM to reclaim space and defragment the database.
    
    Warning: This can take a while for large databases and will
    temporarily lock the database. Run during low-activity periods.
    """
    success = await db_optimize.vacuum_database()
    return {
        "success": success,
        "message": "Database vacuumed successfully" if success else "Vacuum failed"
    }


@router.get("/indexes")
async def list_indexes(_: str = Depends(require_auth)):
    """List all indexes in the database."""
    from sqlalchemy import text
    from database import async_session
    
    async with async_session() as session:
        result = await session.execute(text("""
            SELECT name, tbl_name, sql 
            FROM sqlite_master 
            WHERE type='index' AND sql IS NOT NULL
            ORDER BY tbl_name, name
        """))
        rows = result.fetchall()
    
    indexes = []
    for row in rows:
        indexes.append({
            "name": row[0],
            "table": row[1],
            "sql": row[2],
        })
    
    return {"indexes": indexes, "count": len(indexes)}

