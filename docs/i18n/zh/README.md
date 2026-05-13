# SiftGate 文档

[文档首页](../../README.md) · [项目 README](../../../README.md)

SiftGate 是一个自托管 AI Gateway，用来统一管理多模型供应商、多应用、
Coding Agent、MCP 工具调用、路由策略、预算成本、审计和可观测元数据。
它运行在你的基础设施内，把供应商密钥、运行时策略和敏感运营数据留在本地；
默认不存储 prompt、response、原始供应商请求头、供应商密钥、工具载荷、
媒体字节、源码、diff、隐藏推理内容或解析后的密钥。

## 它解决什么问题

| 问题 | SiftGate 提供的能力 |
| --- | --- |
| 供应商越来越多 | 用一个网关接入 OpenAI、Anthropic、Google、Azure、Bedrock、OpenRouter、本地模型、媒体/语音供应商和自定义 OpenAI-compatible 服务。 |
| Agent 到处分散 | 将 Cursor、Cline、Roo Code、Continue、Codex、Claude Code、OpenCode、聊天客户端和 MCP 工具调用接入同一个本地入口。 |
| 路由不可解释 | 记录模型或节点被选中、跳过、过滤、重试、降级的元数据证据，而不是默认保存内容。 |
| 成本难治理 | 支持全局、Policy Namespace、Team、API Key 多层预算、限流、价格来源治理、缓存节省、成本归因和异常证据。 |
| 密钥暴露风险 | 供应商 API Key 留在本地配置、环境变量或 secret reference 中，应用和 Agent 只使用 SiftGate 生成的 Gateway API Key。 |
| 从试用到生产难迁移 | 从本地 SQLite/memory state 起步，需要时再接 PostgreSQL、Redis、Docker、Kubernetes、Helm、OIDC、日志出口和 secret backend。 |

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
Gateway API Key，然后向 `http://localhost:2099/v1/chat/completions` 发送第一条请求。

## 首次配置路径

1. 确认或创建当前 Workspace。
2. 添加一个 Provider Node。
3. 创建一个 Dashboard 管理的 Gateway API Key。
4. 如有需要，绑定 Policy Namespace 或 Team。
5. 检查每日 Budget 的作用域和来源。
6. 从 Playground、SDK 或 OpenAI-compatible 客户端发送第一条请求。
7. 查看 Logs、Sessions 和 Route Explanation。
8. 只在需要时配置 Semantic Controls、Traffic Experiments、Evals、Shadow Traffic 或 MCP Tool Gateway。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| Workspace | 本地 Dashboard、成员、日志、密钥、预算和审计事件的运营边界。 |
| Provider Node | 已配置的上游账号、部署、代理或本地模型运行时。 |
| Provider Catalog | Provider、模型、端点、兼容性和价格参考元数据，不等于真实账单来源。 |
| Gateway API Key | 由 SiftGate 生成并给客户端使用的密钥，不是供应商密钥。 |
| Policy Namespace | 基于配置的本地策略标签，可绑定 API Key、Team、预算、限流、允许的节点和模型。 |
| Team | 本地团队分组，用于共享策略、预算和使用归因。 |
| Budget Scope | Global、Policy Namespace、Team、API Key 多层每日 token/cost 限额。 |
| MCP Tool Gateway | MCP 工具调用治理和代理，不是模型路由。 |

## 能力地图

| 方向 | 文档入口 |
| --- | --- |
| 本地试用 | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md) |
| 容器部署 | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [State Backends](../../STATE_BACKEND.md) |
| 生产运行 | [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [Security](../../SECURITY.md), [Secret Management](../../SECRET_MANAGEMENT.md) |
| 供应商和模型 | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Extensibility](../../PROVIDER_EXTENSIBILITY.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md) |
| 路由和治理 | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost and Chargeback Platform](../../COST_CHARGEBACK_PLATFORM.md) |
| Agent 接入 | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Gateway Profiles](../../AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [Agent Platform Preview](../../AGENT_PLATFORM_PREVIEW.md) |
| 高级控制 | [MCP Tool Gateway](../../MCP_GATEWAY.md), [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md), [Caching](../../CACHING.md) |
| 开发和扩展 | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |

## 常用入口

| 主题 | 链接 |
| --- | --- |
| API Reference | [../../API_REFERENCE.md](../../API_REFERENCE.md) |
| Dashboard | [../../DASHBOARD.md](../../DASHBOARD.md) |
| Provider Catalog | [../../PROVIDER_CATALOG.md](../../PROVIDER_CATALOG.md) |
| Coding Agent Gateway | [../../CODING_AGENT_GATEWAY.md](../../CODING_AGENT_GATEWAY.md) |
| MCP Tool Gateway | [../../MCP_GATEWAY.md](../../MCP_GATEWAY.md) |
| Semantic Controls | [../../SEMANTIC_PLATFORM.md](../../SEMANTIC_PLATFORM.md) |
| Production | [../../PRODUCTION.md](../../PRODUCTION.md) |
| Security | [../../SECURITY.md](../../SECURITY.md) |
