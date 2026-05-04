# SiftGate Kubernetes Manifests

`deploy/kubernetes/base` is a plain Kubernetes/Kustomize base for the MIT
open-source SiftGate Data Plane. It mirrors the Helm defaults: one pod, SQLite
on a PVC, memory state backend, no Cloud dependency, and no enterprise image.

```bash
kubectl apply -k deploy/kubernetes/base
kubectl -n siftgate port-forward svc/siftgate 2099:2099
```

The included Secret uses placeholders only. Replace it with your own
Kubernetes Secret, sealed secret, or external-secret controller before sending
production traffic.

Run `npm run validate:k8s` after editing these manifests.
