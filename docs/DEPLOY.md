# VectorSpace Deployment

## Quick Deploy

```bash
# Build images
docker build -t project-pulse-api:latest -f src/api/Dockerfile src/api/
docker build -t project-pulse-frontend:latest -f src/frontend/Dockerfile src/frontend/

# Import to K3s
sudo k3s ctr images import <(docker save project-pulse-api:latest)
sudo k3s ctr images import <(docker save project-pulse-frontend:latest)

# Deploy
kubectl apply -k k8s/
```

## Prerequisites

- K3s cluster running
- Postgres with ACE schema on 100.102.10.75:5432
- Ollama on 100.100.227.127:11434

## Verify

```bash
kubectl get pods -n project-pulse
curl https://pulse.digitaladrenalin.net/api/health
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser   │────▶│   Frontend   │────▶│   FastAPI   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                                         ┌──────┴──────┐
                                         │   Postgres  │
                                         │   (ACE)     │
                                         └─────────────┘
```

## Troubleshooting

**API can't connect to Postgres:**
- Check Tailscale connectivity to 100.102.10.75
- Verify `context_engine` database exists

**Search fails:**
- Verify Ollama running on 100.100.227.127:11434
- Check `nomic-embed-text` model is pulled

## Update

```bash
docker build -t project-pulse-api:latest src/api/
sudo k3s ctr images import <(docker save project-pulse-api:latest)
kubectl rollout restart deployment/pulse-api -n project-pulse
```
