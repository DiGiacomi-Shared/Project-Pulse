"""
Insight Generator - Detects patterns, reminders, and alerts
Cross-references GitHub, Brain, and DevKit data
"""

from datetime import datetime, timedelta
from typing import List, Dict, Optional
import logging

from services.brain_client import get_brain_client

logger = logging.getLogger(__name__)


class InsightGenerator:
    """Generates intelligent insights from multiple data sources"""
    
    def __init__(self, db_session=None):
        self.db = db_session
        self.brain = get_brain_client()
    
    def generate_all(self) -> List[Dict]:
        """Generate all types of insights"""
        insights = []
        
        # Run all generators
        insights.extend(self._detect_idle_projects())
        insights.extend(self._detect_stale_prs())
        insights.extend(self._find_cross_project_patterns())
        insights.extend(self._detect_architecture_drift())
        insights.extend(self._generate_reminders())
        
        return insights
    
    def _detect_idle_projects(self) -> List[Dict]:
        """Detect projects with no recent activity"""
        insights = []
        
        # Query Brain for recent document updates per project
        projects = ["specterdefence", "screen-sprout-api", "screen-sprout-web", 
                   "screen-sprout-mobile", "domain-expiry-tracker"]
        
        for project in projects:
            # Search for recent activity in this project
            results = self.brain.search(f"project {project} recent", top_k=1)
            
            # If no recent docs, project might be idle
            if results.get("total", 0) == 0:
                insights.append({
                    "type": "alert",
                    "severity": "warning",
                    "title": f"{project} appears idle",
                    "description": f"No recent activity detected in {project}. Consider archiving or revisiting.",
                    "project": project,
                    "created_at": datetime.utcnow().isoformat()
                })
        
        return insights
    
    def _detect_stale_prs(self) -> List[Dict]:
        """Detect PRs needing review (>2 days open)"""
        insights = []
        
        # This would query the database for open PRs
        # For now, placeholder that would be populated by GitHub sync
        
        return insights
    
    def _find_cross_project_patterns(self) -> List[Dict]:
        """Find similar code patterns across projects"""
        insights = []
        
        # Common patterns to look for
        patterns = [
            ("authentication JWT", "Auth patterns"),
            ("database connection pooling", "DB connection handling"),
            ("API error handling", "Error handling"),
            ("Kubernetes deployment", "K8s configs"),
        ]
        
        for query, label in patterns:
            results = self.brain.search(query, top_k=10)
            
            # Group by project
            projects_found = set()
            for r in results.get("results", []):
                projects_found.add(r.get("project", "unknown"))
            
            if len(projects_found) > 1:
                insights.append({
                    "type": "pattern",
                    "severity": "info",
                    "title": f"{label} across {len(projects_found)} projects",
                    "description": f"Found {label.lower()} in: {', '.join(projects_found)}. Consider consolidating to a shared library.",
                    "projects": list(projects_found),
                    "files": [r["file"] for r in results.get("results", [])[:5]],
                    "created_at": datetime.utcnow().isoformat()
                })
        
        return insights
    
    def _detect_architecture_drift(self) -> List[Dict]:
        """Detect inconsistencies with ADRs"""
        insights = []
        
        # This would compare current state with ADRs
        # For example: "ADR says use PostgreSQL but project X still uses SQLite"
        
        return insights
    
    def _generate_reminders(self) -> List[Dict]:
        """Generate reminders based on past conversations/commitments"""
        insights = []
        
        # Search Brain for TODO/FIXME patterns
        results = self.brain.search("TODO FIXME implement", top_k=5)
        
        for r in results.get("results", []):
            insights.append({
                "type": "reminder",
                "severity": "info",
                "title": f"Pending implementation in {r['project']}",
                "description": f"Found TODO in {r['file']}",
                "project": r["project"],
                "file": r["file"],
                "created_at": datetime.utcnow().isoformat()
            })
        
        return insights
    
    def get_project_health(self, project_name: str) -> Dict:
        """Get health metrics for a specific project"""
        
        # Get project context from Brain
        context = self.brain.search(f"project {project_name}", top_k=20)
        
        # Count different file types
        docs = 0
        code = 0
        tests = 0
        
        for r in context.get("results", []):
            file_path = r.get("file", "")
            if file_path.endswith(".md"):
                docs += 1
            elif file_path.endswith(".py") or file_path.endswith(".ts") or file_path.endswith(".js"):
                if "test" in file_path.lower():
                    tests += 1
                else:
                    code += 1
        
        return {
            "project": project_name,
            "total_files": context.get("total", 0),
            "documentation": docs,
            "source_code": code,
            "tests": tests,
            "health_score": self._calculate_health_score(docs, code, tests),
            "last_updated": datetime.utcnow().isoformat()
        }
    
    def _calculate_health_score(self, docs: int, code: int, tests: int) -> int:
        """Calculate a health score 0-100"""
        if code == 0:
            return 0
        
        # Simple scoring: docs coverage + test ratio
        doc_score = min(docs / max(code * 0.1, 1), 1) * 30  # 30% for docs
        test_score = min(tests / max(code * 0.3, 1), 1) * 40  # 40% for tests
        base_score = 30  # Base score
        
        return int(base_score + doc_score + test_score)


# Singleton
_generator = None

def get_insight_generator() -> InsightGenerator:
    """Get or create insight generator"""
    global _generator
    if _generator is None:
        _generator = InsightGenerator()
    return _generator
