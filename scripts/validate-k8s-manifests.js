#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const chartDir = path.join(root, 'deploy/helm/siftgate');
const k8sDir = path.join(root, 'deploy/kubernetes/base');

const requiredFiles = [
  'deploy/helm/siftgate/Chart.yaml',
  'deploy/helm/siftgate/values.yaml',
  'deploy/helm/siftgate/templates/_helpers.tpl',
  'deploy/helm/siftgate/templates/configmap.yaml',
  'deploy/helm/siftgate/templates/deployment.yaml',
  'deploy/helm/siftgate/templates/service.yaml',
  'deploy/helm/siftgate/templates/secret.yaml',
  'deploy/helm/siftgate/templates/pvc.yaml',
  'deploy/kubernetes/base/kustomization.yaml',
  'deploy/kubernetes/base/configmap.yaml',
  'deploy/kubernetes/base/deployment.yaml',
  'deploy/kubernetes/base/service.yaml',
  'deploy/kubernetes/base/secret.example.yaml',
];

for (const rel of requiredFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing Kubernetes deployment file: ${rel}`);
  }
}

const chart = readYaml('deploy/helm/siftgate/Chart.yaml');
const values = readYaml('deploy/helm/siftgate/values.yaml');
const chartConfig = yaml.load(values.config.data);

assert(chart.name === 'siftgate', 'Chart name must be siftgate.');
assert(chart.type === 'application', 'Chart type must be application.');
assert(values.replicaCount === 1, 'Default Helm replicaCount must stay 1.');
assert(values.persistence.enabled === true, 'Default Helm install should persist SQLite data.');
assert(values.postgres.enabled === false, 'PostgreSQL must be opt-in.');
assert(values.redis.enabled === false, 'Redis must be opt-in.');
assert(chartConfig.database.type === 'sqlite', 'Default Helm config must use SQLite.');
assert(chartConfig.database.path === '/app/data/gateway.db', 'Default Helm SQLite path must use /app/data.');
assert(chartConfig.state.backend === 'memory', 'Default Helm state backend must be memory.');
assert(chartConfig.cluster.enabled === false, 'Default Helm cluster mode must be disabled.');
assert(
  chartConfig.dashboard.password === '${DASHBOARD_PASSWORD_HASH:-}',
  'Helm config should use a bcrypt hash env reference for Dashboard auth.',
);

const deploymentTemplate = readText('deploy/helm/siftgate/templates/deployment.yaml');
for (const needle of [
  'GATEWAY_CONFIG_PATH',
  'SIFTGATE_INSTANCE_ID',
  '/health',
  'secretRef:',
  'configMap:',
  'persistentVolumeClaim:',
]) {
  assert(deploymentTemplate.includes(needle), `Helm deployment template missing ${needle}.`);
}

const rawManifests = [
  'namespace.yaml',
  'serviceaccount.yaml',
  'secret.example.yaml',
  'configmap.yaml',
  'pvc.yaml',
  'deployment.yaml',
  'service.yaml',
  'ingress.example.yaml',
].map((file) => path.join(k8sDir, file));

for (const file of rawManifests) {
  const docs = yaml.loadAll(fs.readFileSync(file, 'utf8')).filter(Boolean);
  assert(docs.length > 0, `${path.relative(root, file)} must contain at least one YAML document.`);
  for (const doc of docs) {
    assert(doc.apiVersion, `${path.relative(root, file)} is missing apiVersion.`);
    assert(doc.kind, `${path.relative(root, file)} is missing kind.`);
    assert(doc.metadata?.name, `${path.relative(root, file)} is missing metadata.name.`);
  }
}

const rawConfigMap = readYaml('deploy/kubernetes/base/configmap.yaml');
const rawConfig = yaml.load(rawConfigMap.data['gateway.config.yaml']);
assert(rawConfig.database.type === 'sqlite', 'Raw Kubernetes config must default to SQLite.');
assert(rawConfig.state.backend === 'memory', 'Raw Kubernetes config must default to memory state.');
assert(rawConfig.cluster.enabled === false, 'Raw Kubernetes config must keep cluster disabled by default.');

const deployFiles = walk(path.join(root, 'deploy'));
for (const file of deployFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  assert(!source.includes('/siftgate-cloud'), `${rel} must not reference /siftgate-cloud.`);
  assert(!/sk-[A-Za-z0-9]{16,}/.test(source), `${rel} appears to contain a provider secret.`);
}

console.log('SiftGate Kubernetes and Helm manifests validated.');

function readYaml(rel) {
  return yaml.load(readText(rel));
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function walk(dir) {
  return fs.readdirSync(dir).flatMap((entry) => {
    const abs = path.join(dir, entry);
    const stat = fs.statSync(abs);
    return stat.isDirectory() ? walk(abs) : [abs];
  });
}
