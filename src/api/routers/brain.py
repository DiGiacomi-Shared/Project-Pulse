"""
Brain (ChromaDB) integration endpoints
"""

from fastapi import APIRouter, Query
from typing import List, Optional
from pydantic import BaseModel
import logging

from services.brain_client import get_brain_client

router = APIRouter()
logger = logging.getLogger(__name__)


class BrainSearchResult(BaseModel):
    file: str
    relevance: float
    project: str


class BrainSearchResponse(BaseModel):
    query: str
    results: List[BrainSearchResult]
    total: int


@router.get("/brain/search", response_model=BrainSearchResponse)
async def search_brain(
    q: str = Query(..., description="Search query"),
    top_k: int = Query(5, ge=1, le=20)
):
    """
    Search the Brain (ChromaDB) for code, docs, and patterns.
    
    Examples:
    - auth patterns
    - impossible travel detection
    - K8s deployment
    """
    client = get_brain_client()
    results = client.search(q, top_k=top_k)
    
    if "error" in results and results["error"]:
        logger.error(f"Brain search error: {results['error']}")
    
    return BrainSearchResponse(
        query=q,
        results=results.get("results", []),
        total=results.get("total", 0)
    )


@router.get("/brain/stats")
async def get_brain_stats():
    """Get Brain statistics"""
    client = get_brain_client()
    return client.get_stats()


@router.get("/brain/projects/{project_name}/context")
async def get_project_context(project_name: str):
    """Get context for a specific project"""
    client = get_brain_client()
    
    # Search for project-specific patterns
    results = client.search(f"project {project_name}", top_k=10)
    
    return {
        "project": project_name,
        "document_count": results.get("total", 0),
        "files": [r["file"] for r in results.get("results", [])[:10]]
    }
