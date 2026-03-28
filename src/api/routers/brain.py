"""
Brain (ChromaDB) integration endpoints
"""

from fastapi import APIRouter, Query
from typing import List, Optional
from pydantic import BaseModel

router = APIRouter()


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
    # TODO: Connect to Brain
    return BrainSearchResponse(
        query=q,
        results=[],
        total=0
    )


@router.get("/brain/projects/{project_name}/context")
async def get_project_context(project_name: str):
    """Get context for a specific project"""
    # TODO: Query Brain for project context
    return {"project": project_name, "files": []}
