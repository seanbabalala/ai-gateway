# SiftGate 文件

[文件首頁](../../README.md) · [專案 README](../../../README.md)

SiftGate 是自託管 AI 流量閘道，適合需要同時管理多個模型供應商、
Agent 和應用程式的團隊。它把路由、策略、預算、稽核和可觀測中繼資料留在本地，
預設不儲存 prompt、response、原始標頭、供應商金鑰、工具載荷、媒體位元組、
隱藏推理內容或解析後的密鑰。

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
Gateway API Key，然後向 `http://localhost:2099/v1/chat/completions` 發送第一個請求。

## 首次設定路徑

1. 確認目前 Workspace。
2. 新增一個 Provider Node。
3. 建立一個 Gateway API Key。
4. 視需要綁定 Policy Namespace。
5. 檢查每日 Budget 的作用域與來源。
6. 發送第一個請求。
7. 查看 Logs 和 Route Explanation。
8. 只在需要時設定 Semantic Controls、Traffic Experiments、Evals、Shadow Traffic 或 MCP Tool Gateway。

## 核心概念

| 概念 | 含義 |
| --- | --- |
| Workspace | 本地 Dashboard 和中繼資料邊界。 |
| Provider Node | 已設定的上游帳號、部署、代理或本地模型執行環境。 |
| Gateway API Key | 由 SiftGate 產生、給客戶端使用的金鑰，不是供應商金鑰。 |
| Policy Namespace | 以設定檔為來源的本地策略標籤，用於 API Key、Team、預算、限流和節點/模型白名單。 |
| MCP Tool Gateway | MCP 工具呼叫治理和代理，不是模型路由。 |

## 文件地圖

- [快速開始](../../QUICKSTART.md)
- [Docker 快速開始](../../DOCKER_QUICKSTART.md)
- [Dashboard](../../DASHBOARD.md)
- [OSS Concepts](../../OSS_CONCEPTS.md)
- [Provider Catalog](../../PROVIDER_CATALOG.md)
- [MCP Tool Gateway](../../MCP_GATEWAY.md)
- [Semantic Controls](../../SEMANTIC_PLATFORM.md)
- [Evaluation Framework](../../EVALUATION_FRAMEWORK.md)
- [API Reference](../../API_REFERENCE.md)
- [Production](../../PRODUCTION.md)
- [Security](../../SECURITY.md)
