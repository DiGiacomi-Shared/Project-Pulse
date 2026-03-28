"""
Health check endpoints
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    version: str = "0.1.0"


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(status="healthy")


@router.get("/ready", response_model=HealthResponse)
async def readiness_check():
    """Readiness check - validates DB and external connections"""
    # TODO: Check DB connection
    # TODO: Check Brain connection
    # TODO: Check GitHub API
    return HealthResponse(status="ready")
