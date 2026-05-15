# SiftGate 文档

[文档首页](../../README.md) · [项目 README](../../../README.md)

当前版本：**v2.11.3**。

SiftGate 是一个自托管 AI traffic data plane，面向已经不满足于“直接发供应商
Key”或“简单代理转发”的团队。它把应用、Coding Agent、MCP 工具、供应商凭证、
路由策略、预算成本、缓存证据和生产运维放进一个本地控制面。

<p align="center">
  <img src="../../assets/homepage/siftgate-hero.svg" alt="SiftGate AI traffic data plane" width="100%" />
</p>

## 最新产品叙事

| SiftGate 的亮点 | 为什么重要 |
| --- | --- |
| AI traffic data plane | 策略、路由、凭证选择、预算、成本、缓存、审计和证据都在一个自托管请求路径里完成。 |
| Agent 和 MCP 治理 | Cursor、Cline、Roo Code、Continue、Codex、Claude Code、OpenCode、通用 OpenAI/Anthropic Agent，以及 HTTP JSON-RPC、Streamable HTTP、旧版 SSE、stdio MCP 工具可以共用一个受管入口。 |
| 缓存感知凭证池 | 一个 Provider Node 内可配置多个上游 Key，支持 `cache_aware`、最少进行中、加权轮询、粘性亲和、冷却和失败重试。 |
| 路由解释 | 可以看到模型/节点为什么被选中、跳过、过滤、重试、降级或拒绝，同时默认不存 prompt/response。 |
| 默认只存元数据 | 默认不存 prompt、response、原始请求头、供应商密钥、工具载荷、媒体字节、源码、diff、隐藏推理或解析后的 secret。 |
| 生产路径完整 | 本地 SQLite/memory state 起步，需要时接 PostgreSQL、Redis、Docker、Kubernetes、Helm、OIDC、secret references、日志出口和 OpenTelemetry。 |

## 30 秒理解 SiftGate

很多网关只解决“把请求转给哪个模型”。SiftGate 做的是一个可治理、可解释的
AI 流量控制闭环：

1. 认证 Gateway API Key，并解析 Workspace、Team、Policy Namespace。
2. 检查 endpoint、modality、model、node、budget 和 rate limit 权限。
3. 根据兼容性、成本、延迟、健康度、缓存证据和 fallback 规则路由。
4. 选择正确的上游 provider credential，包括缓存感知亲和。
5. 返回 provider-compatible 响应，并记录可导出的安全运营证据。

## Provider Credential Pools

Provider Node 可以使用单个 `api_key`，也可以使用一等公民的 `credentials[]`
凭证池。凭证池会先在同一个逻辑节点内部轮换和重试上游 Key，再进入节点级 fallback。

```yaml
credential_pool:
  enabled: true
  strategy: cache_aware
  sticky_by: agent_session
  cooldown_ms: 60000
  max_failures: 3
  retry_on_status: [429, 500, 502, 503, 504]
```

当一个 coding plan 或 Agent 工作负载拥有多个同供应商、同模型面的上游 Key 时，
推荐使用 `cache_aware`。SiftGate 会尽量让创建或读取 provider prompt cache 的
请求继续命中同一条上游 Key，同时在 429/5xx/timeout 时切到其他 Key。

## 开源对比定位

SiftGate 不只是便宜模型路由器，也不是 API 分销面板。它是自托管 AI traffic
data plane，重点在 BYOK 治理、路由证据、Agent/MCP 控制、缓存感知 Key 池和
生产运维。

<p align="center">
  <img src="../../assets/comparison/competitive-matrix.svg" alt="SiftGate competitive matrix" width="100%" />
</p>

完整对比见：[Comparison](../../COMPARISON.md)。

## 快速开始

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

打开 `http://localhost:2099/dashboard`，添加一个 Provider Node，创建一个
Gateway API Key，然后向 `http://localhost:2099/v1/chat/completions` 发送请求。

## 首次配置路径

1. 确认或创建当前 Workspace。
2. 添加一个 Provider Node。
3. 创建一个 Dashboard 管理的 Gateway API Key。
4. 如有需要，绑定 Policy Namespace 或 Team。
5. 检查每日 Budget 的作用域和来源。
6. 从 Playground、SDK 或 OpenAI-compatible 客户端发送第一条请求。
7. 查看 Logs、Sessions 和 Route Explanation。
8. 只在需要时配置 Semantic Controls、Traffic Experiments、Evals、Shadow Traffic 或 MCP Tool Gateway。

## 文档地图

| 方向 | 文档入口 |
| --- | --- |
| 本地试用和 Dashboard | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md), [Playground](../../PLAYGROUND.md) |
| 生产运维 | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [State Backends](../../STATE_BACKEND.md), [Secret Management](../../SECRET_MANAGEMENT.md), [Config Validation](../../CONFIG_VALIDATION.md), [Config Audit and Rollback](../../CONFIG_AUDIT_ROLLBACK.md) |
| 供应商和协议 | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md), [Provider Extensibility](../../PROVIDER_EXTENSIBILITY.md), [Multimodal Capabilities](../../MULTIMODAL_CAPABILITIES.md), [Batch API](../../BATCH_API.md) |
| 路由和治理 | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost Platform](../../COST_CHARGEBACK_PLATFORM.md), [Billing Loop](../../BILLING_LOOP.md) |
| Agent 和 MCP 流量 | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Gateway Profiles](../../AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [Agent Platform Preview](../../AGENT_PLATFORM_PREVIEW.md), [MCP Tool Gateway](../../MCP_GATEWAY.md) |
| 高级控制和证据 | [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Caching](../../CACHING.md), [Stream, Cache, and Batching](../../STREAM_CACHE_BATCHING.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md), [Performance](../../PERFORMANCE.md) |
| 观测和控制平面 | [Webhook Alerts](../../WEBHOOK_ALERTS.md), [Log Sinks](../../LOG_SINKS.md), [Control Plane Contract](../../CONTROL_PLANE.md), [Security](../../SECURITY.md) |
| 开发和迁移 | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Migration Compatibility](../../MIGRATION_COMPAT.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |
