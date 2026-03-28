#!/bin/bash
set -e

echo "🚀 Deploying Project Pulse to pulse.digitaladrenalin.net"

# Build images
echo "📦 Building Docker images..."
cd src/api
docker build -t project-pulse-api:latest .
cd ../frontend
docker build -t project-pulse-frontend:latest .
cd ../..

# Import to K3s
echo "📥 Importing images to K3s..."
sudo k3s ctr images import <(docker save project-pulse-api:latest)
sudo k3s ctr images import <(docker save project-pulse-frontend:latest)

# Create namespace
echo "🔧 Creating namespace..."
kubectl apply -f k8s/namespace.yaml

# Create secrets
echo "🔐 Creating secrets..."
if ! kubectl get secret github-token -n project-pulse >/dev/null 2>&1; then
    read -sp "Enter GitHub token: " GITHUB_TOKEN
    echo
    kubectl create secret generic github-token \
        --from-literal=token="$GITHUB_TOKEN" \
        -n project-pulse
fi

# Deploy
echo "🚢 Deploying..."
kubectl apply -k k8s/

# Wait for rollout
echo "⏳ Waiting for deployments..."
kubectl rollout status deployment/postgres -n project-pulse --timeout=120s
kubectl rollout status deployment/redis -n project-pulse --timeout=60s
kubectl rollout status deployment/pulse-api -n project-pulse --timeout=60s
kubectl rollout status deployment/pulse-frontend -n project-pulse --timeout=60s

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Access your dashboard at: https://pulse.digitaladrenalin.net"
echo ""
echo "📊 Check status:"
echo "  kubectl get pods -n project-pulse"
echo "  kubectl logs -n project-pulse deployment/pulse-api"
echo ""
echo "🧪 Test endpoints:"
echo "  curl https://pulse.digitaladrenalin.net/api/health"
echo "  curl https://pulse.digitaladrenalin.net/api/brain/stats"
