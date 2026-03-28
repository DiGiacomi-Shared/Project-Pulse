"""
Generated insights endpoints
"""

from fastapi import APIRouter
from typing import List
from pydantic import BaseModel
from datetime import datetime
import logging

from services.insight_generator import get_insight_generator

router = APIRouter()
logger = logging.getLogger(__name__)


class Insight(BaseModel):
    id: int
    type: str  # reminder, drift, pattern, alert
    title: str
    description: str
    severity: str  # info, warning, critical
    created_at: datetime
    read: bool = False


class HealthScore(BaseModel):
    project: str
    total_files: int
    documentation: int
    source_code: int
    tests: int
    health_score: int
    last_updated: str


@router.get("/insights", response_model=List[Insight])
async def get_insights(unread_only: bool = False):
    """
    Get generated insights.
    
    Types:
    - reminder: You mentioned doing X by date
    - drift: Architecture inconsistency detected
    - pattern: Cross-project code pattern found
    - alert: PR needs review, project idle, etc.
    """
    try:
        generator = get_insight_generator()
        insights = generator.generate_all()
        
        return [
            Insight(
                id=hash(i["title"]) % 10000,
                type=i["type"],
                title=i["title"],
                description=i["description"],
                severity=i["severity"],
                created_at=datetime.fromisoformat(i["created_at"]),
                read=False
            )
            for i in insights
        ]
    except Exception as e:
        logger.error(f"Failed to get insights: {e}")
        return []


@router.post("/insights/{insight_id}/read")
async def mark_insight_read(insight_id: int):
    """Mark an insight as read"""
    # TODO: Update database
    return {"status": "ok"}


@router.get("/insights/health/{project_name}", response_model=HealthScore)
async def get_project_health(project_name: str):
    """Get health score for a specific project"""
    try:
        generator = get_insight_generator()
        health = generator.get_project_health(project_name)
        return HealthScore(**health)
    except Exception as e:
        logger.error(f"Failed to get health: {e}")
        return HealthScore(
            project=project_name,
            total_files=0,
            documentation=0,
            source_code=0,
            tests=0,
            health_score=0,
            last_updated=datetime.utcnow().isoformat()
        )
