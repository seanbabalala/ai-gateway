#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
SMOKE_ROOT="${ROOT_DIR}/.docker-smoke"
WORK_DIR="${SMOKE_ROOT}/${RUN_ID}"
PROJECT_NAME="siftgate-smoke-${RUN_ID}"
KEEP="${SIFTGATE_DOCKER_SMOKE_KEEP:-${AI_GATEWAY_DOCKER_SMOKE_KEEP:-0}}"
PROVIDED_IMAGE="${SIFTGATE_DOCKER_SMOKE_IMAGE:-${AI_GATEWAY_DOCKER_SMOKE_IMAGE:-}}"
IMAGE="${PROVIDED_IMAGE:-siftgate-smoke:${RUN_ID}}"
IMAGE_OWNED=1

if [[ -n "${PROVIDED_IMAGE}" ]]; then
  IMAGE_OWNED=0
fi

log() {
  printf '[docker-smoke] %s\n' "$*"
}

fail() {
  printf '[docker-smoke] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  if [[ "${KEEP}" == "1" ]]; then
    log "Keeping smoke workspace: ${WORK_DIR}"
    log "Keeping compose project: ${PROJECT_NAME}"
    exit "${exit_code}"
  fi

  if [[ -f "${WORK_DIR}/compose.yaml" ]]; then
    docker compose -p "${PROJECT_NAME}" -f "${WORK_DIR}/compose.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "${IMAGE_OWNED}" == "1" ]]; then
    docker image rm "${IMAGE}" >/dev/null 2>&1 || true
  fi
  rm -rf "${WORK_DIR}"
  rmdir "${SMOKE_ROOT}" >/dev/null 2>&1 || true
  exit "${exit_code}"
}

trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd docker
require_cmd curl
require_cmd node

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable"

choose_port() {
  node <<'NODE'
const net = require('net');

const preferred = Number(process.env.SIFTGATE_DOCKER_SMOKE_PORT || process.env.AI_GATEWAY_DOCKER_SMOKE_PORT || 32199);
const fixed = Boolean(process.env.SIFTGATE_DOCKER_SMOKE_PORT || process.env.AI_GATEWAY_DOCKER_SMOKE_PORT);

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

(async () => {
  if (await canListen(preferred)) {
    console.log(preferred);
    return;
  }

  if (fixed) {
    console.error(`Port ${preferred} is already in use`);
    process.exit(1);
  }

  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => console.log(address.port));
  });
})();
NODE
}

HOST_PORT="$(choose_port)"
BASE_URL="http://127.0.0.1:${HOST_PORT}"

mkdir -p "${WORK_DIR}/data"

cat > "${WORK_DIR}/.env" <<'ENV'
NODE_ENV=production
SIFTGATE_ALLOW_UNAUTHENTICATED_DASHBOARD=true
ENV

cat > "${WORK_DIR}/gateway.config.yaml" <<'YAML'
server:
  port: 2099
  host: 0.0.0.0

database:
  type: sqlite
  path: ./data/gateway.db
  log_retention_days: 1

dashboard:
  auth_required: false

auth:
  api_keys: []
  rate_limit:
    requests_per_minute: 1000
    requests_per_minute_ip: 1000
    max_entries: 10000
    login_requests_per_minute: 5

nodes:
  - id: mock-openai
    name: "Mock OpenAI"
    protocol: chat_completions
    base_url: "http://mock-upstream:3000"
    endpoint: "/v1/chat/completions"
    api_key: "mock-provider-key"
    models: ["gpt-4o-mini", "gpt-4o"]
    timeout_ms: 10000
    tags: ["fast", "code"]
    model_aliases:
      mini: gpt-4o-mini
    model_prefixes: ["gpt"]

routing:
  tiers:
    simple:
      primary: { node: mock-openai, model: gpt-4o-mini }
      fallbacks: []
    standard:
      primary: { node: mock-openai, model: gpt-4o-mini }
      fallbacks: []
    complex:
      primary: { node: mock-openai, model: gpt-4o }
      fallbacks: []
    reasoning:
      primary: { node: mock-openai, model: gpt-4o }
      fallbacks: []
  scoring:
    simple_max: -0.1
    standard_max: 0.08
    complex_max: 0.35

budget:
  daily_token_limit: 100000
  daily_cost_limit: 5
  alert_threshold: 0.8

models_pricing:
  gpt-4o-mini: { input: 0.15, output: 0.6 }
  gpt-4o: { input: 2.5, output: 10 }
YAML

cat > "${WORK_DIR}/compose.yaml" <<YAML
services:
  mock-upstream:
    image: "${IMAGE}"
    command:
      - node
      - -e
      - |
        const http = require('http');
        const server = http.createServer((req, res) => {
          if (req.url === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          let raw = '';
          req.on('data', (chunk) => { raw += chunk; });
          req.on('end', () => {
            let body = {};
            try { body = JSON.parse(raw || '{}'); } catch {}
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: 'chatcmpl-docker-smoke',
              object: 'chat.completion',
              model: body.model || 'gpt-4o-mini',
              choices: [{
                index: 0,
                message: { role: 'assistant', content: 'docker quickstart ok' },
                finish_reason: 'stop'
              }],
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
            }));
          });
        });
        server.listen(3000, '0.0.0.0');
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 3s
      retries: 12

  siftgate:
    image: "${IMAGE}"
    restart: "no"
    ports:
      - "${HOST_PORT}:2099"
    volumes:
      - "${WORK_DIR}/gateway.config.yaml:/app/gateway.config.yaml"
      - "${WORK_DIR}/data:/app/data"
    env_file:
      - "${WORK_DIR}/.env"
    depends_on:
      mock-upstream:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:2099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 3s
      start_period: 5s
      retries: 12
YAML

if [[ "${IMAGE_OWNED}" == "1" ]]; then
  log "Building Docker image ${IMAGE}"
  if ! docker build -t "${IMAGE}" "${ROOT_DIR}" 2>&1 | tee "${WORK_DIR}/docker-build.log"; then
    if grep -E 'node:20-alpine|registry-1\.docker\.io|docker\.io/library/node|i/o timeout|EOF' "${WORK_DIR}/docker-build.log" >/dev/null 2>&1; then
      cat >&2 <<'MSG'

[docker-smoke] Docker could not pull the Node base image from Docker Hub.
[docker-smoke] This is a registry/network failure, not a SiftGate smoke assertion failure.
[docker-smoke] Retry later, configure a Docker registry mirror, or prebuild an image and run:
[docker-smoke]   SIFTGATE_DOCKER_SMOKE_IMAGE=<image> npm run smoke:docker

MSG
    fi
    exit 1
  fi
else
  docker image inspect "${IMAGE}" >/dev/null 2>&1 || fail "Provided image does not exist locally: ${IMAGE}"
  log "Using prebuilt Docker image ${IMAGE}"
fi

log "Starting smoke stack on ${BASE_URL}"
docker compose -p "${PROJECT_NAME}" -f "${WORK_DIR}/compose.yaml" up -d >/dev/null 2>&1

dump_logs() {
  docker compose -p "${PROJECT_NAME}" -f "${WORK_DIR}/compose.yaml" ps -a >&2 || true
  docker compose -p "${PROJECT_NAME}" -f "${WORK_DIR}/compose.yaml" logs --no-color --tail=160 >&2 || true
}

wait_for_health() {
  for _ in $(seq 1 60); do
    if curl -fsS "${BASE_URL}/health" > "${WORK_DIR}/health.json" 2>/dev/null; then
      if node - "${WORK_DIR}/health.json" <<'NODE'
const fs = require('fs');
const health = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (health.status !== 'healthy') {
  process.exit(1);
}
NODE
      then
        return 0
      fi
    fi
    sleep 1
  done
  dump_logs
  fail "Gateway did not become healthy"
}

validate_chat_response() {
  local file="$1"
  local expected_model="$2"
  node - "${file}" "${expected_model}" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const expectedModel = process.argv[3];
const body = JSON.parse(fs.readFileSync(file, 'utf8'));

if (body.error) {
  throw new Error(`Unexpected gateway error: ${JSON.stringify(body.error)}`);
}
if (body.model !== expectedModel) {
  throw new Error(`Expected model ${expectedModel}, got ${body.model}`);
}
if (body.choices?.[0]?.message?.content !== 'docker quickstart ok') {
  throw new Error(`Unexpected content: ${JSON.stringify(body.choices?.[0]?.message)}`);
}
if (body.usage?.total_tokens !== 5) {
  throw new Error(`Expected total_tokens=5, got ${JSON.stringify(body.usage)}`);
}
NODE
}

create_gateway_key() {
  curl -fsS "${BASE_URL}/api/dashboard/api-keys" \
    -H "Content-Type: application/json" \
    -d '{"name":"docker-smoke","allow_auto":true,"allow_direct":true,"allowed_nodes":["mock-openai"],"allowed_models":["gpt-4o-mini","gpt-4o"],"daily_token_limit":100000,"daily_cost_limit":5,"rate_limit_per_minute":1000}' \
    > "${WORK_DIR}/created-key.json"

  GATEWAY_KEY="$(node - "${WORK_DIR}/created-key.json" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!/^gw_sk_live_/.test(body.key || '')) {
  throw new Error('Gateway key was not returned or had the wrong prefix');
}
if (!body.item?.id) {
  throw new Error('Gateway key id was not returned');
}
process.stdout.write(body.key);
NODE
)"
  KEY_ID="$(node - "${WORK_DIR}/created-key.json" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(body.item.id);
NODE
)"
  KEY_PREFIX="$(node - "${WORK_DIR}/created-key.json" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(body.key.slice(0, 14));
NODE
)"
  export GATEWAY_KEY KEY_ID KEY_PREFIX
}

call_chat() {
  local model="$1"
  local file="$2"
  curl -fsS "${BASE_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${GATEWAY_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"docker smoke ${model}\"}]}" \
    > "${file}"
}

validate_logs_and_budget() {
  local expected_calls="$1"
  local expected_tokens="$2"

  curl -fsS "${BASE_URL}/api/dashboard/logs?api_key_id=${KEY_ID}&limit=20" > "${WORK_DIR}/logs.json"
  curl -fsS "${BASE_URL}/api/dashboard/budget?api_key_id=${KEY_ID}" > "${WORK_DIR}/budget.json"

  node - "${WORK_DIR}/logs.json" "${WORK_DIR}/budget.json" "${KEY_ID}" "${expected_calls}" "${expected_tokens}" <<'NODE'
const fs = require('fs');
const logs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const budget = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const keyId = process.argv[4];
const expectedCalls = Number(process.argv[5]);
const expectedTokens = Number(process.argv[6]);

const rows = logs.data || [];
if (rows.length !== expectedCalls) {
  throw new Error(`Expected ${expectedCalls} logs for ${keyId}, got ${rows.length}`);
}
if (rows.some((row) => row.api_key_id !== keyId)) {
  throw new Error('At least one log row was not attributed to the generated api_key_id');
}
if (!rows.some((row) => row.tier === 'direct')) {
  throw new Error('No direct routing log row found');
}
if (rows.some((row) => Number(row.cost_usd) <= 0)) {
  throw new Error('At least one log row has zero cost');
}

if (budget.apiKeyId !== keyId) {
  throw new Error(`Budget response apiKeyId mismatch: ${budget.apiKeyId}`);
}

const keyRules = budget.perKeyRules || [];
const tokenRule = keyRules.find((rule) => rule.type === 'daily_tokens');
const costRule = keyRules.find((rule) => rule.type === 'daily_cost');
if (!tokenRule || tokenRule.current !== expectedTokens) {
  throw new Error(`Expected per-key daily_tokens=${expectedTokens}, got ${JSON.stringify(tokenRule)}`);
}
if (!costRule || Number(costRule.current) <= 0) {
  throw new Error(`Expected per-key daily_cost > 0, got ${JSON.stringify(costRule)}`);
}
NODE
}

wait_for_health
log "Gateway is healthy"

create_gateway_key
log "Created Gateway API key ${KEY_PREFIX}... id=${KEY_ID}"

call_chat "auto" "${WORK_DIR}/auto.json"
validate_chat_response "${WORK_DIR}/auto.json" "gpt-4o-mini"

call_chat "gpt-4o" "${WORK_DIR}/direct.json"
validate_chat_response "${WORK_DIR}/direct.json" "gpt-4o"

validate_logs_and_budget 2 10
log "Validated auto/direct logs and per-key budget accounting"

log "Restarting gateway to verify SQLite persistence"
docker compose -p "${PROJECT_NAME}" -f "${WORK_DIR}/compose.yaml" restart siftgate >/dev/null 2>&1
wait_for_health

curl -fsS "${BASE_URL}/api/dashboard/api-keys" > "${WORK_DIR}/api-keys-after-restart.json"
node - "${WORK_DIR}/api-keys-after-restart.json" "${KEY_ID}" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const keyId = process.argv[3];
if (!(body.items || []).some((item) => item.id === keyId)) {
  throw new Error(`Generated key ${keyId} was not found after restart`);
}
NODE

call_chat "auto" "${WORK_DIR}/auto-after-restart.json"
validate_chat_response "${WORK_DIR}/auto-after-restart.json" "gpt-4o-mini"
validate_logs_and_budget 3 15

log "Docker smoke passed"
