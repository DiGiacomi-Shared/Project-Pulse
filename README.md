# Project Pulse - Architecture Overview

Project Pulse is a K3s-deployed developer dashboard that connects your git repos, Brain (ChromaDB), DevKit tools, and conversations into a single intelligent view.

## Core Philosophy

Everything connected. Click a PR → see Brain docs → see when you discussed this → see DevKit snapshot before the change.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         K3s Cluster                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Ingress    │  │   Frontend   │  │     API      │       │
│  │   (Nginx)    │  │   (React)    │  │  (FastAPI)   │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │               │
│         └─────────────────┴─────────────────┘               │
│                           │                                 │
│              ┌────────────┴────────────┐                   │
│              │      Redis (Cache)      │                   │
│              └────────────┬────────────┘                   │
│                           │                                 │
│  ┌──────────────┐  ┌────┴────────┐  ┌──────────────┐     │
│  │  Postgres    │  │   Workers   │  │  Brain       │     │
│  │  (Metadata)  │  │  (Celery)   │  │  (ChromaDB)  │     │
│  └──────────────┘  └─────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React + Vite + TypeScript + Tailwind |
| API | FastAPI (Python) |
| Database | PostgreSQL 15 |
| Cache/Queue | Redis |
| Task Workers | Celery |
| Message Broker | Redis |
| Container Runtime | K3s |
| Ingress | Traefik or Nginx |

## Data Flow

### 1. Git Sync Worker
- Polls GitHub API for repo activity
- Stores commits, PRs, CI status in Postgres
- Triggers insight generation

### 2. Brain Sync Worker  
- Connects to workspace ChromaDB
- Indexes new documents
- Generates embeddings for search

### 3. Insight Generator
- Runs scheduled Brain queries
- Cross-references git + Brain + DevKit
- Generates "you mentioned..." insights

### 4. Alert Evaluator
- Checks thresholds (stale PRs, idle projects)
- Sends notifications via webhooks

## API Endpoints

```
GET  /api/repos                    # List monitored repos
GET  /api/repos/{id}/activity      # Activity feed
GET  /api/repos/{id}/prs          # Open PRs
GET  /api/brain/search?q=auth     # Semantic search
GET  /api/insights                # Generated insights
GET  /api/devkit/snapshots        # Latest snapshots
POST /api/reminders               # Create reminder
GET  /api/health                  # Service health
```

## Frontend Routes

```
/              # Dashboard (activity + insights)
/repos         # Repo list
/repos/{id}    # Repo detail
/search        # Brain search
/timeline      # Activity timeline
/settings      # Configuration
```

## K8s Resources

```yaml
# See k8s/ directory for manifests
namespace.yaml          # project-pulse namespace
postgres.yaml           # PostgreSQL StatefulSet
redis.yaml              # Redis Deployment
api-deployment.yaml     # FastAPI app
frontend-deployment.yaml # React app
workers-deployment.yaml # Celery workers
ingress.yaml            # Ingress rules
```

## Configuration

Environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/pulse

# Redis
REDIS_URL=redis://redis:6379/0

# Brain (ChromaDB)
BRAIN_DB_PATH=/data/brain

# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_REPOS=specterdefence,screen-sprout-api,...

# DevKit
DEVKIT_PATH=/workspace/devkit

# General
PULSE_ENV=production
LOG_LEVEL=info
```

## Development

```bash
# Local development
cd src/api
pip install -r requirements.txt
uvicorn main:app --reload

cd src/frontend
npm install
npm run dev

# Run workers
cd src/workers
celery -A tasks worker --loglevel=info

# Docker build
docker build -t project-pulse-api:latest -f Dockerfile.api .
docker build -t project-pulse-frontend:latest -f Dockerfile.frontend .
```

## Deployment

```bash
# Deploy to K3s
kubectl apply -k k8s/

# Or use Helm (future)
helm install project-pulse ./helm-chart
```

## Database Schema

See `docs/database-schema.md`

## Feature Roadmap

See GitHub Issues for prioritized feature list.

## License

MIT
