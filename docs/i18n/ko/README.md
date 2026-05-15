# SiftGate 문서

[문서 홈](../../README.md) · [프로젝트 README](../../../README.md)

현재 릴리스: **v2.11.3**.

SiftGate는 직접 배포된 provider key, 임시 proxy 설정, 불투명한 model routing을
넘어선 팀을 위한 self-hosted AI traffic data plane입니다. 앱, Coding Agent,
MCP 도구, provider credential, routing policy, budget, cache evidence,
production operation을 하나의 로컬 제어면으로 모읍니다.

<p align="center">
  <img src="../../assets/homepage/siftgate-hero.svg" alt="SiftGate AI traffic data plane" width="100%" />
</p>

## 최신 제품 메시지

| SiftGate 강점 | 중요한 이유 |
| --- | --- |
| AI traffic data plane | 정책, 라우팅, credential 선택, budget, cost, cache, audit, evidence가 하나의 self-hosted request path에서 실행됩니다. |
| Agent와 MCP governance | Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, 범용 OpenAI/Anthropic Agent와 HTTP JSON-RPC, Streamable HTTP, legacy SSE, stdio MCP 도구를 하나의 관리형 ingress로 묶을 수 있습니다. |
| Cache-aware credential pools | 하나의 Provider Node에 여러 upstream key를 두고 `cache_aware`, least-in-flight, weighted rotation, sticky affinity, cooldown, retry failover를 사용할 수 있습니다. |
| Route Explanation | prompt/response를 기본 저장하지 않으면서 모델이나 노드가 선택, 제외, 재시도, 다운그레이드, 거절된 이유를 확인할 수 있습니다. |
| metadata-only 기본값 | 기본적으로 prompt, response, raw header, provider key, tool payload, media bytes, source, diff, hidden reasoning, resolved secret을 저장하지 않습니다. |
| Production path | SQLite와 memory state로 시작해 PostgreSQL, Redis, Docker, Kubernetes, Helm, OIDC, secret references, log sinks, OpenTelemetry로 확장할 수 있습니다. |

## 30초 요약

대부분의 gateway는 "이 요청을 어떤 모델로 보낼까"에서 멈춥니다. SiftGate는
AI 트래픽을 governance 가능하고 설명 가능한 control loop로 바꿉니다.

1. Gateway API Key를 인증하고 Workspace, Team, Policy Namespace를 해석합니다.
2. endpoint, modality, model, node, budget, rate limit 권한을 확인합니다.
3. compatibility, cost, latency, health, cache evidence, fallback rule로 라우팅합니다.
4. cache-aware affinity를 포함해 올바른 upstream provider credential을 선택합니다.
5. provider-compatible response를 반환하고 export-safe 운영 evidence를 저장합니다.

## Provider Credential Pools

Provider Node는 하나의 `api_key`뿐 아니라 first-class `credentials[]` pool을
사용할 수 있습니다. pool은 같은 logical node 안에서 upstream key를 먼저
rotation/retry한 뒤 node-level fallback으로 넘어갑니다.

```yaml
credential_pool:
  enabled: true
  strategy: cache_aware
  sticky_by: agent_session
  cooldown_ms: 60000
  max_failures: 3
  retry_on_status: [429, 500, 502, 503, 504]
```

같은 provider/account/model surface에 여러 key가 있는 coding plan 또는 Agent
workload에는 `cache_aware`가 적합합니다. SiftGate는 provider prompt cache를 만들거나
읽은 traffic을 가능한 같은 upstream key에 유지하고, 429/5xx/timeout에서는 다른 key로
전환합니다.

## 경쟁 포지셔닝

SiftGate는 단순히 저렴한 모델 router도, API 재판매 panel도 아닙니다. BYOK
governance, route evidence, Agent/MCP control, cache-aware key pool, production
operation을 위한 self-hosted AI traffic data plane입니다.

<p align="center">
  <img src="../../assets/comparison/competitive-matrix.svg" alt="SiftGate competitive matrix" width="100%" />
</p>

자세한 내용은 [Comparison](../../COMPARISON.md)을 참고하세요.

## 빠른 시작

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
npm run build
npm start
```

`http://localhost:2099/dashboard`를 열고 Provider Node를 추가한 뒤 Gateway API Key를
만들고 `http://localhost:2099/v1/chat/completions`로 요청을 보내세요.

## 최초 설정 경로

1. 활성 Workspace를 확인하거나 생성합니다.
2. Provider Node 하나를 추가합니다.
3. Dashboard-managed Gateway API Key를 생성합니다.
4. 필요한 경우 Policy Namespace 또는 Team에 연결합니다.
5. 일일 Budget scope와 source of truth를 확인합니다.
6. Playground, SDK, OpenAI-compatible client에서 첫 요청을 보냅니다.
7. Logs, Sessions, Route Explanation을 확인합니다.
8. 필요한 경우에만 Semantic Controls, Traffic Experiments, Evals, Shadow Traffic, MCP Tool Gateway를 설정합니다.

## 문서 지도

| 영역 | 시작점 |
| --- | --- |
| 로컬 평가와 Dashboard | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md), [Playground](../../PLAYGROUND.md) |
| 운영 환경 | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [State Backends](../../STATE_BACKEND.md), [Secret Management](../../SECRET_MANAGEMENT.md), [Config Validation](../../CONFIG_VALIDATION.md), [Config Audit and Rollback](../../CONFIG_AUDIT_ROLLBACK.md) |
| Provider와 protocol | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md), [Provider Extensibility](../../PROVIDER_EXTENSIBILITY.md), [Multimodal Capabilities](../../MULTIMODAL_CAPABILITIES.md), [Batch API](../../BATCH_API.md) |
| 라우팅과 governance | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost Platform](../../COST_CHARGEBACK_PLATFORM.md), [Billing Loop](../../BILLING_LOOP.md) |
| Agent와 MCP traffic | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Gateway Profiles](../../AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [Agent Platform Preview](../../AGENT_PLATFORM_PREVIEW.md), [MCP Tool Gateway](../../MCP_GATEWAY.md) |
| 고급 제어와 evidence | [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Caching](../../CACHING.md), [Stream, Cache, and Batching](../../STREAM_CACHE_BATCHING.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md), [Performance](../../PERFORMANCE.md) |
| Observability와 control plane | [Webhook Alerts](../../WEBHOOK_ALERTS.md), [Log Sinks](../../LOG_SINKS.md), [Control Plane Contract](../../CONTROL_PLANE.md), [Security](../../SECURITY.md) |
| 개발과 migration | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Migration Compatibility](../../MIGRATION_COMPAT.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |
