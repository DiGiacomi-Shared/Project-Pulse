"""
Repository endpoints
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import logging

from config import settings
from services.github_client import get_github_client, RepoSyncer
from tasks.sync_tasks import sync_github_repos

router = APIRouter()
logger = logging.getLogger(__name__)


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


class SyncResponse(BaseModel):
    status: str
    repos_synced: int
    repos: List[dict]


@router.get("/repos", response_model=List[Repo])
async def list_repos():
    """List all monitored repositories"""
    # Return repos from config (until DB is populated)
    repos = []
    for repo_str in settings.repo_list:
        if "/" in repo_str:
            owner, name = repo_str.split("/", 1)
            repos.append(Repo(
                id=hash(repo_str) % 10000,
                name=name,
                owner=owner,
                url=f"https://github.com/{repo_str}",
                open_prs=0  # Will be populated from DB
            ))
    return repos


@router.post("/repos/sync", response_model=SyncResponse)
async def trigger_sync(background_tasks: BackgroundTasks):
    """Trigger a sync of all configured repositories"""
    if not settings.repo_list:
        raise HTTPException(status_code=400, detail="No repos configured")
    
    # Queue sync task
    task = sync_github_repos.delay(settings.repo_list)
    
    return SyncResponse(
        status="queued",
        repos_synced=len(settings.repo_list),
        repos=[{"name": r, "task_id": task.id} for r in settings.repo_list]
    )


@router.get("/repos/{repo_id}/activity", response_model=List[Activity])
async def get_repo_activity(repo_id: int):
    """Get activity feed for a repository"""
    # TODO: Query database for real activity
    return []


@router.get("/repos/{repo_id}/prs")
async def get_repo_prs(repo_id: int):
    """Get open pull requests for a repository"""
    # TODO: Query database
    return []


@router.get("/repos/{owner}/{name}/sync")
async def sync_single_repo(owner: str, name: str):
    """Sync a single repository on demand"""
    try:
        client = get_github_client()
        syncer = RepoSyncer(client)
        result = await syncer.sync_repo(owner, name)
        await client.close()
        return result
    except Exception as e:
        logger.error(f"Sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
