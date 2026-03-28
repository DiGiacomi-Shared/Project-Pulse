"""
Brain (PostgreSQL + pgvector) client for querying the workspace Brain
"""

import sys
from pathlib import Path
from typing import List, Dict, Optional
import logging
import json

logger = logging.getLogger(__name__)

# Add Brain to path
BRAIN_PATH = Path("/home/mdigiacomi/.openclaw/workspace/workspace_brain")
sys.path.insert(0, str(BRAIN_PATH))

# PostgreSQL config
PG_CONFIG = {
    'host': '198.100.154.175',
    'database': 'brain',
    'user': 'postgres',
    'password': 'brain123'
}


class BrainClient:
    """Client for querying the Workspace Brain (PostgreSQL)"""
    
    def __init__(self):
        self.conn = None
        self._connect()
    
    def _connect(self):
        """Connect to PostgreSQL Brain"""
        try:
            import psycopg2
            self.conn = psycopg2.connect(**PG_CONFIG)
            logger.info("Connected to PostgreSQL Brain")
        except Exception as e:
            logger.error(f"Failed to connect to Brain: {e}")
            self.conn = None
    
    def search(self, query: str, top_k: int = 5) -> Dict:
        """Search the Brain for relevant documents"""
        if not self.conn:
            return {"error": "Brain not connected", "results": [], "total": 0}
        
        try:
            from sentence_transformers import SentenceTransformer
            
            # Generate query embedding
            model = SentenceTransformer('all-MiniLM-L6-v2')
            query_embedding = model.encode(query).tolist()
            
            # Search using pgvector
            from psycopg2.extras import RealDictCursor
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT doc_id, content, metadata, source, filename, similarity
                    FROM search_brain_documents(%s::vector, 0.0, %s)
                """, (json.dumps(query_embedding), top_k))
                
                rows = cur.fetchall()
            
            # Format results
            formatted = []
            for r in rows:
                file_path = f"{r['source']}/{r['filename']}"
                project = self._extract_project(file_path)
                formatted.append({
                    "file": file_path,
                    "relevance": round(r['similarity'], 3),
                    "project": project,
                    "content": r['content'][:200]
                })
            
            return {
                "query": query,
                "results": formatted,
                "total": len(rows)
            }
        except Exception as e:
            logger.error(f"Brain search error: {e}")
            return {"error": str(e), "results": [], "total": 0}
    
    def get_stats(self) -> Dict:
        """Get Brain statistics"""
        if not self.conn:
            return {"error": "Brain not connected"}
        
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM brain_documents")
                count = cur.fetchone()[0]
                
                cur.execute("SELECT COUNT(DISTINCT source) FROM brain_documents")
                sources = cur.fetchone()[0]
            
            return {
                "document_count": count,
                "sources": sources,
                "status": "connected",
                "database": "PostgreSQL + pgvector"
            }
        except Exception as e:
            return {"error": str(e)}
    
    def find_related_patterns(self, code_snippet: str, exclude_file: str = None) -> List[Dict]:
        """Find similar code patterns across projects"""
        results = self.search(code_snippet, top_k=10)
        
        # Filter out the source file
        related = []
        for r in results.get('results', []):
            if r['file'] != exclude_file:
                related.append(r)
        
        return related
    
    def _extract_project(self, file_path: str) -> str:
        """Extract project name from file path"""
        parts = file_path.replace('/home/mdigiacomi/.openclaw/workspace/', '').split('/')
        return parts[0] if parts else 'unknown'
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()


# Singleton instance
_brain_client = None

def get_brain_client() -> BrainClient:
    """Get or create Brain client singleton"""
    global _brain_client
    if _brain_client is None:
        _brain_client = BrainClient()
    return _brain_client
