# Kubernetes Deployment

This directory contains plain Kubernetes manifests for the MIT open-source
SiftGate Data Plane. Use them when you do not want Helm, or as a starting point
for Kustomize/GitOps.

## Apply The Base

```bash
kubectl apply -k deploy/kubernetes/base
kubectl -n siftgate port-forward svc/siftgate 2099:2099
```

Before production use, replace `deploy/kubernetes/base/secret.example.yaml`
with a real Secret managed by your cluster secret workflow.

## Default Runtime Shape

The base manifests run:

- one SiftGate pod
- SQLite stored on the `siftgate-data` PVC
- local memory state
- one OpenAI-compatible node
- Dashboard auth disabled unless `DASHBOARD_PASSWORD_HASH` is set

This keeps the same single-instance behavior as the Docker quickstart. Redis,
PostgreSQL, cluster mode, and Ingress should be added explicitly for production
clusters.

## Production Notes

- Use a bcrypt dashboard password hash because ConfigMap mounts are read-only.
- Use PostgreSQL for durable production call logs and Dashboard-managed Gateway
  API keys.
- Use Redis only when enabling shared rate limits, circuit breakers, prompt
  cache state, routing momentum, or cluster status across replicas.
- Keep provider keys in Kubernetes Secrets or an external secret controller.
- The manifests do not include SiftGate Cloud or enterprise dashboard assets.
