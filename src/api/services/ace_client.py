"""
ACE (AI Context Engine) client for the VectorSpace visualizer.
Connects to the context_engine PostgreSQL database with nomic-embed-text 768-dim vectors.
"""

import os
import json
import logging
from typing import List, Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)

# ACE PostgreSQL config from environment or defaults
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
                logger.info("Reconnected to ACE PostgreSQL")
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
            "projections": [[x, y], ...],
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
                    vec = np.array(emb, dtype=np.float32)
                embeddings.append(vec)

                content = row['content'] or ''
                summary = content[:120] + '...' if len(content) > 120 else content

                points.append({
                    "id": row['id'],
                    "doc_id": row['doc_id'],
                    "content_summary": summary,
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

    def compute_relationships(self, namespace: Optional[str] = None, threshold: float = 0.65) -> Dict:
        """
        Compute relationship edges between memories based on cosine similarity.

        Uses pgvector's cosine distance operator (<=>) to find pairs of memories
        whose similarity exceeds the threshold. Only computes within the same
        namespace to keep edges meaningful.

        Returns: {"edges": [{"source": id, "target": id, "similarity": float}, ...], "count": int}
        """
        self._ensure_conn()
        if not self.conn:
            return {"error": "ACE not connected", "edges": [], "count": 0}

        try:
            from psycopg2.extras import RealDictCursor
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Self-join on memories to find pairs with high cosine similarity
                # Use pgvector <=> operator (cosine distance: 0=identical, 2=opposite)
                # similarity = 1 - distance
                sql = """
                    SELECT 
                        m1.id as source,
                        m2.id as target,
                        1 - (m1.embedding <=> m2.embedding) as similarity
                    FROM memories m1
                    JOIN memories m2 ON m1.id < m2.id
                        AND 1 - (m1.embedding <=> m2.embedding) >= %s
                    WHERE m1.embedding IS NOT NULL 
                      AND m2.embedding IS NOT NULL
                """
                params = [threshold]

                if namespace:
                    sql += " AND m1.namespace = %s AND m2.namespace = %s"
                    params.extend([namespace, namespace])
                else:
                    # Only connect within same namespace for clarity
                    sql += " AND m1.namespace = m2.namespace"

                # Also connect same-category cross-namespace at a lower threshold
                # to show inter-namespace links
                sql2 = """
                    SELECT
                        m1.id as source,
                        m2.id as target,
                        1 - (m1.embedding <=> m2.embedding) as similarity
                    FROM memories m1
                    JOIN memories m2 ON m1.id < m2.id
                        AND m1.namespace != m2.namespace
                        AND 1 - (m1.embedding <=> m2.embedding) >= %s
                    WHERE m1.embedding IS NOT NULL
                      AND m2.embedding IS NOT NULL
                """
                cross_ns_threshold = min(threshold + 0.1, 0.95)

                if namespace:
                    sql2 = sql2.replace("WHERE", f"WHERE m1.namespace = %s AND m2.namespace != %s AND")
                    # We skip cross-namespace if filtering to one namespace
                    rows_cross = []
                else:
                    cur.execute(sql2, [cross_ns_threshold])
                    rows_cross = cur.fetchall()

                cur.execute(sql, params)
                rows_within = cur.fetchall()

                edges = []
                seen = set()
                for row in rows_within + rows_cross:
                    key = (row['source'], row['target'])
                    if key not in seen:
                        seen.add(key)
                        edges.append({
                            "source": row['source'],
                            "target": row['target'],
                            "similarity": round(float(row['similarity']), 4),
                        })

                # Sort by similarity descending, limit to top 200 edges
                edges.sort(key=lambda x: x['similarity'], reverse=True)
                edges = edges[:200]

            return {
                "edges": edges,
                "count": len(edges),
                "threshold": threshold,
            }

        except Exception as e:
            logger.error(f"ACE compute_relationships error: {e}")
            return {"error": str(e), "edges": [], "count": 0}

    def get_namespaces(self) -> List[str]:
        """Get list of distinct namespaces."""
        self._ensure_conn()
        if not self.conn:
            return []
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT DISTINCT namespace FROM memories ORDER BY namespace")
                return [r[0] for r in cur.fetchall()]
        except Exception as e:
            logger.error(f"ACE get_namespaces error: {e}")
            return []

    def get_categories(self) -> List[str]:
        """Get list of distinct categories."""
        self._ensure_conn()
        if not self.conn:
            return []
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT DISTINCT category FROM memories ORDER BY category")
                return [r[0] for r in cur.fetchall()]
        except Exception as e:
            logger.error(f"ACE get_categories error: {e}")
            return []

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
        logger.warning("umap-learn not installed, falling back to TruncatedSVD")
        return _fallback_projection(embeddings)

    data = np.stack(embeddings)

    # UMAP parameters tuned for visualization
    n_neighbors = min(15, len(data) - 1)
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
    Fallback when UMAP is not available: use TruncatedSVD or random.
    """
    data = np.stack(embeddings)
    if data.shape[1] >= 2:
        try:
            from sklearn.decomposition import TruncatedSVD
            svd = TruncatedSVD(n_components=2, random_state=42)
            return svd.fit_transform(data)
        except ImportError:
            logger.warning("scikit-learn not installed, using random projection")
    # Absolute fallback: random
    return np.random.rand(len(data), 2)


# Singleton instance
_ace_client = None


def get_ace_client() -> ACEClient:
    """Get or create ACE client singleton."""
    global _ace_client
    if _ace_client is None:
        _ace_client = ACEClient()
    return _ace_client