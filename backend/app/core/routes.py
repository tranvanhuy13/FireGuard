import logging
from fastapi import APIRouter, HTTPException
from app.db.repositories import operations as database

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health/ready")
def database_readiness():
    try:
        database.init_db()
    except Exception:
        logger.warning("Database readiness check failed")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ready", "database": "mysql"}


@router.get("/")
def read_root():
    return {"status": "ok", "message": "Fire Detection System API is running"}
