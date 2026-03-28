"""
Brain (ChromaDB) client for querying the workspace Brain
"""

import sys
from pathlib import Path
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Add Brain to path
BRAIN_PATH = Path("/home/mdigiacomi/.openclaw/workspace/workspace_brain")
CONTEXT_ENGINE_PATH = Path("/home/mdigiacomi/.openclaw/workspace/context-management-engine/context-engine/src")

sys.path.insert(0, str(BRAIN_PATH))
sys.path.insert(0, str(CONTEXT_ENGINE_PATH))


class BrainClient:
    """Client for querying the Workspace Brain"""
    
    def __init__(self, db_path: str = "/data/brain"):
        self.db_path = db_path
        self.indexer = None
        self._connect()
    
    def _connect(self):
        """Connect to Brain"""
        try:
            from indexer import BrainIndexer
            from vector_store import ContextVectorStore
            
            # Use the existing Brain
            self.store = ContextVectorStore(db_path=self.db_path)
            self.store.connect()
            self.indexer = BrainIndexer()
            logger.info(f"Connected to Brain: {self.store.get_document_count()} documents")
        except Exception as e:
            logger.error(f"Failed to connect to Brain: {e}")
            self.store = None
            self.indexer = None
    
    def search(self, query: str, top_k: int = 5) -> Dict:
        """Search the Brain for relevant documents"""
        if not self.indexer:
            return {"error": "Brain not connected", "results": [], "total": 0}
        
        try:
            from rag_pipeline import RAGQuery
            
            rag = RAGQuery(self.store)
            results = rag.query(query, top_k=top_k)
            
            # Format results
            formatted = []
            for src in results.get('sources', []):
                file_path = src.get('file', '')
                project = self._extract_project(file_path)
                formatted.append({
                    "file": file_path,
                    "relevance": round(src.get('relevance', 0), 3),
                    "project": project
                })
            
            return {
                "query": query,
                "results": formatted,
                "total": results.get('document_count', 0)
            }
        except Exception as e:
            logger.error(f"Brain search error: {e}")
            return {"error": str(e), "results": [], "total": 0}
    
    def get_stats(self) -> Dict:
        """Get Brain statistics"""
        if not self.store:
            return {"error": "Brain not connected"}
        
        try:
            count = self.store.get_document_count()
            return {
                "document_count": count,
                "status": "connected"
            }
        except Exception as e:
            return {"error": str(e)}
    
    def find_related_patterns(self, code_snippet: str, exclude_file: str = None) -> List[Dict]:
        """Find similar code patterns across projects"""
        if not self.indexer:
            return []
        
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


# Singleton instance
_brain_client = None

def get_brain_client() -> BrainClient:
    """Get or create Brain client singleton"""
    global _brain_client
    if _brain_client is None:
        _brain_client = BrainClient()
    return _brain_client
