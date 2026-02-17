"""API routes for database management and optimization."""

import logging
from fastapi import APIRouter

from services import db_optimize

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/db", tags=["database"])


@router.get("/stats")
async def get_database_stats():
    """Get database table statistics (row counts)."""
    return await db_optimize.get_table_stats()


@router.post("/optimize")
async def optimize_database():
    """Create composite indexes and update query planner statistics."""
    index_results = await db_optimize.create_indexes()
    analyze_results = await db_optimize.analyze_tables()
    return {"indexes": index_results, "analyze": analyze_results}


@router.post("/vacuum")
async def vacuum_database():
    """Run VACUUM to reclaim space. Can be slow on large databases."""
    success = await db_optimize.vacuum_database()
    return {"success": success, "message": "Database vacuumed successfully" if success else "Vacuum failed"}


@router.get("/indexes")
async def list_indexes():
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

    indexes = [{"name": r[0], "table": r[1], "sql": r[2]} for r in rows]
    return {"indexes": indexes, "count": len(indexes)}
