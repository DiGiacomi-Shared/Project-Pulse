# SSL/TLS Setup for pulse.digitaladrenalin.net

## Prerequisites

1. Domain pointing to your K3s cluster
2. cert-manager installed in K3s
3. Let's Encrypt ClusterIssuer configured

## Install cert-manager (if not already installed)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.2/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=available --timeout=120s deployment/cert-manager -n cert-manager
```

## Create Let's Encrypt ClusterIssuer

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: traefik
```

Save as `cluster-issuer.yaml` and apply:
```bash
kubectl apply -f cluster-issuer.yaml
```

## Ingress Configuration

The ingress is already configured with:
- TLS certificate via cert-manager
- HTTP to HTTPS redirect
- Routes for both frontend and API

## Verification

After deployment, check certificate:
```bash
kubectl get certificate -n project-pulse
kubectl describe certificate pulse-tls -n project-pulse
```

Certificate should be issued automatically within a few minutes.

## Troubleshooting

If certificate is not issued:
1. Check cert-manager logs: `kubectl logs -n cert-manager deployment/cert-manager`
2. Check ClusterIssuer: `kubectl describe clusterissuer letsencrypt-prod`
3. Verify DNS points to your cluster: `dig pulse.digitaladrenalin.net`
