#!/bin/bash
set -e

echo "Building VectorSpace v0.3.0..."
cd "$(dirname "$0")"

# Install frontend deps
cd src/frontend
npm install
cd ../..

# Build
docker build -t project-pulse-api:latest -f src/api/Dockerfile src/api/
docker build -t project-pulse-frontend:latest -f src/frontend/Dockerfile src/frontend/

# Import to K3s
echo "Importing images to K3s..."
sudo k3s ctr images import <(docker save project-pulse-api:latest)
sudo k3s ctr images import <(docker save project-pulse-frontend:latest)

# Deploy
echo "Deploying to K3s..."
kubectl apply -k k8s/
kubectl rollout restart deployment/pulse-api -n project-pulse
kubectl rollout restart deployment/pulse-frontend -n project-pulse

echo ""
echo "✓ Deployed! Check status:"
echo "  kubectl get pods -n project-pulse"
echo ""
echo "Access: https://pulse.digitaladrenalin.net"
