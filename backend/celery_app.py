import os
from celery import Celery

# Get Redis URL from environment (supports Railway, Docker, and local)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "hypersentry",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['tasks']
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    
    # Results
    result_expires=3600,  # 1 hour
    
    # Worker settings
    worker_prefetch_multiplier=1,  # One task at a time to respect rate limits
    task_acks_late=True,  # Ensure task completion before ack
    
    # Retry settings
    task_reject_on_worker_lost=True,
    task_acks_on_failure_or_timeout=True,
    
    # Timezone
    timezone="UTC",
    enable_utc=True,
)
