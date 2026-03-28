"""
Repository endpoints
"""

from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()


class Repo(BaseModel):
    id: int
    name: str
    owner: str
    url: str
    last_commit_at: Optional[datetime] = None
    open_prs: int = 0


class Activity(BaseModel):
    id: int
    repo_id: int
    type: str  # commit, pr, issue
    title: str
    author: str
    created_at: datetime


@router.get("/repos", response_model=List[Repo])
async def list_repos():
    """List all monitored repositories"""
    # TODO: Query database
    return []


@router.get("/repos/{repo_id}/activity", response_model=List[Activity])
async def get_repo_activity(repo_id: int):
    """Get activity feed for a repository"""
    # TODO: Query database
    return []


@router.get("/repos/{repo_id}/prs")
async def get_repo_prs(repo_id: int):
    """Get open pull requests for a repository"""
    # TODO: Query database
    return []
