"""
GitHub API client for syncing repos, commits, and PRs
"""

import os
import httpx
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class GitHubClient:
    """GitHub API client with caching"""
    
    def __init__(self, token: str = None):
        self.token = token or os.getenv("GITHUB_TOKEN", "")
        self.base_url = "https://api.github.com"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        } if self.token else {}
        self.client = httpx.AsyncClient(headers=self.headers, timeout=30.0)
    
    async def _get(self, path: str, params: Dict = None) -> Dict:
        """Make GET request to GitHub API"""
        url = f"{self.base_url}/{path}"
        try:
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"GitHub API error: {e}")
            return {"error": str(e)}
    
    async def get_repo(self, owner: str, repo: str) -> Dict:
        """Get repository information"""
        return await self._get(f"repos/{owner}/{repo}")
    
    async def get_commits(self, owner: str, repo: str, since: datetime = None) -> List[Dict]:
        """Get recent commits"""
        params = {}
        if since:
            params["since"] = since.isoformat()
        params["per_page"] = 100
        
        result = await self._get(f"repos/{owner}/{repo}/commits", params)
        return result if isinstance(result, list) else []
    
    async def get_pull_requests(self, owner: str, repo: str, state: str = "open") -> List[Dict]:
        """Get pull requests"""
        params = {
            "state": state,
            "per_page": 100,
            "sort": "updated",
            "direction": "desc"
        }
        result = await self._get(f"repos/{owner}/{repo}/pulls", params)
        return result if isinstance(result, list) else []
    
    async def get_pr_details(self, owner: str, repo: str, pr_number: int) -> Dict:
        """Get detailed PR information"""
        return await self._get(f"repos/{owner}/{repo}/pulls/{pr_number}")
    
    async def get_check_runs(self, owner: str, repo: str, ref: str) -> List[Dict]:
        """Get check runs (CI status) for a ref"""
        result = await self._get(f"repos/{owner}/{repo}/commits/{ref}/check-runs")
        return result.get("check_runs", []) if isinstance(result, dict) else []
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


class RepoSyncer:
    """Syncs repository data to database"""
    
    def __init__(self, github_client: GitHubClient, db_session=None):
        self.github = github_client
        self.db = db_session
    
    async def sync_repo(self, owner: str, name: str) -> Dict:
        """Sync a single repository"""
        logger.info(f"Syncing {owner}/{name}")
        
        # Get repo info
        repo_info = await self.github.get_repo(owner, name)
        if "error" in repo_info:
            return {"error": repo_info["error"]}
        
        # Get recent commits (last 30 days)
        since = datetime.utcnow() - timedelta(days=30)
        commits = await self.github.get_commits(owner, name, since)
        
        # Get open PRs
        prs = await self.github.get_pull_requests(owner, name, state="open")
        
        return {
            "repo": {
                "name": repo_info.get("name"),
                "owner": owner,
                "url": repo_info.get("html_url"),
                "default_branch": repo_info.get("default_branch"),
                "open_issues": repo_info.get("open_issues_count"),
                "updated_at": repo_info.get("updated_at"),
            },
            "commits": [
                {
                    "sha": c.get("sha"),
                    "message": c.get("commit", {}).get("message", "")[:100],
                    "author": c.get("commit", {}).get("author", {}).get("name"),
                    "date": c.get("commit", {}).get("committer", {}).get("date"),
                }
                for c in commits[:10]  # Last 10
            ],
            "pull_requests": [
                {
                    "number": pr.get("number"),
                    "title": pr.get("title"),
                    "author": pr.get("user", {}).get("login"),
                    "created_at": pr.get("created_at"),
                    "draft": pr.get("draft", False),
                }
                for pr in prs[:20]  # Last 20
            ]
        }
    
    async def sync_all(self, repos: List[str]) -> List[Dict]:
        """Sync all configured repositories"""
        results = []
        for repo_str in repos:
            if "/" not in repo_str:
                logger.warning(f"Invalid repo format: {repo_str}")
                continue
            owner, name = repo_str.split("/", 1)
            result = await self.sync_repo(owner, name)
            results.append(result)
        return results


# Singleton client
_github_client = None

def get_github_client() -> GitHubClient:
    """Get or create GitHub client"""
    global _github_client
    if _github_client is None:
        _github_client = GitHubClient()
    return _github_client
