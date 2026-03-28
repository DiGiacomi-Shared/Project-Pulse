# Project Pulse - Deployment Guide

## Quick Start

```bash
# 1. Clone and build
cd /tmp/Project-Pulse
docker build -t project-pulse-api:latest -f src/api/Dockerfile src/api/

# 2. Deploy to K3s
kubectl apply -k k8s/

# 3. Access
curl http://localhost:30080/api/health
```

## Prerequisites

- K3s cluster running
- Docker for building images
- GitHub token (for repo sync)

## Setup Steps

### 1. Build Docker Image

```bash
cd src/api/
docker build -t project-pulse-api:latest .

# For K3s to see it
sudo k3s ctr images import <(docker save project-pulse-api:latest)
```

### 2. Create Secrets

```bash
# GitHub token
kubectl create secret generic github-token \
  --from-literal=token=ghp_YOUR_TOKEN_HERE \
  -n project-pulse

# Update configmap with repos
kubectl edit configmap pulse-config -n project-pulse
# Change repos: "owner/repo1,owner/repo2"
```

### 3. Deploy

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/brain-volume.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/workers.yaml
kubectl apply -f k8s/ingress.yaml
```

### 4. Verify

```bash
# Check pods
kubectl get pods -n project-pulse

# Check health
curl http://localhost:30080/api/health
curl http://localhost:30080/api/brain/stats

# View logs
kubectl logs -n project-pulse deployment/pulse-api
kubectl logs -n project-pulse deployment/pulse-workers
```

## Troubleshooting

### ChromaDB Access

The Brain uses hostPath mounting. Ensure:
- Path exists: `~/.openclaw/workspace/.brain_chroma`
- K3s has access to hostPath volumes
- PV/PVC bound correctly: `kubectl get pv,pvc -n project-pulse`

### GitHub API Rate Limits

If syncing fails:
- Check token is valid: `curl -H "Authorization: Bearer TOKEN" https://api.github.com/user`
- Reduce sync frequency in tasks/sync_tasks.py

### Database Connection

If API can't connect to Postgres:
- Verify Postgres is running: `kubectl get pods -n project-pulse`
- Check logs: `kubectl logs -n project-pulse deployment/postgres`
- Connection string format: `postgresql+asyncpg://pulse:pulse@postgres:5432/pulse`

## Updating

```bash
# Rebuild
docker build -t project-pulse-api:latest src/api/
sudo k3s ctr images import <(docker save project-pulse-api:latest)

# Restart
cd k8s/
kubectl rollout restart deployment/pulse-api -n project-pulse
kubectl rollout restart deployment/pulse-workers -n project-pulse
```

## Architecture

```
┌────────────────────────────────────────────────┐
│                  K3s Cluster                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │   API    │  │ Workers  │  │   Beat   │     │
│  │   :8000  │  │  (sync)  │  │(schedule)│     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │             │             │            │
│  ┌────┴─────────────┴─────────────┴────┐     │
│  │           Redis (broker)              │     │
│  └──────────────┬────────────────────────┘     │
│                 │                              │
│  ┌──────────────┴────────┐   ┌──────────┐   │
│  │     Postgres          │   │   Brain   │   │
│  │   (metadata)          │   │ (ChromaDB)│   │
│  └────────────────────────┘   └──────────┘   │
└────────────────────────────────────────────────┘
```
