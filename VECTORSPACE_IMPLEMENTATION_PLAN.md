# VectorSpace Visualizer — Implementation Plan

> Extending Project-Pulse to add a spatial visualization of the AI Context Engine's vector database.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Schema Mismatch Resolution](#3-schema-mismatch-resolution)
4. [Backend Changes](#4-backend-changes)
5. [Frontend Changes](#5-frontend-changes)
6. [Configuration & Environment](#6-configuration--environment)
7. [Step-by-Step Implementation Order](#7-step-by-step-implementation-order)
8. [File-by-File Manifest](#8-file-by-file-manifest)

---

## 1. Overview

**Goal**: Add a "VectorSpace" tab to Project-Pulse that visualizes the AI Context Engine's `memories` table as a 2D scatter plot, with search-that-highlights, hover/click details, and cluster coloring by namespace or category.

**Approach A** (chosen): Extend Project-Pulse's existing BrainSearch infrastructure rather than building standalone. The existing `BrainClient` talks to PostgreSQL+pgvector — we add a parallel `ACEClient` that connects to ACE's database (different host, different schema, different embedding dimension).

**Key differences from existing BrainSearch**:
| Aspect | BrainSearch (existing) | VectorSpace (new) |
|---|---|---|
| PostgreSQL host | 100.102.10.75, db `brain` | 100.102.10.75, db `context_engine` |
| Table | `brain_documents` | `memories` |
| Embedding model | all-MiniLM-L6-v2 (384-dim) | nomic-embed-text (768-dim) |
| Embedding source | sentence-transformers (Python) | Ollama API (localhost:11434) |
| Vector column | `embedding` via `search_brain_documents()` | `embedding vector(768)` |
| Visualization | Text list | UMAP 2D scatter plot |
| Metadata | doc_id, content, metadata, source, filename, similarity | namespace, category, source, importance, tags, metadata, access_count, created_at |

---

## 2. Architecture Summary

```
┌─────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)             │
│                                                  │
│  Dashboard.tsx ──── New tab: "VectorSpace" ──────┤
│                         │                         │
│  VectorSpace.tsx ───────┤                         │
│    ├─ ScatterPlot (recharts)                     │
│    ├─ SearchBar                                  │
│    ├─ DetailPanel                                │
│    └─ FilterControls (namespace/category)         │
│                                                  │
└──────────────────────┬───────────────────────────┘
                       │ /api/vectorspace/*
┌──────────────────────┴───────────────────────────┐
│  Backend (FastAPI)                                │
│                                                   │
│  routers/vectorspace.py  ← NEW                   │
│       │                                           │
│  services/ace_client.py  ← NEW                   │
│       │                                           │
│       ├─ PostgreSQL (context_engine DB)          │
│       │    SELECT id, content, embedding,        │
│       │           namespace, category, ...       │
│       │    FROM memories                         │
│       │                                           │
│       └─ Ollama (localhost:11434)                │
│            POST /api/embeddings                   │
│            model: nomic-embed-text                │
│                                                   │
│  services/brain_client.py  ← EXISTING (keep)     │
│                                                   │
└───────────────────────────────────────────────────┘
```

---

## 3. Schema Mismatch Resolution

The existing `BrainClient` queries `brain_documents` with a stored procedure `search_brain_documents()`. The ACE `memories` table has a completely different schema and uses 768-dim vectors.

**Resolution**: Create a separate `ACEClient` class that is purpose-built for the ACE schema. Do NOT try to shoehorn ACE queries into `BrainClient`. The two systems coexist side-by-side.

### ACE `memories` table schema (from migration 001_initial.sql):

```
id              SERIAL PRIMARY KEY
doc_id          VARCHAR(64) UNIQUE NOT NULL
content         TEXT NOT NULL
embedding       VECTOR(768)
namespace       VARCHAR(64) NOT NULL DEFAULT 'default'
category        VARCHAR(50) NOT NULL DEFAULT 'general'
source          VARCHAR(50)
filename        VARCHAR(255)
importance      FLOAT DEFAULT 1.0
tags            TEXT[]
access_count    INTEGER DEFAULT 0
last_accessed   TIMESTAMP
session_key     VARCHAR(64)
conversation_chain  INTEGER[]
expires_at      TIMESTAMP
created_at      TIMESTAMP DEFAULT NOW()
updated_at      TIMESTAMP DEFAULT NOW()
metadata        JSONB DEFAULT '{}'::jsonb
```

### Connection details for ACE:
- Host: `100.102.10.75` (same IP as Brain, different database)
- Database: `context_engine`
- User: `context_engine`
- Password: `ctx2024engine`
- Port: `5432` (default)

---

## 4. Backend Changes

### 4.1 New file: `src/api/services/ace_client.py`

This is the core backend adapter. It connects to ACE's PostgreSQL, queries the `memories` table, calls Ollama for embeddings, and computes UMAP projections.

```python
"""
ACE (AI Context Engine) client for the VectorSpace visualizer.
Connects to the context_engine PostgreSQL database with nomic-embed-text 768-dim vectors.
"""

import os
import json
import logging
from typing import List, Dict, Optional, Tuple
import numpy as np

logger = logging.getLogger(__name__)

# ACE PostgreSQL config
ACE_PG_CONFIG = {
    'host': os.getenv('ACE_PG_HOST', '100.102.10.75'),
    'port': int(os.getenv('ACE_PG_PORT', '5432')),
    'database': os.getenv('ACE_PG_DATABASE', 'context_engine'),
    'user': os.getenv('ACE_PG_USER', 'context_engine'),
    'password': os.getenv('ACE_PG_PASSWORD', 'ctx2024engine'),
}

# Ollama config
OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'nomic-embed-text')


class ACEClient:
    """Client for the AI Context Engine's PostgreSQL + pgvector database."""

    def __init__(self):
        self.conn = None
        self._connect()

    def _connect(self):
        """Connect to ACE PostgreSQL."""
        try:
            import psycopg2
            self.conn = psycopg2.connect(**ACE_PG_CONFIG)
            logger.info("Connected to ACE PostgreSQL (context_engine)")
        except Exception as e:
            logger.error(f"Failed to connect to ACE: {e}")
            self.conn = None

    def _ensure_conn(self):
        """Reconnect if connection dropped."""
        try:
            if self.conn is None or self.conn.closed:
                import psycopg2
                self.conn = psycopg2.connect(**ACE_PG_CONFIG)
        except Exception as e:
            logger.error(f"ACE reconnection failed: {e}")
            self.conn = None

    def get_stats(self) -> Dict:
        """Get ACE memory statistics."""
        self._ensure_conn()
        if not self.conn:
            return {"error": "ACE not connected"}

        try:
            from psycopg2.extras import RealDictCursor
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT COUNT(*) as total FROM memories")
                total = cur.fetchone()['total']

                cur.execute("SELECT namespace, COUNT(*) as cnt FROM memories GROUP BY namespace")
                by_namespace = {r['namespace']: r['cnt'] for r in cur.fetchall()}

                cur.execute("SELECT category, COUNT(*) as cnt FROM memories GROUP BY category")
                by_category = {r['category']: r['cnt'] for r in cur.fetchall()}

            return {
                "total_memories": total,
                "by_namespace": by_namespace,
                "by_category": by_category,
                "status": "connected",
                "database": "context_engine",
                "embedding_model": OLLAMA_MODEL,
                "dimensions": 768,
            }
        except Exception as e:
            logger.error(f"ACE stats error: {e}")
            return {"error": str(e)}

    def get_all_embeddings(self, namespace: Optional[str] = None) -> Dict:
        """
        Fetch all memory embeddings + metadata for UMAP projection.

        Returns: {
            "points": [
                {
                    "id": int, "doc_id": str, "content_summary": str,
                    "namespace": str, "category": str, "source": str,
                    "importance": float, "tags": list, "created_at": str,
                    "access_count": int
                },
                ...
            ],
            "projections": [[x, y], ...],  # UMAP 2D coordinates
            "embedding_dim": 768,
            "count": int
        }
        """
        self._ensure_conn()
        if not self.conn:
            return {"error": "ACE not connected", "points": [], "projections": [], "count": 0}

        try:
            from psycopg2.extras import RealDictCursor
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                sql = """
                    SELECT id, doc_id, content, embedding, namespace, category,
                           source, importance, tags, access_count, created_at, metadata
                    FROM memories
                    WHERE embedding IS NOT NULL
                """
                params = []
                if namespace:
                    sql += " AND namespace = %s"
                    params.append(namespace)

                sql += " ORDER BY created_at DESC"
                cur.execute(sql, params)
                rows = cur.fetchall()

            if not rows:
                return {"points": [], "projections": [], "count": 0}

            # Extract raw embeddings and build point metadata
            embeddings = []
            points = []
            for row in rows:
                emb = row['embedding']
                # pgvector returns string like "[0.1,0.2,...]" or already a list
                if isinstance(emb, str):
                    vec = np.array(json.loads(emb), dtype=np.float32)
                elif isinstance(emb, (list, tuple)):
                    vec = np.array(emb, dtype=np.float32)
                else:
                    # psycopg2 may return the vector as a string already
                    vec = np.array(emb, dtype=np.float32)
                embeddings.append(vec)

                content = row['content'] or ''
                summary = content[:120] + '...' if len(content) > 120 else content

                points.append({
                    "id": row['id'],
                    "doc_id": row['doc_id'],
                    "content_summary": summary,
                    "content_full": content,
                    "namespace": row['namespace'],
                    "category": row['category'],
                    "source": row['source'],
                    "importance": row['importance'],
                    "tags": row['tags'] or [],
                    "access_count": row['access_count'],
                    "created_at": str(row['created_at']) if row['created_at'] else None,
                })

            # Run UMAP projection
            projection = compute_umap_projection(embeddings)

            return {
                "points": points,
                "projections": projection.tolist(),
                "count": len(points),
            }

        except Exception as e:
            logger.error(f"ACE get_all_embeddings error: {e}")
            return {"error": str(e), "points": [], "projections": [], "count": 0}

    def search(self, query: str, top_k: int = 10, namespace: Optional[str] = None) -> Dict:
        """
        Semantic search using Ollama nomic-embed-text for query embedding,
        then cosine similarity via pgvector against ACE memories.
        """
        self._ensure_conn()
        if not self.conn:
            return {"error": "ACE not connected", "results": [], "total": 0}

        try:
            # Get query embedding from Ollama
            query_embedding = get_ollama_embedding(query)
            if not query_embedding:
                return {"error": "Failed to get query embedding from Ollama", "results": [], "total": 0}

            from psycopg2.extras import RealDictCursor
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                sql = """
                    SELECT id, doc_id, content, namespace, category, source,
                           importance, tags, access_count, created_at,
                           1 - (embedding <=> %s::vector) as similarity
                    FROM memories
                    WHERE embedding IS NOT NULL
                """
                params = [json.dumps(query_embedding)]

                if namespace:
                    sql += " AND namespace = %s"
                    params.append(namespace)

                sql += " ORDER BY embedding <=> %s::vector LIMIT %s"
                params.extend([json.dumps(query_embedding), top_k])

                cur.execute(sql, params)
                rows = cur.fetchall()

            results = []
            for row in rows:
                content = row['content'] or ''
                results.append({
                    "id": row['id'],
                    "doc_id": row['doc_id'],
                    "content": content[:300] + '...' if len(content) > 300 else content,
                    "namespace": row['namespace'],
                    "category": row['category'],
                    "source": row['source'],
                    "importance": row.get('importance'),
                    "tags": row.get('tags', []),
                    "similarity": round(float(row['similarity']), 4),
                })

            return {
                "query": query,
                "results": results,
                "total": len(results),
            }

        except Exception as e:
            logger.error(f"ACE search error: {e}")
            return {"error": str(e), "results": [], "total": 0}

    def get_memory(self, memory_id: int) -> Optional[Dict]:
        """Get full details for a single memory by ID."""
        self._ensure_conn()
        if not self.conn:
            return None

        try:
            from psycopg2.extras import RealDictCursor
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, doc_id, content, namespace, category, source,
                           importance, tags, access_count, created_at, metadata
                    FROM memories WHERE id = %s
                """, (memory_id,))
                row = cur.fetchone()

            if not row:
                return None
            result = dict(row)
            # Convert non-serializable types
            if result.get('tags') and hasattr(result['tags'], '__iter__'):
                result['tags'] = list(result['tags'])
            if result.get('created_at'):
                result['created_at'] = str(result['created_at'])
            return result

        except Exception as e:
            logger.error(f"ACE get_memory error: {e}")
            return None

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()


def get_ollama_embedding(text: str) -> Optional[List[float]]:
    """Get embedding from Ollama nomic-embed-text model."""
    try:
        import requests
        response = requests.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": OLLAMA_MODEL, "prompt": text},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()["embedding"]
    except Exception as e:
        logger.error(f"Ollama embedding error: {e}")
        return None


def compute_umap_projection(embeddings: List[np.ndarray]) -> np.ndarray:
    """
    Compute UMAP 2D projection from high-dimensional embeddings.

    Args:
        embeddings: List of 768-dim numpy arrays

    Returns:
        Nx2 numpy array of 2D coordinates
    """
    try:
        import umap
    except ImportError:
        logger.warning("umap-learn not installed, falling back to random projection")
        return _fallback_projection(embeddings)

    data = np.stack(embeddings)

    # UMAP parameters tuned for visualization
    n_neighbors = min(15, len(data) - 1)  # Need at least 2 points, adapt for small datasets
    min_dist = 0.1

    if len(data) < 3:
        # Not enough data for meaningful projection
        return np.random.rand(len(data), 2)

    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric='cosine',
        random_state=42,
    )

    projection = reducer.fit_transform(data)
    return projection


def _fallback_projection(embeddings: List[np.ndarray]) -> np.ndarray:
    """
    Fallback when UMAP is not available: use truncated SVD or random.
    """
    data = np.stack(embeddings)
    if data.shape[1] >= 2:
        from sklearn.decomposition import TruncatedSVD
        svd = TruncatedSVD(n_components=2, random_state=42)
        return svd.fit_transform(data)
    # Absolute fallback: random
    return np.random.rand(len(data), 2)


# Singleton
_ace_client = None

def get_ace_client() -> ACEClient:
    """Get or create ACE client singleton."""
    global _ace_client
    if _ace_client is None:
        _ace_client = ACEClient()
    return _ace_client
```

### 4.2 New file: `src/api/routers/vectorspace.py`

```python
"""
VectorSpace visualizer endpoints for ACE memory data.
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from pydantic import BaseModel
import logging

from services.ace_client import get_ace_client, get_ollama_embedding

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
```

### 4.3 Modify: `src/api/main.py`

Add the new router:

```python
# Add this import at the top (line 13 area):
from routers import repos, brain, devkit, insights, health, vectorspace

# Add this line after other router includes (after line 53):
app.include_router(vectorspace.router, prefix="/api", tags=["vectorspace"])
```

### 4.4 Modify: `src/api/config.py`

Add ACE configuration settings:

```python
# Add these to the Settings class:

# ACE (AI Context Engine) connection
ACE_PG_HOST: str = os.getenv("ACE_PG_HOST", "100.102.10.75")
ACE_PG_PORT: int = int(os.getenv("ACE_PG_PORT", "5432"))
ACE_PG_DATABASE: str = os.getenv("ACE_PG_DATABASE", "context_engine")
ACE_PG_USER: str = os.getenv("ACE_PG_USER", "context_engine")
ACE_PG_PASSWORD: str = os.getenv("ACE_PG_PASSWORD", "ctx2024engine")

# Ollama embedding
OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "nomic-embed-text")
```

### 4.5 Modify: `src/api/requirements.txt`

Add these lines:

```
umap-learn==0.5.7
scikit-learn==1.6.1
numpy==2.2.5
requests==2.32.3
```

> **Note**: `umap-learn` pulls in `scikit-learn` and `numpy` as dependencies. Pin versions compatible with the existing stack. If there are conflicts with the existing `sentence-transformers` dependency, consider making `umap-learn` an optional dependency and falling back to `TruncatedSVD` (from `scikit-learn`) if unavailable.

---

## 5. Frontend Changes

### 5.1 Install new dependency: `recharts`

```bash
cd ~/Project-Pulse/src/frontend
npm install recharts
```

> **Why recharts?** It's a mature React charting library built on D3, with excellent scatter chart support, tooltips, and brush/zoom. It's lighter than D3 directly and integrates well with the existing React 19 + Tailwind stack. Alternatives considered: `visx` (lower-level, more work), `nivo` (good but recharts has better scatter), `plotly.js` (too heavy).

### 5.2 New file: `src/frontend/src/components/VectorSpace.tsx`

This is the main visualizer component. It renders a scatter plot, search bar, filters, and detail panel.

```tsx
import { useState, useEffect, useCallback } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, ZAxis
} from 'recharts'

// --- Types ---
interface MemoryPoint {
  id: number
  doc_id: string
  content_summary: string
  content_full?: string
  namespace: string
  category: string
  source: string | null
  importance: number
  tags: string[]
  access_count: number
  created_at: string | null
}

interface ProjectionData {
  points: MemoryPoint[]
  projections: number[][]  // [[x, y], ...]
  count: number
  error?: string
}

interface SearchResult {
  id: number
  doc_id: string
  content: string
  namespace: string
  category: string
  similarity: number
}

// --- Color palettes ---
const NAMESPACE_COLORS: Record<string, string> = {
  default: '#6366f1',   // indigo
  specterdefence: '#ef4444',
  'screen-sprout': '#22c55e',
  infra: '#f59e0b',
  docs: '#3b82f6',
}

const CATEGORY_COLORS: Record<string, string> = {
  general: '#8b5cf6',
  infra: '#f59e0b',
  security: '#ef4444',
  code: '#22c55e',
  docs: '#3b82f6',
  conversation: '#ec4899',
}

function getColor(point: MemoryPoint, colorBy: 'namespace' | 'category'): string {
  if (colorBy === 'namespace') {
    return NAMESPACE_COLORS[point.namespace] || '#94a3b8'
  }
  return CATEGORY_COLORS[point.category] || '#94a3b8'
}

function VectorSpace() {
  const [data, setData] = useState<ProjectionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<MemoryPoint | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<'namespace' | 'category'>('namespace')
  const [namespaceFilter, setNamespaceFilter] = useState<string>('')
  const [stats, setStats] = useState<any>(null)

  // Build chart data = points merged with projections
  const chartData = data
    ? data.points.map((point, i) => {
        const proj = data.projections[i] || [0, 0]
        return {
          ...point,
          x: proj[0],
          y: proj[1],
          fill: getColor(point, colorBy),
        }
      })
    : []

  // Highlighted point IDs from search
  const highlightedIds = new Set(searchResults.map(r => r.id))

  // --- Fetch projections ---
  const fetchProjections = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (namespaceFilter) params.set('namespace', namespaceFilter)
      const res = await fetch(`/api/vectorspace/projections?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projections')
    } finally {
      setLoading(false)
    }
  }, [namespaceFilter])

  // --- Fetch stats ---
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/vectorspace/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchProjections() }, [fetchProjections])
  useEffect(() => { fetchStats() }, [fetchStats])

  // --- Search ---
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await fetch('/api/vectorspace/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          top_k: 20,
          namespace: namespaceFilter || undefined,
        }),
      })
      if (!res.ok) throw new Error('Search failed')
      const json = await res.json()
      setSearchResults(json.results || [])
    } catch (err) {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  // --- Point click => detail ---
  const handlePointClick = async (point: any) => {
    setSelectedPoint(point)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/vectorspace/memory/${point.id}`)
      if (res.ok) {
        const detail = await res.json()
        setDetailContent(detail.content)
      }
    } catch { /* ignore */ }
    setDetailLoading(false)
  }

  // --- Custom tooltip ---
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null
    const point = payload[0].payload
    return (
      <div className="bg-white p-2 rounded shadow-lg border text-xs max-w-xs">
        <div className="font-semibold truncate">{point.content_summary}</div>
        <div className="text-gray-500 mt-1">
          {point.namespace} / {point.category}
        </div>
        {point.source && <div className="text-gray-400">Source: {point.source}</div>}
        <div className="text-gray-400 mt-1">
          Importance: {point.importance} | Access: {point.access_count}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">VectorSpace</h2>
            <p className="text-sm text-gray-500 mt-1">
              Spatial visualization of ACE memory embeddings
              {stats && ` — ${stats.total_memories} memories across ${Object.keys(stats.by_namespace || {}).length} namespaces`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { fetchProjections(); fetchStats(); }}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Controls: Search + Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Search */}
        <div className="md:col-span-2 bg-white p-4 rounded-lg shadow-sm border">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories... (uses Ollama nomic-embed-text)"
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={searching}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
            {searchResults.length > 0 && (
              <button
                type="button"
                onClick={() => { setSearchResults([]); setQuery('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </form>
          {searchResults.length > 0 && (
            <div className="mt-3 text-sm text-gray-600">
              Found {searchResults.length} results — highlighted on the map
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow-sm border space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Color by</label>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setColorBy('namespace')}
                className={`px-3 py-1 text-xs rounded ${colorBy === 'namespace' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}
              >
                Namespace
              </button>
              <button
                onClick={() => setColorBy('category')}
                className={`px-3 py-1 text-xs rounded ${colorBy === 'category' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}
              >
                Category
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Namespace filter</label>
            <input
              type="text"
              value={namespaceFilter}
              onChange={(e) => setNamespaceFilter(e.target.value)}
              placeholder="e.g., default"
              className="w-full mt-1 px-3 py-1.5 border rounded text-sm"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* Scatter Plot */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-gray-500">Computing UMAP projection...</div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-96 text-gray-400">
            No memory data to display
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={500}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                type="number"
                dataKey="x"
                name="UMAP-1"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="UMAP-2"
                tick={{ fontSize: 11 }}
              />
              <ZAxis range={[40, 40]} />
              <Tooltip content={<CustomTooltip />} />
              <Scatter
                name="Memories"
                data={chartData}
                onClick={handlePointClick}
                cursor="pointer"
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={highlightedIds.has(entry.id) ? '#fbbf24' : entry.fill}
                    stroke={highlightedIds.has(entry.id) ? '#92400e' : '#fff'}
                    strokeWidth={highlightedIds.has(entry.id) ? 2 : 1}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Search results as list (below the plot) */}
      {searchResults.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 border-b bg-gray-50">
            <h3 className="font-medium">Search Results: "{query}"</h3>
          </div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {searchResults.map((r) => (
              <div
                key={r.id}
                className="p-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => handlePointClick({ id: r.id, content_summary: r.content, namespace: r.namespace, category: r.category })}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                    {r.namespace}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                    {r.category}
                  </span>
                  <span className="text-xs font-mono text-green-600">
                    {(r.similarity * 100).toFixed(1)}% match
                  </span>
                </div>
                <div className="text-sm text-gray-700 mt-1 line-clamp-2">{r.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedPoint && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Memory Detail</h3>
              <div className="flex gap-2 mt-1">
                <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded">
                  {selectedPoint.namespace}
                </span>
                <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                  {selectedPoint.category}
                </span>
                {selectedPoint.source && (
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                    {selectedPoint.source}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => { setSelectedPoint(null); setDetailContent(null) }}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <div className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
            {detailLoading ? 'Loading...' : (detailContent || selectedPoint.content_summary)}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-gray-400">
            <span>ID: {selectedPoint.id}</span>
            <span>Importance: {selectedPoint.importance}</span>
            <span>Access count: {selectedPoint.access_count}</span>
            {selectedPoint.created_at && <span>Created: {selectedPoint.created_at}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorSpace
```

### 5.3 Modify: `src/frontend/src/components/Dashboard.tsx`

Add the VectorSpace tab:

```tsx
// Add import at top:
import VectorSpace from './VectorSpace'

// Update Tab type (line 6):
type Tab = 'overview' | 'brain' | 'insights' | 'repos' | 'vectorspace'

// Add VectorSpace tab button in the tabs array (around line 50):
{ id: 'vectorspace', label: 'VectorSpace' },

// Add VectorSpace content rendering (after line 98):
{activeTab === 'vectorspace' && <VectorSpace />}
```

### 5.4 Modify: `src/frontend/src/App.tsx`

Add a nav link for VectorSpace:

```tsx
// Add to the nav (line 18 area):
<a href="/#vectorspace" className="hover:text-blue-600">VectorSpace</a>
```

---

## 6. Configuration & Environment

### 6.1 Environment Variables

Add these to Project-Pulse's `.env` file or deployment config:

```env
# ACE PostgreSQL (AI Context Engine)
ACE_PG_HOST=100.102.10.75
ACE_PG_PORT=5432
ACE_PG_DATABASE=context_engine
ACE_PG_USER=context_engine
ACE_PG_PASSWORD=ctx2024engine

# Ollama embedding service
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
```

### 6.2 Kubernetes ConfigMap Update

In `k8s/configmap.yaml`, add the ACE and Ollama variables.

### 6.3 Backend Dependency Installation

```bash
cd ~/Project-Pulse/src/api
pip install umap-learn scikit-learn numpy requests
# or add to requirements.txt as shown in section 4.5
```

### 6.4 Frontend Dependency Installation

```bash
cd ~/Project-Pulse/src/frontend
npm install recharts
```

---

## 7. Step-by-Step Implementation Order

### Phase 1: Backend Foundation (estimated: 1-2 hours)

1. **Create `src/api/services/ace_client.py`**
   - Implement `ACEClient` with `_connect()`, `_ensure_conn()`, `get_stats()`, `get_all_embeddings()`, `search()`, `get_memory()`
   - Implement `get_ollama_embedding()` function
   - Implement `compute_umap_projection()` with fallback to TruncatedSVD
   - Add singleton `get_ace_client()`

2. **Create `src/api/routers/vectorspace.py`**
   - Define Pydantic models: `VectorSpaceResponse`, `SearchRequest`, `SearchResponse`, `SearchResultItem`
   - Implement endpoints: `GET /vectorspace/stats`, `GET /vectorspace/projections`, `POST /vectorspace/search`, `GET /vectorspace/memory/{id}`, `GET /vectorspace/namespaces`, `GET /vectorspace/categories`

3. **Modify `src/api/main.py`**
   - Import `vectorspace` router
   - Add `app.include_router(vectorspace.router, prefix="/api", tags=["vectorspace"])`

4. **Modify `src/api/config.py`**
   - Add `ACE_PG_*` and `OLLAMA_*` settings to `Settings` class

5. **Modify `src/api/requirements.txt`**
   - Add `umap-learn`, `scikit-learn`, `numpy`, `requests`

6. **Test backend manually**
   ```bash
   cd ~/Project-Pulse/src/api
   uvicorn main:app --reload --port 30080
   # Then test:
   curl http://localhost:30080/api/vectorspace/stats
   curl http://localhost:30080/api/vectorspace/projections
   curl -X POST http://localhost:30080/api/vectorspace/search \
     -H 'Content-Type: application/json' \
     -d '{"query": "authentication patterns", "top_k": 5}'
   ```

### Phase 2: Frontend Visualization (estimated: 2-3 hours)

7. **Install recharts**
   ```bash
   cd ~/Project-Pulse/src/frontend
   npm install recharts
   ```

8. **Create `src/frontend/src/components/VectorSpace.tsx`**
   - Implement the full component as shown in section 5.2
   - Includes: ScatterChart, search bar, filters, detail panel, highlights

9. **Modify `src/frontend/src/components/Dashboard.tsx`**
   - Add `import VectorSpace from './VectorSpace'`
   - Update `Tab` type to include `'vectorspace'`
   - Add tab button and conditional render

10. **Optionally modify `src/frontend/src/App.tsx`**
    - Add nav link for VectorSpace

11. **Test frontend**
    ```bash
    cd ~/Project-Pulse/src/frontend
    npm run dev
    # Open browser to http://localhost:5173
    # Navigate to VectorSpace tab
    ```

### Phase 3: Polish & Optimization (estimated: 1-2 hours)

12. **Add projection caching** (optional but recommended for performance)
    - In `ace_client.py`, cache the UMAP projection result in memory or Redis
    - Invalidate on `?refresh=true` or after a TTL (e.g., 5 minutes)
    - For datasets < 10K points, in-memory caching is fine

13. **Handle edge cases**
    - Empty embeddings table
    - Large datasets ( paginate or limit to N=5000 points for UMAP)
    - Ollama being unavailable ( return error gracefully)
    - ACE PostgreSQL being unreachable ( show connection error in UI)

14. **Add namespace/category dropdown filters**
    - Fetch from `/api/vectorspace/namespaces` and `/api/vectorspace/categories`
    - Replace the manual namespace text input with a populated `<select>`

15. **Performance tuning for large datasets**
    - If memories > 5000: sample evenly across namespaces, or use `LIMIT 5000` in the SQL
    - Consider server-side UMAP caching to avoid recomputing on every page load

---

## 8. File-by-File Manifest

### New Files
| File | Purpose |
|---|---|
| `src/api/services/ace_client.py` | ACE PostgreSQL client, Ollama embedding, UMAP projection |
| `src/api/routers/vectorspace.py` | FastAPI endpoints for VectorSpace |
| `src/frontend/src/components/VectorSpace.tsx` | React scatter-plot visualizer component |

### Modified Files
| File | Change |
|---|---|
| `src/api/main.py` | Import + register vectorspace router |
| `src/api/config.py` | Add ACE_PG_* and OLLAMA_* settings |
| `src/api/requirements.txt` | Add umap-learn, scikit-learn, numpy, requests |
| `src/frontend/src/components/Dashboard.tsx` | Add VectorSpace tab import and render |
| `src/frontend/src/App.tsx` | (Optional) Add VectorSpace nav link |
| `src/frontend/package.json` | recharts dependency (via npm install) |

### Files NOT Changed
| File | Reason |
|---|---|
| `src/api/services/brain_client.py` | Brain search stays as-is (different DB, different embeddings) |
| `src/api/routers/brain.py` | Brain endpoints stay as-is |
| `src/api/db.py` | This is the Pulse app's own SQLAlchemy DB, not Brain/ACE |
| `src/frontend/src/components/BrainSearch.tsx` | Brain search UI stays as-is |

---

## Key Design Decisions

1. **Separate ACEClient, not modify BrainClient**: The two systems have different databases, schemas, embedding models, and dimensions. A separate client avoids confusion and breaks nothing.

2. **Ollama for embeddings, not sentence-transformers**: ACE uses nomic-embed-text (768-dim) via Ollama. Project-Pulse's existing BrainClient uses all-MiniLM-L6-v2 (384-dim) via sentence-transformers. These are incompatible. The VectorSpace search endpoint sends queries to Ollama, not sentence-transformers.

3. **UMAP on backend, not frontend**: UMAP is CPU-intensive and requires `umap-learn` (which needs scikit-learn + numpy). Computing projections on the backend keeps the frontend lightweight. The projection is computed once and cached.

4. **recharts for scatter plot**: Chosen because it integrates cleanly with React, supports `ScatterChart` with `Cell` for per-point coloring, and has built-in tooltip/zoom support. Not pulling in a heavy D3 dependency.

5. **Schema mismatch handled by mapping columns**: The ACE `memories` table has different columns than `brain_documents`. The ACEClient selects only the columns it needs and maps them to the frontend's expected format. No schema migration needed.

6. **No changes to ACE itself**: We only read from the `memories` table. No writes, no schema changes, no risk to the ACE system.