"""
Background sync tasks
"""

from datetime import datetime, timedelta
import logging

from tasks import celery_app
from services.github_client import get_github_client, RepoSyncer

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def sync_github_repos(self, repos: list):
    """
    Sync GitHub repositories.
    
    Args:
        repos: List of "owner/name" strings
    """
    logger.info(f"Starting sync for {len(repos)} repos")
    
    try:
        client = get_github_client()
        syncer = RepoSyncer(client)
        
        results = []
        for repo_str in repos:
            if "/" not in repo_str:
                continue
            owner, name = repo_str.split("/", 1)
            result = syncer.sync_repo(owner, name)
            results.append(result)
        
        # TODO: Store results in database
        
        return {
            "status": "completed",
            "repos_synced": len(results),
            "completed_at": datetime.utcnow().isoformat()
        }
    
    except Exception as exc:
        logger.error(f"Sync failed: {exc}")
        raise self.retry(exc=exc, countdown=60)


@celery_app.task
def generate_insights():
    """
    Generate insights by cross-referencing data.
    
    Runs on schedule to detect:
    - Projects idle for N days
    - PRs needing review
    - Patterns across repos
    """
    logger.info("Generating insights")
    
    # TODO: Implement insight generation
    # - Query database for idle projects
    # - Check PR ages
    # - Cross-reference with Brain
    
    return {"status": "completed", "insights_generated": 0}


@celery_app.task
def sync_brain_index():
    """
    Sync Brain (ChromaDB) changes.
    
    Periodically checks for new indexed documents
    and updates Pulse metadata.
    """
    logger.info("Syncing Brain index")
    
    from services.brain_client import get_brain_client
    
    client = get_brain_client()
    stats = client.get_stats()
    
    return {
        "status": "completed",
        "document_count": stats.get("document_count", 0),
        "synced_at": datetime.utcnow().isoformat()
    }


# Schedule configuration (loaded by Celery beat)
celery_app.conf.beat_schedule = {
    "sync-repos": {
        "task": "tasks.sync_tasks.sync_github_repos",
        "schedule": 300.0,  # Every 5 minutes
        "args": ([],)  # Repos list populated from config
    },
    "generate-insights": {
        "task": "tasks.sync_tasks.generate_insights",
        "schedule": 900.0,  # Every 15 minutes
    },
    "sync-brain": {
        "task": "tasks.sync_tasks.sync_brain_index",
        "schedule": 300.0,  # Every 5 minutes
    },
}
