"""
Project Pulse Configuration
"""

import os
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings"""
    
    # App
    APP_NAME: str = "Project Pulse"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://pulse:***@postgres:5432/pulse"
    )
    
    # ACE (AI Context Engine) database
    ACE_PG_HOST: str = os.getenv("ACE_PG_HOST", "100.102.10.75")
    ACE_PG_PORT: int = int(os.getenv("ACE_PG_PORT", "5432"))
    ACE_PG_DATABASE: str = os.getenv("ACE_PG_DATABASE", "context_engine")
    ACE_PG_USER: str = os.getenv("ACE_PG_USER", "context_engine")
    ACE_PG_PASSWORD: str = os.getenv("ACE_PG_PASSWORD", "ctx2024engine")
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "nomic-embed-text")
    
    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    
    # Brain (ChromaDB)
    BRAIN_DB_PATH: str = os.getenv(
        "BRAIN_DB_PATH",
        "/home/mdigiacomi/.openclaw/workspace/.brain_chroma"
    )
    
    # GitHub
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    GITHUB_REPOS: str = os.getenv("GITHUB_REPOS", "")
    
    @property
    def repo_list(self) -> List[str]:
        """Parse comma-separated repo list"""
        if not self.GITHUB_REPOS:
            return []
        return [r.strip() for r in self.GITHUB_REPOS.split(",")]
    
    # CORS
    CORS_ORIGINS: List[str] = ["*"]  # Configure for production
    
    class Config:
        env_file = ".env"


settings = Settings()
