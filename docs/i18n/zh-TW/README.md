# SiftGate 文件

[文件首頁](../../README.md) · [專案 README](../../../README.md)

目前版本：**v2.11.2**。

SiftGate 是自託管 AI traffic data plane，適合已經不滿足於直接散發供應商
Key 或只做簡單代理轉發的團隊。它把應用程式、Coding Agent、MCP 工具、
供應商憑證、路由策略、預算成本、快取證據和生產維運放進同一個本地控制面。

<p align="center">
  <img src="../../assets/homepage/siftgate-hero.svg" alt="SiftGate AI traffic data plane" width="100%" />
</p>

## 最新產品定位

| SiftGate 亮點 | 為什麼重要 |
| --- | --- |
| AI traffic data plane | 策略、路由、憑證選擇、預算、成本、快取、稽核和證據都在自託管請求路徑中完成。 |
| Agent 與 MCP 治理 | Cursor、Cline、Roo Code、Continue、Codex、Claude Code、OpenCode、通用 OpenAI/Anthropic Agent 和 MCP 工具可共用受管入口。 |
| 快取感知憑證池 | 單一 Provider Node 可配置多個上游 Key，支援 `cache_aware`、最少進行中、加權輪詢、黏性親和、冷卻和失敗重試。 |
| 路由解釋 | 可查看模型/節點為何被選中、跳過、過濾、重試、降級或拒絕，同時預設不保存 prompt/response。 |
| 預設只保存中繼資料 | 預設不保存 prompt、response、原始標頭、供應商金鑰、工具載荷、媒體位元組、原始碼、diff、隱藏推理或解析後的 secret。 |
| 完整生產路徑 | 可從 SQLite/memory state 起步，再接 PostgreSQL、Redis、Docker、Kubernetes、Helm、OIDC、secret references、log sinks 和 OpenTelemetry。 |

## 30 秒理解 SiftGate

多數閘道只回答「把請求轉給哪個模型」。SiftGate 建立的是可治理、可解釋的
AI 流量控制閉環：

1. 驗證 Gateway API Key，解析 Workspace、Team、Policy Namespace。
2. 檢查 endpoint、modality、model、node、budget 和 rate limit 權限。
3. 依兼容性、成本、延遲、健康狀態、快取證據和 fallback 規則路由。
4. 選擇正確的上游 provider credential，包括快取感知親和。
5. 回傳 provider-compatible 回應，並記錄可匯出的安全營運證據。

## Provider Credential Pools

Provider Node 可以使用單一 `api_key`，也可以使用一等公民的 `credentials[]`
憑證池。憑證池會先在同一個邏輯節點內輪換與重試上游 Key，再進入節點級 fallback。

```yaml
credential_pool:
  enabled: true
  strategy: cache_aware
  sticky_by: agent_session
  cooldown_ms: 60000
  max_failures: 3
  retry_on_status: [429, 500, 502, 503, 504]
```

當 coding plan 或 Agent 工作負載在同一供應商/模型面有多個上游 Key 時，
建議使用 `cache_aware`。SiftGate 會盡量讓建立或讀取 provider prompt cache 的
請求繼續命中同一條上游 Key，並在 429/5xx/timeout 時切換到其他 Key。

## 開源對比定位

SiftGate 不只是便宜模型路由器，也不是 API 分銷面板。它是自託管 AI traffic
data plane，重點在 BYOK 治理、路由證據、Agent/MCP 控制、快取感知 Key 池和
生產維運。

<p align="center">
  <img src="../../assets/comparison/competitive-matrix.svg" alt="SiftGate competitive matrix" width="100%" />
</p>

完整對比見：[Comparison](../../COMPARISON.md)。

## 快速開始

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

開啟 `http://localhost:2099/dashboard`，新增一個 Provider Node，建立一個
Gateway API Key，然後向 `http://localhost:2099/v1/chat/completions` 發送請求。

## 首次設定路徑

1. 確認或建立目前 Workspace。
2. 新增一個 Provider Node。
3. 建立一個 Dashboard 管理的 Gateway API Key。
4. 視需要綁定 Policy Namespace 或 Team。
5. 檢查每日 Budget 的作用域與來源。
6. 從 Playground、SDK 或 OpenAI-compatible 客戶端發送第一個請求。
7. 查看 Logs、Sessions 和 Route Explanation。
8. 只在需要時設定 Semantic Controls、Traffic Experiments、Evals、Shadow Traffic 或 MCP Tool Gateway。

## 文件地圖

| 方向 | 文件入口 |
| --- | --- |
| 本地試用 | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md) |
| 容器和生產 | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [State Backends](../../STATE_BACKEND.md) |
| 供應商和模型 | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md) |
| 路由和治理 | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost Platform](../../COST_CHARGEBACK_PLATFORM.md) |
| Agent 和工具流量 | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [MCP Tool Gateway](../../MCP_GATEWAY.md) |
| 進階控制 | [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Caching](../../CACHING.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md) |
| 開發擴充 | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |
