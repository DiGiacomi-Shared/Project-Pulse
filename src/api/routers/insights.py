"""
Generated insights endpoints
"""

from fastapi import APIRouter
from typing import List
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()


class Insight(BaseModel):
    id: int
    type: str  # reminder, drift, pattern, alert
    title: str
    description: str
    severity: str  # info, warning, critical
    created_at: datetime
    read: bool = False


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
    # TODO: Query insights database
    return []


@router.post("/insights/{insight_id}/read")
async def mark_insight_read(insight_id: int):
    """Mark an insight as read"""
    # TODO: Update database
    return {"status": "ok"}
