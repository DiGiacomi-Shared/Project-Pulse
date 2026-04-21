"""
VectorSpace - ACE Memory Visualizer
FastAPI backend for visualizing Context Engine (ACE) memory embeddings
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import Optional, List
from pydantic import BaseModel
import logging
import psycopg2
import psycopg2.extras
import requests
import numpy as np

try:
    import umap
    UMAP_AVAILABLE = True
except ImportError:
    UMAP_AVAILABLE = False

from config import settings

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class ACEClient:
    """Direct client for ACE/Context Engine database"""
    
    def __init__(self):
        self.conn_string = f"postgresql://{settings.ACE_PG_USER}:{settings.ACE_PG_PASSWORD}@{settings.ACE_PG_HOST}:{settings.ACE_PG_PORT}/{settings.ACE_PG_DATABASE}"
    
    def _get_conn(self):
        return psycopg2.connect(self.conn_string)
    
    def get_stats(self):
        conn = self._get_conn()
        cur = conn.cursor()
        try:
            cur.execute("SELECT COUNT(*) FROM memories WHERE namespace='default' AND (expires_at IS NULL OR expires_at > NOW())")
            total = cur.fetchone()[0]
            cur.execute("SELECT namespace, COUNT(*) FROM memories WHERE expires_at IS NULL OR expires_at > NOW() GROUP BY namespace")
            by_namespace = dict(cur.fetchall())
            cur.execute("SELECT category, COUNT(*) FROM memories WHERE namespace='default' AND (expires_at IS NULL OR expires_at > NOW()) GROUP BY category")
            by_category = dict(cur.fetchall())
            return {"total_memories": total, "by_namespace": by_namespace, "by_category": by_category, "umap_available": UMAP_AVAILABLE}
        finally:
            cur.close()
            conn.close()
    
    def get_all_embeddings(self, namespace: Optional[str] = None, algorithm: str = "umap"):
        """Get embeddings projected to 2D using UMAP or PCA"""
        conn = self._get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            ns = namespace or 'default'
            cur.execute("""SELECT id, doc_id, content, namespace, category, source, importance, tags, access_count, embedding::text, created_at
                FROM memories WHERE (namespace=%s OR %s IS NULL) AND (expires_at IS NULL OR expires_at > NOW()) AND embedding IS NOT NULL""", (ns, ns if namespace else None))
            rows = cur.fetchall()
            
            if len(rows) < 2:
                return {"points": [], "projections": [], "count": 0, "algorithm": "none"}
            
            points, embeddings = [], []
            for row in rows:
                vec = [float(x) for x in row['embedding'].strip('[]').split(',')]
                embeddings.append(vec)
                points.append({
                    "id": row['id'],
                    "doc_id": row['doc_id'],
                    "content_summary": row['content'][:120] + "..." if len(row['content']) > 120 else row['content'],
                    "content_preview": row['content'][:300],
                    "namespace": row['namespace'],
                    "category": row['category'],
                    "source": row['source'],
                    "importance": float(row['importance'] or 1.0),
                    "tags": row['tags'] or [],
                    "access_count": row['access_count'] or 0,
                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                    "embedding": vec[:10]  # First 10 dims for client-side clustering
                })
            
            # Use UMAP if available and enough points, else PCA
            if algorithm == "umap" and UMAP_AVAILABLE and len(embeddings) >= 10:
                try:
                    reducer = umap.UMAP(n_neighbors=min(15, len(embeddings)-1), min_dist=0.1, metric='cosine', random_state=42)
                    projections = reducer.fit_transform(np.array(embeddings)).tolist()
                    used_algorithm = "umap"
                except Exception as e:
                    logger.warning(f"UMAP failed, falling back to PCA: {e}")
                    projections = self._compute_pca_projections(embeddings)
                    used_algorithm = "pca"
            else:
                projections = self._compute_pca_projections(embeddings)
                used_algorithm = "pca"
            
            return {"points": points, "projections": projections, "count": len(points), "algorithm": used_algorithm}
        finally:
            cur.close()
            conn.close()
    
    def _compute_pca_projections(self, embeddings: List[List[float]]) -> List[List[float]]:
        """Fallback PCA projection"""
        if len(embeddings) < 2:
            return [[0, 0] for _ in embeddings]
        X = np.array(embeddings)
        X_centered = X - np.mean(X, axis=0)
        try:
            U, S, _ = np.linalg.svd(X_centered, full_matrices=False)
            return (U[:, :2] * S[:2]).tolist()
        except:
            return [[e[0] if len(e) > 0 else 0, e[1] if len(e) > 1 else 0] for e in embeddings]
    
    def compute_relationships(self, namespace=None, threshold=0.65, max_edges=500):
        """Compute similarity-based edges between memories"""
        conn = self._get_conn()
        cur = conn.cursor()
        try:
            ns = namespace or 'default'
            cur.execute("SELECT id, embedding::text FROM memories WHERE (namespace=%s OR %s IS NULL) AND (expires_at IS NULL OR expires_at > NOW()) AND embedding IS NOT NULL", (ns, ns if namespace else None))
            rows = cur.fetchall()
            
            embeddings = {r[0]: np.array([float(x) for x in r[1].strip('[]').split(',')]) for r in rows}
            edges = []
            ids = list(embeddings.keys())
            
            # Sample if too many points
            if len(ids) > 200:
                import random
                random.seed(42)
                ids = random.sample(ids, 200)
            
            for i, id1 in enumerate(ids):
                for id2 in ids[i+1:]:
                    v1, v2 = embeddings[id1], embeddings[id2]
                    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
                    if n1 > 0 and n2 > 0:
                        sim = float(np.dot(v1, v2) / (n1 * n2))
                        if sim >= threshold:
                            edges.append({"source": id1, "target": id2, "similarity": round(sim, 3)})
                            if len(edges) >= max_edges:
                                return {"edges": edges, "count": len(edges), "threshold": threshold}
            return {"edges": edges, "count": len(edges), "threshold": threshold}
        finally:
            cur.close()
            conn.close()
    
    def get_explicit_relationships(self):
        conn = self._get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cur.execute("""SELECT r.source_id, r.target_id, r.rel_type, s.doc_id as source_doc_id, s.content as source_content,
                t.doc_id as target_doc_id, t.content as target_content FROM relationships r
                JOIN memories s ON r.source_id=s.id JOIN memories t ON r.target_id=t.id WHERE s.namespace='default' AND t.namespace='default'""")
            return [{"source_doc_id": r['source_doc_id'], "target_doc_id": r['target_doc_id'], "rel_type": r['rel_type'],
                "source_summary": r['source_content'][:80] + "..." if len(r['source_content']) > 80 else r['source_content'],
                "target_summary": r['target_content'][:80] + "..." if len(r['target_content']) > 80 else r['target_content']} for r in cur.fetchall()]
        finally:
            cur.close()
            conn.close()
    
    def search(self, query: str, top_k=10, namespace=None):
        try:
            resp = requests.post(f"{settings.OLLAMA_URL}/api/embeddings", json={"model": settings.OLLAMA_MODEL, "prompt": query}, timeout=30)
            resp.raise_for_status()
            query_embedding = resp.json()["embedding"]
        except Exception as e:
            return {"results": [], "total": 0, "error": str(e)}
        conn = self._get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            ns = namespace or 'default'
            cur.execute("""SELECT id, doc_id, content, namespace, category, source, importance, tags, 1-(embedding <=> %s::vector) as similarity
                FROM memories WHERE (namespace=%s OR %s IS NULL) AND (expires_at IS NULL OR expires_at > NOW()) AND embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector LIMIT %s""", (query_embedding, ns, ns if namespace else None, query_embedding, top_k))
            results = [{"id": r['id'], "doc_id": r['doc_id'], "content": r['content'], "namespace": r['namespace'],
                "category": r['category'], "source": r['source'], "importance": float(r['importance'] or 1.0),
                "tags": r['tags'] or [], "similarity": float(r['similarity'])} for r in cur.fetchall()]
            return {"query": query, "results": results, "total": len(results)}
        finally:
            cur.close()
            conn.close()
    
    def get_memory(self, memory_id: int):
        conn = self._get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cur.execute("SELECT * FROM memories WHERE id=%s", (memory_id,))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            cur.close()
            conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting VectorSpace API...")
    if not UMAP_AVAILABLE:
        logger.warning("UMAP not available, using PCA fallback")
    yield
    logger.info("Shutting down...")

app = FastAPI(title="VectorSpace", description="ACE Memory Visualizer", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
ace_client = ACEClient()

@app.get("/")
async def root():
    return {"name": "VectorSpace", "description": "ACE Memory Visualizer", "version": "0.3.0", "docs": "/docs"}

@app.get("/api/health")
async def health():
    try:
        stats = ace_client.get_stats()
        return {"status": "healthy", "memories": stats.get("total_memories", 0), "umap_available": UMAP_AVAILABLE}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

@app.get("/api/vectorspace/stats")
async def get_stats():
    return ace_client.get_stats()

@app.get("/api/vectorspace/projections")
async def get_projections(namespace: Optional[str] = Query(None), algorithm: str = Query("umap")):
    result = ace_client.get_all_embeddings(namespace=namespace, algorithm=algorithm)
    if not result.get("points"):
        raise HTTPException(status_code=503, detail="No memories found")
    return result

@app.get("/api/vectorspace/relationships")
async def get_relationships(namespace: Optional[str] = Query(None), threshold: float = Query(0.65)):
    return ace_client.compute_relationships(namespace=namespace, threshold=threshold)

@app.get("/api/vectorspace/explicit-relationships")
async def get_explicit_relationships():
    rels = ace_client.get_explicit_relationships()
    return {"relationships": rels, "count": len(rels)}

@app.post("/api/vectorspace/search")
async def search_vectorspace(query: str = Query(...), top_k: int = Query(10, ge=1, le=50), namespace: Optional[str] = Query(None)):
    result = ace_client.search(query=query, top_k=top_k, namespace=namespace)
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])
    return result

@app.get("/api/vectorspace/memory/{memory_id}")
async def get_memory_detail(memory_id: int):
    result = ace_client.get_memory(memory_id)
    if not result:
        raise HTTPException(status_code=404, detail="Memory not found")
    return result

@app.get("/api/vectorspace/namespaces")
async def get_namespaces():
    stats = ace_client.get_stats()
    return {"namespaces": list(stats.get("by_namespace", {}).keys()), "counts": stats.get("by_namespace", {})}

@app.get("/api/vectorspace/categories")
async def get_categories():
    stats = ace_client.get_stats()
    return {"categories": list(stats.get("by_category", {}).keys()), "counts": stats.get("by_category", {})}
