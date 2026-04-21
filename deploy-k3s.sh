#!/bin/bash
# Deploy Project-Pulse with VectorSpace to K3s
set -e

echo "=== Creating namespace ==="
sudo kubectl apply -f k8s/namespace.yaml

echo "=== Applying infrastructure ==="
sudo kubectl apply -f k8s/postgres.yaml
sudo kubectl apply -f k8s/redis.yaml
sudo kubectl apply -f k8s/brain-volume.yaml
sudo kubectl apply -f k8s/configmap.yaml

echo "=== Waiting for infrastructure to be ready ==="
sudo kubectl rollout status statefulset/postgres -n project-pulse --timeout=60s 2>/dev/null || true
sudo kubectl rollout status deployment/redis -n project-pulse --timeout=60s 2>/dev/null || true

echo "=== Loading images into K3s ==="
sudo docker save project-pulse-api:latest | sudo k3s ctr images import -
sudo docker save project-pulse-frontend:latest | sudo k3s ctr images import -

echo "=== Tagging images for K3s ==="
# K3s containerd needs the images tagged with the right name
sudo k3s ctr images tag project-pulse-api:latest docker.io/library/project-pulse-api:latest 2>/dev/null || true
sudo k3s ctr images tag project-pulse-frontend:latest docker.io/library/project-pulse-frontend:latest 2>/dev/null || true

echo "=== Applying application deployments ==="
# Update image references to use local images
sudo kubectl apply -f k8s/api-deployment.yaml
sudo kubectl apply -f k8s/frontend.yaml
sudo kubectl apply -f k8s/workers.yaml

echo "=== Applying ingress ==="
sudo kubectl apply -f k8s/ingress.yaml

echo "=== Waiting for deployments ==="
sudo kubectl rollout status deployment/pulse-api -n project-pulse --timeout=120s 2>/dev/null || true
sudo kubectl rollout status deployment/pulse-frontend -n project-pulse --timeout=60s 2>/dev/null || true

echo "=== Done! ==="
sudo kubectl get all -n project-pulse