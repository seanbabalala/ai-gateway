# SiftGate 文档

[文档首页](../../README.md) · [项目 README](../../../README.md)

SiftGate 是一个自托管 AI 流量网关，适合需要同时管理多个模型供应商、
Agent 和应用的团队。它把路由、策略、预算、审计和可观测元数据留在本地，
默认不存储 prompt、response、原始请求头、供应商密钥、工具载荷、媒体字节、
隐藏推理内容或解析后的密钥。

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

1. 确认当前 Workspace。
2. 添加一个 Provider Node。
3. 创建一个 Gateway API Key。
4. 如有需要，绑定 Policy Namespace。
5. 检查每日 Budget 的作用域和来源。
6. 发送第一条请求。
7. 查看 Logs 和 Route Explanation。
8. 只在需要时配置 Semantic Controls、Traffic Experiments、Evals、Shadow Traffic 或 MCP Tool Gateway。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| Workspace | 本地 Dashboard 和元数据边界。 |
| Provider Node | 已配置的上游账号、部署、代理或本地模型运行时。 |
| Gateway API Key | 由 SiftGate 生成、给客户端使用的密钥，不是供应商密钥。 |
| Policy Namespace | 基于配置的本地策略标签，用于 API Key、Team、预算、限流和节点/模型白名单。 |
| MCP Tool Gateway | MCP 工具调用治理和代理，不是模型路由。 |

## 文档地图

- [快速开始](../../QUICKSTART.md)
- [Docker 快速开始](../../DOCKER_QUICKSTART.md)
- [Dashboard](../../DASHBOARD.md)
- [OSS 概念](../../OSS_CONCEPTS.md)
- [Provider Catalog](../../PROVIDER_CATALOG.md)
- [MCP Tool Gateway](../../MCP_GATEWAY.md)
- [Semantic Controls](../../SEMANTIC_PLATFORM.md)
- [Evaluation Framework](../../EVALUATION_FRAMEWORK.md)
- [API Reference](../../API_REFERENCE.md)
- [Production](../../PRODUCTION.md)
- [Security](../../SECURITY.md)
