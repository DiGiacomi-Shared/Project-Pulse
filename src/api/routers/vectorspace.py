"""
VectorSpace visualizer endpoints for ACE memory data.
Includes relationship/edge computation for showing connections between memories.
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
from pydantic import BaseModel
import logging

from services.ace_client import get_ace_client

router = APIRouter()
logger = logging.getLogger(__name__)


class MemoryPoint(BaseModel):
    id: int
    doc_id: str
    content_summary: str
    namespace: str
    category: str
    source: Optional[str] = None
    importance: float = 1.0
    tags: list = []
    access_count: int = 0
    created_at: Optional[str] = None


class VectorSpaceResponse(BaseModel):
    points: list
    projections: list
    count: int
    error: Optional[str] = None


class EdgeItem(BaseModel):
    source: int
    target: int
    similarity: float


class RelationshipsResponse(BaseModel):
    edges: List[EdgeItem]
    count: int
    threshold: float
    error: Optional[str] = None


class ExplicitEdgeItem(BaseModel):
    source_doc_id: str
    target_doc_id: str
    rel_type: str
    source_summary: str
    target_summary: str


class ExplicitRelationshipsResponse(BaseModel):
    relationships: List[ExplicitEdgeItem]
    count: int
    error: Optional[str] = None


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10
    namespace: Optional[str] = None


class SearchResultItem(BaseModel):
    id: int
    doc_id: str
    content: str
    namespace: str
    category: str
    source: Optional[str] = None
    importance: Optional[float] = None
    tags: list = []
    similarity: float


class SearchResponse(BaseModel):
    query: str
    results: list
    total: int
    error: Optional[str] = None


@router.get("/vectorspace/stats")
async def get_vectorspace_stats():
    """Get ACE memory statistics."""
    client = get_ace_client()
    return client.get_stats()


@router.get("/vectorspace/projections", response_model=VectorSpaceResponse)
async def get_projections(
    namespace: Optional[str] = Query(None, description="Filter by namespace"),
    refresh: bool = Query(False, description="Force recompute UMAP projection"),
):
    """
    Get UMAP 2D projections for all memories.

    Returns point metadata + 2D coordinates for scatter plot rendering.
    Results are cached unless ?refresh=true.
    """
    client = get_ace_client()
    result = client.get_all_embeddings(namespace=namespace)

    if result.get("error") and not result.get("points"):
        raise HTTPException(status_code=503, detail=result["error"])

    return VectorSpaceResponse(
        points=result.get("points", []),
        projections=result.get("projections", []),
        count=result.get("count", 0),
        error=result.get("error"),
    )


@router.get("/vectorspace/relationships", response_model=RelationshipsResponse)
async def get_relationships(
    namespace: Optional[str] = Query(None, description="Filter by namespace"),
    threshold: float = Query(0.65, description="Minimum cosine similarity for an edge"),
):
    """
    Compute relationship edges between memories based on cosine similarity.

    Returns pairs of memory IDs whose embeddings are above the similarity threshold.
    Used to draw connection lines on the VectorSpace scatter plot.
    """
    client = get_ace_client()
    result = client.compute_relationships(namespace=namespace, threshold=threshold)

    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])

    return RelationshipsResponse(
        edges=[EdgeItem(**e) for e in result.get("edges", [])],
        count=result.get("count", 0),
        threshold=result.get("threshold", threshold),
        error=result.get("error"),
    )


@router.get("/vectorspace/explicit-relationships", response_model=ExplicitRelationshipsResponse)
async def get_explicit_relationships():
    """
    Get explicit relationships from the ACE relationships table.

    Returns relationships with doc_ids and content summaries, suitable for
    rendering as labeled dashed edges on the VectorSpace visualization.
    """
    client = get_ace_client()
    result = client.get_explicit_relationships()

    return ExplicitRelationshipsResponse(
        relationships=[ExplicitEdgeItem(**r) for r in result],
        count=len(result),
    )


@router.post("/vectorspace/search", response_model=SearchResponse)
async def search_vectorspace(request: SearchRequest):
    """
    Semantic search against ACE memories using Ollama nomic-embed-text.
    Returns matching memories with similarity scores.
    """
    client = get_ace_client()
    result = client.search(
        query=request.query,
        top_k=request.top_k,
        namespace=request.namespace,
    )

    return SearchResponse(
        query=result.get("query", request.query),
        results=result.get("results", []),
        total=result.get("total", 0),
        error=result.get("error"),
    )


@router.get("/vectorspace/memory/{memory_id}")
async def get_memory_detail(memory_id: int):
    """Get full details for a single memory."""
    client = get_ace_client()
    result = client.get_memory(memory_id)
    if not result:
        raise HTTPException(status_code=404, detail="Memory not found")
    return result


@router.get("/vectorspace/namespaces")
async def get_namespaces():
    """Get list of distinct namespaces in ACE."""
    client = get_ace_client()
    stats = client.get_stats()
    if "error" in stats:
        raise HTTPException(status_code=503, detail=stats["error"])
    return {
        "namespaces": list(stats.get("by_namespace", {}).keys()),
        "counts": stats.get("by_namespace", {}),
    }


@router.get("/vectorspace/categories")
async def get_categories():
    """Get list of distinct categories in ACE."""
    client = get_ace_client()
    stats = client.get_stats()
    if "error" in stats:
        raise HTTPException(status_code=503, detail=stats["error"])
    return {
        "categories": list(stats.get("by_category", {}).keys()),
        "counts": stats.get("by_category", {}),
    }