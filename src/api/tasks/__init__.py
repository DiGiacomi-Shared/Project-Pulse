"""
Celery worker configuration and tasks
"""

from celery import Celery
import os

# Redis as broker
broker_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
result_backend = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "project_pulse",
    broker=broker_url,
    backend=result_backend,
    include=["tasks.sync_tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour timeout
    worker_prefetch_multiplier=1,  # Process one task at a time
)
