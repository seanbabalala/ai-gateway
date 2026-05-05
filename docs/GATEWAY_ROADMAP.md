# SiftGate 开源 Gateway Roadmap

> 本文档定义开源数据面（Data Plane）的功能迭代计划。
> 经过验证的功能将在后续抽象到企业版云控制面。
> 最后更新：2026-05-05

---

## 版本策略

| 版本 | 代号         | 目标                                | 时间线      |
| ---- | ------------ | ----------------------------------- | ----------- |
| v0.1 | Foundation   | 已完成 — 发布开源                   | ✅ Done     |
| v0.2 | Resilience   | 已发布 — v0.2.0 可靠性 + 开发者体验 | ✅ Released |
| v0.3 | Intelligence | 已发布 — v0.3.0 智能路由 + 可观测性 | ✅ Released |
| v0.4 | Ecosystem    | 已发布 — v0.4.0 插件生态 + 多端点 + 集成 | ✅ Released |
| v0.5 | Scale        | 已发布 — v0.5.0 高可用 + 高性能 + 企业就绪 | ✅ Released |
| v0.6 | Protocol + Explainability | 已发布 — v0.6.1 协议广度 + 可解释路由 + Dashboard 本地化补丁 | ✅ Released |
| v0.8 | Provider + Multimodal Ops | 已发布 — v0.8.0 Provider Catalog + Add Node Wizard + 多模态生产运维 | ✅ Released |
| v0.9 | Operations + Trust | 已发布 — v0.9.3 承接 v0.7 backlog，并补齐 Provider Catalog、价格来源状态、Dashboard 体验小版本 | ✅ Released |
| v1.0 | Extension Ecosystem | 已发布 — Provider Catalog 30+、Reasoning Effort、Guardrails webhook、API Key 管理完善 | ✅ Released |
| v1.1 | Developer Experience | 已发布 — Python SDK、Dashboard Playground、Session/Trace View、Agent 集成示例 | ✅ Released |
| v1.2 | Platform Capabilities | 已发布 — MCP Gateway、Batch API、Prompt Cache 智能路由、Model Pricing 自动同步 | ✅ Released |
| v1.3 | Production Ready | 已发布 — v1.3.2 生产就绪 + Dashboard Sidebar 可滚动与提示修补 | ✅ Released |
| v1.4 | Provider Ecosystem + Catalog Governance | 已发布 — v1.4.0 Provider Catalog 50+、价格来源治理、Catalog Dashboard UX、Provider Compatibility Profiles | ✅ Released |

---

## v1.4 — Provider Ecosystem + Catalog Governance（Provider 生态与目录治理）

**v1.4.0 发布状态**：已发布。v1.4 基于 v1.3.2，继续保持开源 Data Plane 单机 memory/SQLite 默认可用；Redis/Postgres/Cloud 仍为可选能力。本阶段把 Provider Catalog 从“常见 provider 列表”升级为更系统的本地治理数据源，让 Add Node、配置校验、价格来源状态、logo identity、多模态路由、Route Explanation、Benchmark 和 CLI 共用一份 catalog/pricing/compatibility 证据。

### P0：Provider Catalog 50+

- **状态**：✅ v1.4.0 已发布
- **目标**：将内置 Provider Catalog 扩展到 50+ providers，并优先补齐 Hugging Face、Cloudflare Workers AI、IBM watsonx.ai、Baseten、Lepton AI、Modal、RunPod、Predibase、Lamini、AI21 Labs、fal.ai、Stability AI、Black Forest Labs、Ideogram、Luma AI、Runway、Pika、ElevenLabs、Deepgram、AssemblyAI、Cartesia、Speechmatics、LM Studio、llama.cpp server、TGI、SGLang、Xinference 等高知名度 provider。
- **实现方案**：
  - 不新增第二套 catalog；继续复用 v0.8 引入并在 v0.9-v1.3 强化的 built-in + sync cache + `catalog.override.yaml` merge 结构
  - 每个内置 provider 统一声明 aliases、family/category、provider_type、homepage/docs/pricing URL、logo_id、auth_type、base_url、endpoints、modalities、input/output types、model buckets、capabilities、limits、pricing metadata、compatibility_profile
  - Catalog 区分 text、vision、image、audio、video、embedding、rerank、realtime、batch；MCP/tool 只作为 metadata 标记，不引入企业 marketplace
  - Model buckets 覆盖 `models`、`embedding_models`、`rerank_models`、`image_models`、`audio_models`、`video_models`、`realtime_models`、`batch_models`
  - 价格不再使用“占位”作为 operator-facing 表达；公开信息不稳定时标记 `manual_review_required` / `docs_review_required` / `pricing_confidence: low`
  - Provider logo identity 覆盖新增 provider，兼容 provider 不再误显示 OpenAI logo
  - 旧 `ProviderCatalogService` 诊断层投影到同一份 merged built-in catalog，避免两套 provider 列表漂移
  - Config validation 增加已知 provider 的 auth_type mismatch warning，并对未知 provider 给出不阻断启动的 catalog metadata 提示

### P0：Provider Catalog Pricing Source Governance

- **状态**：✅ v1.4.0 已发布
- **目标**：统一所有 provider/model 的 pricing schema、来源、新鲜度和路由成本回退，让成本路由与 Dashboard 解释使用同一套证据
- **实现方案**：
  - 保留 legacy `input/output/cache_read_input/cache_creation_input`，新增 `input_per_1m_tokens`、`output_per_1m_tokens`、cache、embedding、rerank、image、audio、video、realtime、batch 等统一字段
  - 新增 `source_type`、`source_url`、`retrieved_at`、`last_verified_at`、`stale_after_days`、`pricing_confidence`、`manual_review_required` 和 `review_reason`
  - 明确 resolver 优先级：node/model explicit pricing → `models_pricing` → `catalog.override.yaml` → sync cache → built-in catalog
  - Route Decision Trace 增加 pricing evidence：source、confidence、stale、used-from、missing units、estimated cost basis
  - Benchmark Report 与 RoutingService 共用 ConfigService pricing fallback，避免不同页面各算各的
  - Dashboard Provider Catalog、Route Explanation、CLI 与 config validation 使用“价格来源状态 / 需要复核 / 可能过期”文案

### P0：Provider Catalog Dashboard UX 2.0

- **状态**：✅ v1.4.0 已发布
- **实现方案**：
  - Dashboard Catalog API 为 provider 行补充 `family`、`provider_type`、`compatibility_profile`、`aliases`、`logo_id`、links、`model_buckets`、limits 与 `pricing_units`
  - Provider Catalog 页面改为 provider explorer：顶部 summary cards、family/type/modality/compatibility/price-source filters、stale/review quick filters、分组折叠列表与详情面板
  - Provider family 覆盖 Foundation Models、Aggregators、Cloud Platforms、China Providers、Self-hosted / Local、Image / Video、Speech / Audio、Embedding / Rerank
  - Add Node Wizard 继续通过 Catalog API 读取 provider preset，新增 family filter 与 alias/model 搜索，支持 Kimi/Moonshot、Qwen/Tongyi、Doubao/Volcengine 等别名
  - Add Node Wizard provider 列表使用受控滚动区域，50+ providers 时不撑爆表单，并保留 endpoint、headers、model aliases、prefixes、pricing、health check、custom provider 等高级字段
  - Nodes、Logs 与 Route Explanation 继续使用 provider identity，避免兼容 provider 错显示为 OpenAI
  - Dashboard 文案保持 en、zh、zh-TW、ja、ko、th、es 七语言同步

### P0：Provider Compatibility Profiles

- **状态**：✅ v1.4.0 已发布
- **目标**：把 50+ providers 的协议兼容、端点策略、能力映射和限制统一建模，并接入 routing、validation、Dashboard explanation
- **实现方案**：
  - 新增本地 `compatibility_profile` registry，覆盖 OpenAI-compatible、Responses、Anthropic Messages、Gemini、Vertex、Bedrock、Azure OpenAI、Hugging Face、OpenRouter、Cohere、Mistral、Ollama、vLLM、TGI、LM Studio、media、speech、rerank、embedding 等 profile
  - Provider Catalog providers 引用 `compatibility_profiles`；node config 可显式覆盖 `nodes[].compatibility_profile`
  - Config validation 检查 profile 是否存在、provider/profile 是否匹配、endpoint/source_format/modality 是否支持
  - RoutingService 根据 profile 过滤 source format、modality、stream、multipart、video async job 和 batch endpoint 不匹配的候选，并记录 filter/downgrade evidence
  - Route Decision Trace 增加 compatibility evidence：provider id、profile、endpoint/protocol strategy、passthrough/downgraded/unsupported fields、selected reason、filtered reason
  - Provider Compatibility Matrix 根据 profile 选择 safe probe，Dashboard Nodes、Provider Catalog、Logs、Route Explanation 展示只读 profile 证据
  - 不实现真实 provider SDK，不自动联网检测 provider；prompt/response/raw headers/provider keys/media bytes/video bytes 不落库

### v1.4 后续优化候选

- **Semantic Cache Redis backend**：Semantic Cache 仍为 preview，下一步优先补可选 Redis/vector-like 后端，同时保持 memory 默认和 metadata-only 隐私边界。
- **Prompt Registry / Template**：作为相对 Helicone 的功能性短板进入后续版本评估；优先做本地 registry、版本、审计和调用关联，不引入企业 Cloud 依赖。
- **Provider Catalog 单源化**：当前 `src/catalog/built-in-catalog.ts` 与 `src/catalog/provider-catalog.data.ts` 仍存在历史双投影维护成本。长期目标是收敛为一个 catalog source，再生成 Dashboard/API/legacy diagnostics 视图。
- **Provider contribution docs**：v1.4.0 新增 `docs/ADDING_PROVIDERS.md`，规范新增 provider 时的字段、pricing source、compatibility profile、logo identity 和测试清单。

## v1.3 — Production Ready（生产就绪）

**v1.3.2 发布状态**：v1.3 基于已发布 v1.2.0，继续保持开源 Data Plane 单机 memory/SQLite 默认可用；Redis/Postgres/Cloud 仍为可选能力。本阶段把前面版本的路由、目录、多模态、运维和平台能力收束成更完整的本地生产体验；v1.3.1 补充 Dashboard Sidebar 可滚动修复，避免导航项增多后底部不可达；v1.3.2 增加 Sidebar 动态滚动提示，让首屏用户能发现下方还有更多导航。

### P0：Virtual Key + Team 本地管理

- **状态**：✅ v1.3.0 已发布
- **目标**：让开源版本地 Dashboard 可以管理多组客户端 key，并用本地 team 统一套用权限、预算、限流和审计策略
- **实现方案**：
  - 新增本地 `local_teams` 表，SQLite 默认可用，PostgreSQL 兼容
  - Gateway API key 支持 `team_id`，并继续支持 namespace、allowed endpoints/models/nodes/modalities、daily token/cost budget 和 RPM limit
  - 有效权限按 key、team、namespace 交叉取交集；rate limit 使用 key/team/namespace 中最严格值
  - BudgetService 检查 global、namespace、team、key 四层预算，call logs 写入 `team_id` 以支持 team usage summary
  - Dashboard API 新增 `GET/POST/PUT/DELETE /api/dashboard/teams`
  - Dashboard API Keys 页面增加本地 Team 创建、编辑、禁用、删除、使用摘要和 key 绑定
  - API key create/rotate 仍只显示完整 secret 一次；list/update/delete 只显示 masked prefix；team API 不返回 secret
  - Team/key mutation 写入本地 config audit event，摘要不保存 provider key、Gateway API key、raw auth headers 或 secret
  - Dashboard 文案继续补齐 en、zh、zh-TW、ja、ko、th、es 七语言
  - 不做企业 SSO、SCIM、workspace、RBAC、org billing 或 Cloud 依赖

### P0：Semantic Caching Preview

- **状态**：✅ v1.3.0 已发布
- **目标**：在默认关闭的前提下，用 embedding 相似度判断可复用响应，减少重复语义请求成本，并在 Logs 与 Route Explanation 中展示 metadata-only 命中证据
- **实现方案**：
  - `semantic_cache.enabled` 默认 `false`
  - memory 后端默认可用；Redis/vector backend 后续可选
  - 支持 `similarity_threshold`、`ttl_seconds`、namespace/API key/model/endpoint 隔离
  - 默认只保存 embedding/hash/metadata，不保存敏感 prompt/response；如未来启用样本存储必须显式配置和脱敏
  - Route Explanation 与 call logs 标记 `semantic_cache_hit`、相似度分数、阈值和 metadata-only 状态

### P0：Evaluation Framework Preview

- **状态**：✅ v1.3.0 已发布
- **目标**：支持本地 eval dataset metadata、judge config、experiment run metadata，并通过普通 SiftGate routing 执行 LLM-as-judge，不引入企业服务
- **实现方案**：
  - 新增 `eval_datasets`、`eval_experiment_runs`、`eval_sample_results` 本地表，SQLite 默认可用，PostgreSQL 兼容
  - 新增 Dashboard API `GET /api/dashboard/evals/reports`、`GET /api/dashboard/evals/reports/:id` 和本地 automation 入口 `POST /api/dashboard/evals/runs`
  - primary、candidate、judge 调用都走 `PipelineService.process`，复用现有 routing、fallback、budget、telemetry、call log 和 route trace
  - 报告展示 success、latency、cost、fallback、judge score、winner 和 sample-level request ids
  - Dashboard 新增只读 Eval Reports 页面，不提供自动修改 routing 的入口
  - 默认不保存 prompt、response、raw headers、provider keys、media bytes 或 video bytes；如启用 sample preview，必须配置和请求双重显式 opt-in，并进行脱敏/截断
  - 文档新增 `docs/EVALUATION_FRAMEWORK.md`，Dashboard 文案同步 en、zh、zh-TW、ja、ko、th、es

### P0：文档与社区资产

- **状态**：✅ v1.3.0 已发布
- **目标**：让开源仓库具备清晰的产品入口、贡献路径、安全策略、问题模板和发布前文档安全检查
- **实现方案**：
  - README 重构为开源 Data Plane 产品入口，不包含私有仓库依赖或企业版实现内容
  - 新增 Quickstart、SDKs、Playground、Batch、Caching、Security 等 docs 入口，并整理 Production、Kubernetes、Provider Catalog、MCP、Eval 文档地图
  - 新增 `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、issue templates 和 PR template
  - 新增 `npm run docs:check`，检查必需文档、Markdown 相对链接、常见 secret、`gateway.config.yaml` 入库风险和私有仓库引用

## v1.2 — Platform Capabilities（平台能力）

**v1.2.0 发布状态**：v1.2 基于已发布 v1.1.0，继续保持开源 Data Plane 单机 memory/SQLite 默认可用；Redis/Postgres/Cloud 仍为可选能力。本阶段把 SiftGate 从多协议网关推进到更完整的平台能力层：MCP Gateway preview、OpenAI-compatible Batch API proxy、Prompt Cache 智能路由与 Model Pricing 自动同步。

### P0：MCP Gateway Preview

- **状态**：✅ v1.2.0 已发布
- **目标**：让 SiftGate 可以作为本地 MCP server 代理入口，用现有 Gateway API key、namespace、rate limit 和 Dashboard metadata 审计保护 agent/tool 调用路径
- **实现方案**：
  - 新增 `mcp` 本地 registry/config，默认 disabled，支持 `servers[].id/name/url/transport/headers/allowed_namespaces/tools`
  - 新增 `POST /mcp/:serverId` JSON-RPC preview 代理，复用 `ApiKeyGuard` 和 `RateLimitGuard`
  - API key endpoint 权限支持 `mcp`、`mcp:<serverId>`、`mcp:<serverId>:<toolName>`，并与 server `allowed_namespaces` 交叉校验
  - 上游 headers 通过 `SecretReferenceResolverService` 解析，Dashboard 不展示 resolved secret
  - 新增 `GET /api/dashboard/mcp` 和 Dashboard MCP Gateway 页面，展示 server、tool、recent calls、error summary
  - 本地 audit 默认只保留 metadata：server、method、tool name、API key、namespace、status、latency、byte size、error type
  - 不保存 tool input/output 原文、raw headers、provider keys、resolved secret、media bytes 或 marketplace metadata

### P0：Batch API Proxy

- **状态**：✅ v1.2.0 已发布
- **目标**：支持 OpenAI-compatible Batch API 创建、查询、取消和结果下载代理，同时保持本地 metadata-only 的隐私边界
- **实现方案**：
  - 新增 `POST /v1/batches`、`GET /v1/batches/:id`、`POST /v1/batches/:id/cancel`、`GET /v1/batches/:id/output`、`GET /v1/batches/:id/errors`
  - 节点配置支持 `batch_endpoint`、`batch_status_endpoint`、`batch_cancel_endpoint`、`batch_result_endpoint`
  - 本地 `batch_jobs` 只保存 request id、provider batch id、node/model hint、endpoint、file ids、request counts、status、timestamps、API key/namespace attribution、metadata keys 和脱敏错误
  - 不保存 batch input JSONL、provider output JSONL、raw headers、provider keys、metadata values 或文件 bytes
  - Gateway API key、namespace、budget、rate limit、call_log、telemetry 覆盖 Batch 路径
  - Dashboard 新增只读 Batch Jobs 页面和 `GET /api/dashboard/batches`，文案保持 7 语言同步

### P0：Prompt Cache 智能路由

- **状态**：✅ v1.2.0 已发布
- **目标**：在不改变本地 prompt cache 默认行为的前提下，让 `routing.optimization=cost` 与 `balanced` 能识别 provider cache 能力、cache-read 价格、观察到的 provider cache hit 率，并在 Route Explanation 中解释为什么偏好某个 node/model
- **实现方案**：
  - `nodes[]` 与 `model_capabilities[]` 增加 `prompt_cache`、`read_cache`、`write_cache` 标记
  - `models_pricing`、`model_capabilities[].pricing` 与 Provider Catalog pricing 支持 `cache_read_input`、`cache_creation_input`
  - Pipeline 仍先执行本地 prompt cache lookup；本地命中时直接返回，不进入上游路由，不改变现有默认行为
  - 本地 miss 或 cache disabled 时，RoutingService 在 cost/balanced 模式下把 provider cache capability、cache-read 单价、观察到的 cache-read hit rate 纳入候选排序
  - Route Decision Trace 增加 `cache_evidence`，只记录 metadata：本地 lookup 状态、provider cache capability、观察命中率、cache-read/write token 计数、估算节省，不保存 prompt/response/raw headers/provider keys
  - Dashboard Route Explanation 展示 cache evidence；Logs 显示本地 bypass 或 provider cache evidence；Benchmarks 展示 `cache_summary`、provider/local hit rate 与 read-token ratio

### P1：Model Pricing 自动同步框架

- **状态**：✅ v1.2.0 已发布
- **目标**：在现有 Provider Catalog refresh 基础上增加可选 scheduled sync，让成本路由能使用更及时的公开模型/价格元数据，同时避免覆盖用户显式配置
- **实现方案**：
  - `catalog.sync.enabled` 默认 `false`，不会在启动后自动联网
  - 必须显式启用 provider adapter；v1.2 首批仅支持 `catalog.sync.adapters.openrouter.enabled: true`
  - OpenRouter adapter 复用公开 `/api/v1/models` 数据，写入 `last_sync`、`source_url`、`pricing_confidence`、`stale_after_days`
  - 默认 `write_to: cache`，写入 `.siftgate/catalog-sync-cache.yaml`；加载顺序为 built-in → sync cache → `catalog.override.yaml`
  - 用户显式 `catalog.override.yaml`、node `model_capabilities[].pricing` 和 `models_pricing` 永远优先
  - CLI 新增 `siftgate catalog sync openrouter`，Dashboard Provider Catalog 展示 sync status、last sync、stale 状态、source URL 和 confidence
  - 其他 Provider 保持 `docs_review` / `operator_local`，由运维人员通过本地 override 管理

## v1.1 — Developer Experience（开发者体验）

**v1.1.0 发布状态**：v1.1 基于已发布 v1.0.0，继续保持开源 Data Plane 单机 memory/SQLite 默认可用；Redis/Postgres/Cloud 仍为可选能力。本阶段重点是让开发者更容易接入、测试、排障和理解一次调用在 SiftGate 内的完整路径。

### P0：Python SDK

- **状态**：✅ v1.1.0 已发布
- **目标**：提供 `pip install -e packages/python` 可用的轻量 Python SDK scaffold，同时保持用户可继续使用 OpenAI SDK + `base_url`
- **实现方案**：
  - 新增 `packages/python`，包名 `siftgate`，`pyproject.toml` 使用 setuptools，运行时保持 stdlib-only
  - `SiftGateClient` 支持 `base_url`、`gateway_api_key`、默认 headers、timeout、可注入 transport、`request_raw`
  - 提供 models、chat completions、responses、messages、embeddings、rerank、images、audio、video generations/jobs endpoint helpers
  - `routing_hint` 编码为 `x-siftgate-routing-hint`，只作为建议，不绕过 Gateway API key 权限、namespace、budget、rate limit 或路由策略
  - `SiftGateError` 暴露 `status_code`、`body`、`request_id`，并尽量解析 JSON/text 错误体
  - README 说明本地安装、OpenAI SDK `base_url` 替代路径、multipart media passthrough、raw response 使用方式
  - 增加 Python SDK unit tests 和根脚本 `npm run test:python-sdk`

---

### P0：Dashboard Playground 交互式测试页面

- **状态**：✅ v1.1.0 已发布
- **目标**：让本地 Dashboard 具备安全的交互式探测入口，覆盖主要协议和多模态能力，同时复用真实 routing、权限、预算、成本、telemetry、call log 和 route decision 路径
- **实现方案**：
  - 新增 Dashboard 页面 `/playground`，支持 chat、responses、messages、embeddings、rerank、images、audio、video、realtime probe
  - 支持选择本地 Gateway API key、namespace、model、endpoint、routing hint 和 stream
  - 默认样例保持 tiny/synthetic，避免自动发送用户真实内容；用户必须手动点击 run
  - 新增 Dashboard API `POST /api/dashboard/playground/run`，由 Dashboard session 保护，并通过 API key id 套用权限上下文，不把明文 Gateway API key 或 provider key 传给前端
  - 展示 request preview、response summary、usage、cost、latency、status 和 Route Decision link
  - Realtime 只做 endpoint/auth/capability probe，不打开 WebSocket，不影响 HTTP/SSE streaming
  - 默认不保存 Playground prompt、response、raw headers、provider key、media bytes 或 realtime frames；普通 call log 只保留元数据
  - 新增 Dashboard 7 语言本地化和前端静态检查，覆盖 route、hook、endpoint coverage、privacy copy 和 API types

### P0：Session / Trace 关联与 Session View

- **状态**：✅ v1.1.0 已发布
- **目标**：把单条请求日志升级为会话级链路视图，方便开发者和运维人员排查一轮 agent、应用会话或多步骤工作流里的模型切换、fallback、成本、延迟和错误
- **实现方案**：
  - Normalizer 统一读取 `x-session-id`、legacy `x-session-key`、`x-siftgate-session-id`、`x-trace-id`、`x-siftgate-trace-id`、W3C `traceparent` 与 request-id fallback
  - `call_logs`、`route_decisions`、`shadow_traffic_results` 增加 `session_id` / `trace_id` 关联字段，保留旧 `session_key` 兼容
  - Pipeline 在 call log、Route Decision Trace、OpenTelemetry span attributes 和 shadow traffic result 中写入 session/trace metadata
  - Dashboard API 新增 `GET /api/dashboard/sessions` 与 `GET /api/dashboard/sessions/:sessionId`
  - Dashboard 新增只读 Session View，按 session 展示请求时间线、模型切换、fallback、成本、延迟、错误、shadow、guardrails finding 摘要和 Route Explanation 链接
  - 支持 namespace、API key、model、source format、period 过滤
  - 不保存 prompt、response、raw headers、provider key、media bytes 或 video bytes
  - Dashboard 文案保持 en、zh、zh-TW、ja、ko、th、es 七语言同步

### P1：Agent 框架集成示例

- **状态**：✅ v1.1.0 已发布
- **目标**：提供可本地运行的示例，展示 LangChain、CrewAI、OpenAI Agents SDK 和 OpenAI SDK `base_url` 如何通过 SiftGate 发送请求
- **实现方案**：
  - 新增 `examples/agents`，包含 `.env.example`、共享 headers helper、requirements 和四个 Python 示例
  - 示例统一使用 `SIFTGATE_BASE_URL`、`SIFTGATE_API_KEY`、`SIFTGATE_MODEL`、`SIFTGATE_NAMESPACE`、`SIFTGATE_SESSION_ID`、`SIFTGATE_TRACE_ID`、`SIFTGATE_ROUTING_HINT`
  - 每个示例展示 Gateway API key、advisory routing hint、namespace label、session/trace correlation 和 structured output intent
  - 文档说明如何在 Dashboard Logs、API Keys、Benchmarks、Route Explanation 中观察 agent 成本、fallback、选中的 node/model 和路由理由
  - 不提交真实 provider key；静态测试检查示例文件、框架覆盖、headers、structured-output markers 和 secret hygiene

## v1.0 — Extension Ecosystem（扩展生态）

**v1.0.0 发布状态**：v1.0 基于已发布 v0.9.3，继续保持开源 Data Plane 单机 memory/SQLite 默认可用；Redis/Postgres/Cloud 仍为可选能力。本阶段重点是扩展 provider 生态、跨协议能力映射、安全插件和本地 Dashboard 运维体验，不引入企业 workspace/RBAC/SSO/SCIM。

### P0：Provider Catalog 30+

- **状态**：✅ v1.0.0 已发布
- **目标**：优先补齐 Bedrock、千问、文心、豆包、智谱、Moonshot 等生态缺口，让 Dashboard Add Node 不再只能覆盖欧美主流 provider
- **实现方案**：
  - 内置 catalog 新增 AWS Bedrock、Alibaba Qwen/通义千问、Baidu Qianfan/文心、Volcengine Ark/豆包、Zhipu GLM/智谱、Moonshot/Kimi、MiniMax、Tencent Hunyuan/腾讯混元、01.AI/Yi、Replicate、Perplexity、NVIDIA NIM、Cerebras、SambaNova
  - 每个 provider 都声明 provider id、display name、base URL、endpoint buckets、auth style、modalities、model buckets、capabilities、limits 和 pricing metadata
  - pricing metadata 必须带 `source`、`source_url`、`last_updated`、`pricing_confidence`、`manual_review_required`，避免 Dashboard 显示“占位”式文案
  - Dashboard Add Node 继续通过 catalog API/shared type 读取 provider/model，不在表单组件里硬编码 provider 列表
  - Config validation 针对新 provider 输出 model、endpoint、pricing、capability warnings
  - Dashboard provider identity registry 补齐新 provider，兼容 provider 不再误显示 OpenAI logo
  - 补 catalog service、CLI、Dashboard API、provider logo identity、config validation tests

### P0：Reasoning Effort 跨协议映射

- **状态**：✅ v1.0.0 已发布
- **目标**：统一 OpenAI、Responses、Anthropic、Gemini 兼容风格的 reasoning/thinking 请求意图，路由时优先选择支持 reasoning 的模型，并在 Dashboard 解释为什么保留、映射或降级
- **实现方案**：
  - Canonical Request 增加 `reasoning_effort`、`thinking`、`budget_tokens` 与 `reasoning` intent 字段
  - Chat Completions 支持 `reasoning_effort`，Responses 支持 `reasoning.effort`，Anthropic Messages 支持 `thinking.type=enabled` / `budget_tokens`，OpenAI-compatible Gemini 风格支持 `thinking_config`
  - provider forwarding 同协议透传；跨协议只在安全时映射，不安全时保留 canonical metadata，并记录 `passthrough` / `native` / `downgraded` / `unsupported`
  - `nodes[].supports_reasoning` 与 `model_capabilities[].supports_reasoning` 可显式声明模型是否支持 reasoning controls
  - RoutingService 对显式 reasoning 请求优先选择 reasoning-capable node:model；如果只有未知能力目标，保持兼容，不破坏旧配置
  - call logs、external log sinks、control-plane metadata、Route Decision Trace 和 Dashboard Logs/Route Explanation 展示 reasoning intent、effort、budget、strategy、support 与 fallback/downgrade reason
  - 不保存 prompt、response、hidden chain-of-thought、raw headers 或 provider keys

### P0：Guardrails Webhook Finding Sink 与规则扩展

- **状态**：✅ v1.0.0 已发布
- **目标**：把官方 `plugins/guardrails` 升级为更完整的本地治理插件，支持 metadata-only webhook finding sink，并补齐 secret/token、jailbreak、unsafe URL、schema strictness、tool-call policy 等规则
- **实现方案**：
  - Guardrails rule action 扩展为 `audit`、`redact`、`block`、`allow`、`webhook`
  - webhook sink 默认关闭，显式启用后异步发送 `siftgate.guardrails.findings.v1` metadata
  - webhook 支持 `debounce_seconds`、`retry.attempts`、`retry.backoff_ms`、`timeout_ms`、`max_queue`、`drop_policy`
  - webhook payload 和 Dashboard status 不包含 prompt、response、matched text、raw headers、provider key、media/video bytes、webhook URL 或 webhook headers
  - 内置规则扩展：PII 扩展字段、secret/token pattern、prompt injection、jailbreak、unsafe URL、schema strictness、tool-call policy
  - Dashboard 新增 `GET /api/dashboard/guardrails` 摘要和首页 Guardrails 卡片，展示 finding counters、最近 finding metadata、webhook queue/drop/recent 状态
  - 插件继续默认 disabled/no-op，单机 memory/SQLite 默认可用，不依赖 Redis/Postgres/Cloud

### P0：API Key 管理 Dashboard 完善

- **状态**：✅ v1.0.0 已发布
- **目标**：把本地 Gateway API Key 页面补齐到生产可用的密钥治理入口，同时保持开源边界清晰
- **实现方案**：
  - Dashboard 支持创建、编辑、禁用、删除、rotate、一次性复制完整 key；列表和详情只显示 masked prefix
  - Key policy 支持 `allowed_nodes`、`allowed_models`、`allowed_endpoints`、`allowed_modalities`
  - 支持本地 namespace 绑定、per-key daily token/cost budget、per-key RPM rate limit
  - API key summary 展示 status、last used、calls、cost、error rate
  - 请求管线在 provider forwarding 前执行 endpoint/modality 权限检查；`/v1/models` 按 key 权限过滤 model list
  - Dashboard API key 变更写入本地 config audit event，审计摘要不保存完整 key、provider key、raw auth headers 或 secret
  - Dashboard 新增文案补齐 en、zh、zh-TW、ja、ko、th、es 七语言本地化
  - 补 auth service、Dashboard API、pipeline permissions、DB migrator、frontend static checks 和隐私测试

---

## v0.9 — Operations + Trust（本地运维 + 信任基础）

**v0.9.3 发布状态**：v0.7 不再单独发布；v0.9 承接原 v0.7 Operations + Trust backlog，并基于已发布 v0.8.0 的 Provider Catalog、多模态入口、Video Preview、兼容性矩阵与 Route Explanation 继续增强。v0.9.1 修复 Dashboard provider compatibility probe 和 Provider Catalog logo identity；v0.9.2 进一步把“pricing hygiene”产品化为“价格来源状态”，改进 Provider Catalog 表格布局，并新增 OpenRouter 公开目录刷新 workflow；v0.9.3 优化 Provider Catalog 来源折叠、Routing 页面空间分配和 Logs 的缓存语义展示。默认仍保持单机 memory/SQLite 可用；Redis/Postgres/Cloud 只作为可选能力。

### P0：本地配置审计与配置版本回滚

- **状态**：✅ v0.9.0 已发布
- **目标**：让开源 Data Plane 在不依赖 Cloud 的情况下具备本地配置版本、审计事件和安全 rollback 能力
- **实现方案**：
  - 新增 `config_versions` 与 `config_audit_events` 本地表，SQLite 默认可用，PostgreSQL 兼容
  - `config_audit` 配置支持 `enabled`、`max_versions`、`max_events`、`capture_startup_snapshot`
  - Dashboard reload、node create/update/delete、routing update、Dashboard API key 管理和 rollback 都记录审计事件
  - 版本快照保存安全 YAML：provider API key、dashboard password hash、raw auth headers、secret/token/password-like 字段脱敏
  - rollback 先解析和校验目标配置；如果 secret 不能从当前本地配置安全回填，或配置校验失败，则保留当前配置
  - Dashboard 新增 Config Audit 只读页面：版本列表、脱敏版本详情、审计事件流、确认式 rollback
  - `migrate-db` 覆盖 `config_versions` 与 `config_audit_events`
  - 新增 `docs/CONFIG_AUDIT_ROLLBACK.md`，并更新 API、Architecture、Production 文档

### P0：Secret Manager References

- **状态**：✅ v0.9.0 已发布
- **目标**：让开源 Data Plane 在不引入企业私有依赖的前提下支持可选 secret reference，减少明文 provider key 和控制面 token 出现在本地配置中的风险
- **实现方案**：
  - 支持 `${env:OPENAI_API_KEY}`、`${vault:path/to/secret#field}`、`${aws-sm:secret-name#field}`、`${gcp-sm:secret-name#field}`
  - 默认只启用 env；Vault/AWS/GCP 必须在 `secret_manager.backends` 显式开启
  - `SecretReferenceResolverService` 提供本地 TTL cache 与 `fail_closed` / `fail_open_for_optional` 行为
  - Vault/AWS/GCP 第一版使用 SDK-less HTTP/mockable adapter，不引入重量级云 SDK
  - 覆盖 `nodes[].api_key`、`nodes[].headers`、Active Health Probe、Realtime upstream auth、Provider Compatibility Test、Video provider proxy 与 `control_plane.registration_token`
  - Dashboard config/API/log/route trace/compatibility result 不返回 resolved secret；literal secret 与敏感 headers 继续脱敏
  - Config validation 诊断未启用 backend、格式错误、env 未设置、secret-manager 配置形状与 catalog override 中的疑似 secret

### Shadow Traffic Comparison Report

- **状态**：✅ v0.9.0 已发布
- **目标**：把 v0.5 的只读 shadow results 升级为灰度决策报告，但不自动修改 routing 配置
- **实现方案**：
  - 新增 `GET /api/dashboard/shadow/report`，按 namespace、API key、node、model、period、source format 过滤
  - 新增 `GET /api/dashboard/shadow/results/:id/comparison`，按单条 shadow result 返回主路径与 shadow 指标差异
  - 报告输出 `primary_success_rate`、`shadow_success_rate`、`latency_delta_ms`、p50/p95 latency comparison、`cost_delta_usd`、`potential_savings_usd`、`token_delta`、`fallback_delta`、`quality_sample_coverage`、`confidence`、`risk_notes`
  - 通过 `request_id` 将 `shadow_traffic_results` 与 `call_logs` 配对，shadow 成本使用本地 `models_pricing` / node model capability pricing 估算
  - Dashboard Shadow 页面新增 overview cards、primary vs shadow table、risk/confidence labels 与 7 语言本地化
  - 默认不保存 prompt、response、raw headers、provider key、media bytes、video bytes
  - 如果显式开启 `shadow.compare.store_prompts` 或 `store_responses`，样本会内置脱敏并按 `shadow.compare.sample_max_chars` 截断，Dashboard 与 config validation 都会提示风险
  - 页面保持只读，不提供自动应用 routing 修改的按钮或 API 调用

### P0：官方 Guardrails 插件升级

- **状态**：✅ v0.9.0 已发布
- **目标**：把 `plugins/guardrails` 从 skeleton 升级为可用的本地安全插件，同时保持默认 disabled/no-op 和隐私安全默认值
- **实现方案**：
  - 支持 PII detection，并可按配置 `audit`、`redact` 或 `block`
  - 支持 lightweight prompt injection checks，例如忽略系统指令、隐藏 prompt 泄露、jailbreak、developer mode 等常见模式
  - 支持 schema validation helper，覆盖安全的 request/response metadata 文档或 JSON output
  - 支持 `policies[]` named allow/block/redact/audit rules，保留 legacy `input_patterns` / `output_patterns`
  - 支持 input hook、output hook 与 conservative streaming delta handling
  - 默认不保存 prompt/response；finding 只包含 `request_id`、rule、kind、action、path、count、schema error summary 等 metadata
  - 与 structured output fallback 保持兼容：核心 fallback 继续由 `routing.fallback_policy.structured_output` 处理；guardrails schema finding 可按配置 block 并记录 fallback intent metadata
  - 插件继续进入 `dist-runtime-plugins`，兼容生产 Docker

### P0：Helm Chart 与 Kubernetes Manifests

- **状态**：✅ v0.9.0 已发布
- **目标**：补齐开源 Data Plane 的 Kubernetes 部署入口，让用户可以从 Docker Compose 平滑进入集群部署
- **实现方案**：
  - 新增 `deploy/helm/siftgate` Helm chart
  - 新增 `deploy/kubernetes/base` Kustomize/plain manifests
  - 默认 `values.yaml` 保持单机可用：memory state backend、SQLite PVC、无 Cloud、无企业镜像、无真实 secrets
  - Helm values 支持 Redis、PostgreSQL、Ingress、HPA、PodDisruptionBudget、ServiceMonitor、existing Secret/ConfigMap、resources、persistence
  - Kubernetes Secret 示例只包含 placeholder，不提交真实 provider key
  - gateway config 示例覆盖 v0.8 Provider Catalog、多模态 media/audio/image、structured output、realtime disabled、SQLite/memory defaults 等关键字段
  - 新增 `npm run validate:k8s`，检查 YAML 解析、模板存在、Cloud 默认关闭、secret hygiene、image/port/config mount 基础正确性

### P1：Benchmark Report API 与 Dashboard 页面

- **状态**：✅ v0.9.0 已发布
- **目标**：把本地 call_log 变成可读的性能证据页，帮助用户比较节点、模型、协议入口和部署变化，但不自动修改 routing 配置
- **实现方案**：
  - 新增 `GET /api/dashboard/benchmarks/report`
  - 报告包含 total requests、success/error/fallback/cache rate、p50/p75/p95/p99 latency、throughput estimate、cost/token summary、status code distribution、node:model breakdown、source_format/source_family breakdown
  - source breakdown 覆盖 chat、responses、messages、embeddings、rerank、images、audio、video、realtime
  - 支持 `period`、`namespace`、`api_key_id` / legacy `api_key`、`node`、`model`、`source_format` 过滤
  - route trace coverage 会提示性能样本中有多少请求可继续打开 Route Explanation
  - Dashboard 新增只读 Benchmarks 页面，展示 methodology notes，避免用户把本地样本误读为严格云 benchmark
  - 增强 `npm run benchmark:upstream`，支持 `GATEWAY_BENCH_OUTPUT=report.json` 输出 JSON 摘要
  - 不保存 prompt、response、raw headers、provider key、media bytes 或 video bytes

### P1：兼容迁移工具扩展

- **状态**：✅ v0.9.0 已发布
- **目标**：降低从 LiteLLM、New API、One API 迁移到 SiftGate OSS Data Plane 的配置成本，同时允许把 SiftGate 配置导出成相邻网关 scaffold，方便评估和回迁
- **实现方案**：
  - 保留 `siftgate migrate --from litellm --config ./litellm_config.yaml`
  - 新增 `--from newapi` 与 `--from oneapi`，将 channel config 转为 SiftGate `gateway.config.yaml`
  - 新增 `--to litellm|newapi|oneapi`，从 SiftGate `gateway.config.yaml` 生成 scaffold
  - 默认不覆盖已有输出文件；`--force` 才允许覆盖，`--overwrite` 作为旧脚本兼容别名
  - 映射 provider、model、base URL、API key env ref、fallback/router 设置和 v0.8 模型桶：`models`、`embedding_models`、`rerank_models`、`image_models`、`audio_models`、`video_models`、`realtime_models`
  - 使用 Provider Catalog 生成 endpoint、pricing、capability、context/dimensions 等 hints，并在报告中标注 pricing/capability confidence
  - 对无法准确映射的源字段写入 `manual_actions` 或 `partially_supported`，避免静默丢失
  - 不复制 literal provider API key；改写为环境变量引用并写入手动处理项
  - 补 LiteLLM、New API、One API、SiftGate v0.8 fixtures，以及 CLI、报告、overwrite protection 单测

### Provider Catalog Price Source Status

- **状态**：✅ v0.9.0 已发布
- **目标**：复用 v0.8 Provider / Model Catalog 与 `catalog.override.yaml`，补齐价格来源状态、过期检查、可刷新来源和 cost routing fallback
- **实现方案**：
  - 不新增第二套 Model Catalog；继续使用 built-in + local override 的合并 catalog
  - pricing metadata 扩展 `currency`、`units`、image/audio/video/rerank/embedding price/unit、`stale_after_days`、`pricing_confidence`
  - Config validation 输出价格来源状态 warnings：缺失、需复核、stale、modality unit mismatch、`routing.optimization=cost` 缺必要价格
  - Cost/context routing 在显式 node/model pricing 与 `models_pricing` 缺失时回退到 merged catalog pricing；显式用户配置永远优先
  - Dashboard 新增只读 Provider Catalog 页面，展示 freshness、manual review、source、source URL、confidence、override 状态和 refresh source
  - Catalog CLI 支持 `siftgate catalog validate --pricing`、`siftgate catalog export --include-pricing`、`siftgate catalog sources`
  - v0.9.2 新增 `siftgate catalog refresh openrouter --out catalog.override.yaml`，从 OpenRouter 公开模型 API 生成本地 override，并把 USD/token 转成 USD/1M tokens
  - 不做广义官网抓取；OpenAI、Anthropic、Google、Azure、本地模型和自建 OpenAI-compatible 仍需要 docs review 或 operator-local override

---

## v0.8 — Provider + Media Maturity（Provider 体验 + 多模态生产化）

**v0.8.0 发布状态**：已完成 Provider / Model Catalog、Dashboard Add Node Wizard、Images / Audio 生产化增强、Video Generation async preview、Provider Compatibility Test Matrix、Catalog Update / Override CLI 与多模态 Route Explanation evidence。默认仍保持单机 memory/SQLite 可用；Redis/Postgres/Cloud 只作为可选能力。

### P0：Provider / Model Catalog

- **状态**：✅ Prompt 46 feature branch 已完成
- **目标**：为 provider、model、modalities、endpoint、auth、pricing、capability、limits 建立本地静态目录
- **实现方案**：
  - 新增内置静态 catalog 模块，不自动联网更新
  - 初始覆盖 OpenAI、Anthropic、Google Gemini/Vertex、Azure OpenAI、OpenRouter、Groq、Mistral、DeepSeek、xAI、Cohere、Voyage、Jina、Together、Fireworks、Ollama、vLLM、OpenAI-compatible custom
  - catalog 区分 `text`、`vision`、`image`、`audio`、`video`、`embedding`、`rerank`、`realtime`
  - Dashboard API 提供 `GET /api/dashboard/catalog/providers` 和 `GET /api/dashboard/catalog/models`
  - `siftgate catalog list/show/validate/export/import` 与 `npm run catalog` 支持本地 `catalog.override.yaml`
  - Dashboard API 读取 built-in + override 合并结果，并标记 `overridden`
  - Dashboard Add Node 从 catalog API 读取 provider preset，不再在组件中硬编码 provider/model 列表
  - Config validation 使用 catalog 输出 warning：未知模型、endpoint/modality 不匹配、pricing 需要人工确认
  - override 文件禁止 provider API key；疑似 secret 字段/值会给出 error/warning
  - pricing 可为 placeholder，但必须包含 `source`、`last_updated`、`manual_review_required`

### P0：Dashboard Add Node Wizard

- **状态**：✅ Prompt 47 feature branch 已完成
- **目标**：把 Add Node 从单页长表单升级为 catalog-backed 分步向导，减少 provider/model 配置错误，同时保留高级 YAML 能力
- **实现方案**：
  - Step 1 选择 provider、OpenAI-compatible proxy 或 custom upstream
  - Step 2 选择能力：Chat、Responses、Messages、Embeddings、Rerank、Images、Audio、Video、Realtime
  - Step 3 编辑模型桶：`models`、`embedding_models`、`rerank_models`、`image_models`、`audio_models`、`video_models`、`realtime_models`
  - Step 4 确认 `base_url`、endpoint、auth、headers、model aliases、prefixes、pricing、capability tags、health check、concurrency/queue controls
  - Step 5 针对 Chat/Text 模型执行连接测试并保存到本地 `gateway.config.yaml`
  - Provider 选择后自动填充 `base_url`、`auth_type`、endpoint、suggested models、`model_prefixes`、capability flags 和 pricing metadata
  - 新增 `video_models`、`video_generations_endpoint`、`video_status_endpoint` 配置面，并接入 v0.8 experimental async video preview
  - Dashboard 新增文案继续保持 English、简体中文、繁体中文、日文、韩文、泰文、西班牙文 7 语言同步
  - 不接入 Cloud，不自动联网更新 catalog，不自动修改 routing 配置

### P0：Images / Audio 生产化增强

- **状态**：✅ Prompt 48 feature branch 已完成
- **目标**：补齐 image variations 与 audio translations，统一 media 请求元数据，并让 Dashboard logs 能看懂媒体请求发生了什么
- **实现方案**：
  - Images 支持 `/v1/images/generations`、`/v1/images/edits`、`/v1/images/variations`
  - Audio 支持 `/v1/audio/transcriptions`、`/v1/audio/translations`、`/v1/audio/speech`
  - JSON 与 `multipart/form-data` 都沿用 pass-through；不做本地图像/音频解析、转码、剪辑、压缩或内容保存
  - Canonical media metadata 记录 `media_type`、`operation`、`multipart`、`file_count`、`byte_size`、`requested_format`、`response_format`
  - Provider response 只记录安全的 content type 摘要，用于 Dashboard logs、CSV/JSON export、log sink 和可选 telemetry
  - 新增 `images_variations_endpoint` 与 `audio_translations_endpoint` 配置项，兼容 OpenAI-compatible upstream/proxy
  - API key、namespace、budget、rate limit、fallback、call_log、telemetry 继续复用现有 Data Plane 管线
  - Config validation 校验 media endpoint path、model bucket、`max_file_size` 与 pricing 诊断

### P0：Video Generation Async Preview

- **状态**：✅ v0.8.0 已发布
- **目标**：用 async job 模型提供实验性视频生成入口，不假设视频可以同步返回
- **实现方案**：
  - 新增 `POST /v1/videos/generations`、`GET /v1/videos/:id`、`GET /v1/videos/:id/content`、`POST /v1/videos/:id/cancel`
  - 支持 JSON pass-through，按 `nodes[].video_models`、`video_endpoint` / `video_generations_endpoint` 路由
  - 本地 SQLite/Postgres 保存 `video_jobs` metadata：request id、provider job id、node、model、status、timestamps、error
  - 不保存 prompt、源图片、视频 bytes、raw headers 或 provider key
  - status/content/cancel 只在 node 配置了对应 endpoint 时代理到 provider

### P0：Provider Compatibility Test Matrix

- **状态**：✅ Prompt 50 feature branch 已完成
- **目标**：把 Add Node/Test Connection 从“能不能连上”升级成“这个 node 是否真的支持所选能力”
- **实现方案**：
  - 扩展现有 `POST /api/dashboard/nodes/:id/test`，支持 `chat`、`responses`、`messages`、`embeddings`、`rerank`、`images`、`audio`、`video`、`realtime`
  - 默认使用低成本安全探测：text/embedding/rerank 使用合成 `ping` 小请求；image/audio/video/realtime 默认只做 endpoint/auth probe
  - video/realtime 不默认启动真实生成或长连接，避免意外成本
  - 本地保存 `provider_compatibility_results` 元数据：capability、configured、tested、last_status、last_checked_at、latency、HTTP status、sanitized failure_reason
  - 不保存 prompt、response、raw headers、provider key、media bytes 或 realtime frames
  - Dashboard Nodes 页面显示只读 compatibility matrix，并提供安全测试按钮
  - Config/Dashboard diagnostics 可引用最近测试结果给出非阻断 warning，例如 configured but untested 或最近探测失败
  - Provider / Model Catalog 与 Video async preview 共享 `video_models` 和 async video endpoint 配置字段

### 多模态路由证据

- **状态**：✅ Prompt 52 feature branch 已完成
- **目标**：增强 Route Decision Trace，让多模态请求不只展示最终 node/model，还能解释 capability、endpoint、文件大小和价格来源如何影响候选模型
- **实现方案**：
  - Trace 增加 `modality_evidence`：`requested_modality`、`input_types`、`output_types`、`file_count`、`byte_size`、`required_capabilities`、`endpoint_strategy`
  - Candidate 增加 `capability_evidence`：supported modalities、matched/missing capabilities、endpoint status、max file size、pricing source、catalog source
  - image/audio/rerank/embedding 请求写入 evidence；video 字段按 preview/后续入口预留，不保存视频 bytes 或源文件内容
  - Dashboard Route Explanation 候选表展示 capability badges、endpoint status、pricing source、catalog source
  - 所有新增 Dashboard 文案同步 7 语言 localization
  - 不保存 prompt、response、文件内容、raw headers、provider keys

---

## v0.6 — Protocol + Explainability（生产协议补齐 + 可解释路由）

**v0.6.1 发布状态**：已完成并发布 Structured Output 完整透传与 schema-aware fallback、多模态 capability schema、Rerank、Images/Audio 最小可用入口、Realtime experimental preview、Route Decision Trace 与 Dashboard Route Explanation；v0.6.1 追加补齐 v0.2-v0.6 Dashboard 新增功能的 7 语言本地化体验。默认仍保持单机 memory/SQLite 可用；Redis/Postgres/Cloud 只作为可选能力。

### P0：协议生产能力

#### 1. 结构化输出完整透传、降级和验证体验

- **状态**：✅ v0.6.0 已发布
- **现状**：v0.3 已有 fallback policy 的基础 JSON/schema 校验，但结构化输出意图还没有成为正式 canonical 字段，跨协议映射和 Dashboard 可见性不足
- **目标**：完整保留并适配 OpenAI/Anthropic 的结构化输出请求意图
- **实现方案**：
  - Canonical Request 增加 `response_format` 与 `structured_output`
  - Chat Completions 支持 `response_format.type=json_object/json_schema`
  - Responses 支持 `text.format.type=json_object/json_schema`
  - Anthropic Messages 支持 `output_config.format` 原生透传；不能安全映射时记录 `downgraded` / unsupported
  - Provider 转发跨协议映射到目标协议的 native 字段，避免丢失结构化输出意图
  - 非 stream 响应可按 `routing.fallback_policy.structured_output` 在 parse/schema failure 后 fallback
  - stream 请求保持保守，SSE 已开始后不因内容校验改道
  - Dashboard Call Log、CSV/JSON export、外部 log sink、可选 telemetry 展示 structured-output intent、strategy、support、schema name
- **抽象到企业版**：控制面可聚合 structured-output 成功率、fallback 原因与模型兼容矩阵

#### 2. 统一多模态 Capability Schema

- **状态**：✅ v0.6.0 已发布
- **目标**：为 image/audio/rerank/realtime 统一 node/model 能力声明，不破坏旧配置
- **实现方案**：
  - 扩展 `modalities`、`endpoints`、`input_types`、`output_types`、`max_file_size`
  - 支持 `supports_streaming`、`supports_realtime`、`supports_rerank`、`pricing`
  - 保持 `nodes[].models`、`nodes[].embedding_models`、旧 `model_capabilities` 字段兼容
  - Config validation 校验 endpoint/pricing/capability 元数据
  - RoutingService 按请求 modality 过滤候选 node:model
  - Dashboard Nodes/Routing 只读展示能力摘要

#### 3. Rerank 入口

- **状态**：✅ v0.6.0 已发布
- **目标**：提供 OpenAI/common-compatible `POST /v1/rerank`，补齐检索增强、搜索排序、知识库重排场景
- **实现方案**：
  ```yaml
  nodes:
    - id: rerank-prod
      base_url: https://rerank-provider.example
      rerank_endpoint: /v1/rerank
      rerank_models: [rerank-english-v3]
  ```

  - Canonical rerank request/response 类型
  - `query`、`documents`、`top_n`、`return_documents` 归一化
  - 按 Gateway API key、namespace、健康状态、fallback 和成本选择 rerank node:model
  - usage/cost/call_log/telemetry 记录 `source_format=rerank`

#### 4. Image / Audio / Realtime 入口

- **状态**：✅ v0.6.0 已发布；Realtime 为 experimental preview，默认关闭
- **目标**：继续补齐 OpenAI/LiteLLM/New API 常见接口广度短板
- **实现方案**：
  - Image/audio 提供 `/v1/images/generations`、`/v1/images/edits`、`/v1/audio/transcriptions`、`/v1/audio/speech`
  - JSON 请求直接透传并重写选中上游模型
  - multipart 请求只做安全 pass-through：保留文件字节，重写/补充 `model` 字段，不做图像/音频解析、转码或编辑抽象
  - API Key、namespace、budget、rate limit、call_log、telemetry、fallback、健康状态继续复用现有 Data Plane 管线
  - Realtime 默认关闭，必须显式设置 `realtime.enabled=true`
  - WebSocket 入口 `/v1/realtime?model=...`，优先兼容 OpenAI Realtime 风格
  - 只做安全转发：Gateway API key 鉴权、API key/namespace 权限、连接数限制、idle/session timeout、关闭释放、脱敏错误摘要
  - 不解析、不转码、不检查、不保存音频帧；不破坏现有 HTTP/SSE streaming
  - `/health` 与 Dashboard Nodes API 展示 realtime capability、active connections、last closed/error 摘要

### P0：可解释路由

#### 5. 路由选择解释页

- **状态**：✅ v0.6.0 已发布
- **目标**：让用户看到 SiftGate 为什么选择某个 node/model，而不只是知道最终路由结果
- **实现方案**：
  - Pipeline/RoutingService 生成 privacy-safe trace
  - trace 包含 `request_id`、`source_format`、tier、score、domain hints、candidate targets、过滤原因、成本/延迟/context 分数、circuit 状态、fallback chain、最终选择
  - `route_decisions` 独立表存储 trace summary 与完整 JSON，兼容 SQLite/PostgreSQL
  - Dashboard API 提供 `GET /api/dashboard/route-decisions` 与 `GET /api/dashboard/route-decisions/:requestId`
  - Dashboard 新增只读 Route Explanation 页面，展示候选模型、过滤原因、成本/延迟/context 权衡、fallback reason 与最终选择
  - Logs 详情可深链跳转到对应 request 的 route decision
  - 不保存 prompt、response、raw headers、provider keys

---

## v0.2 — Resilience（生产环境可靠性 + 开发者体验）

**v0.2.0 发布状态**：已完成并发布配置校验 CLI、per-node 并发控制、配置热重载增强、主动健康检查、负载均衡 schema、OpenAPI/Swagger 文档。Playground 已进入 v1.1 Developer Experience 阶段；结构化输出已转入 v0.6 Protocol 阶段。

### P0：核心可靠性

#### 1. 配置热重载（Hot Reload）

- **状态**：✅ v0.2.0 已发布
- **现状**：已在 v0.2 实现 Dashboard API、`SIGHUP`、可选文件 watcher 的热重载
- **目标**：支持 `SIGHUP` 信号或 API 触发无中断重载
- **实现方案**：
  - 文件 watcher（默认关闭）+ debounce
  - ConfigService 重新解析 + 校验 → 原子替换内部引用
  - 失败时保留旧配置快照，并通过 Dashboard API 返回清晰错误
  - 事件主题：`config.reload.success` / `config.reload.failed`
  - 路由/节点/预算/capability/control-plane 模块读取或同步最新配置
  - Dashboard 提供 "Reload Config" 按钮
- **抽象到企业版**：云控制面下发 Policy Bundle 时自动应用

#### 2. 请求并发控制（Concurrency Limiter）

- **状态**：✅ v0.2.0 已发布
- **现状**：已在 v0.2 实现开源 Data Plane 单机 per-node 并发控制
- **目标**：每个 Node 可配置最大并发请求数
- **实现方案**：
  ```yaml
  nodes:
    - id: openai-prod
      max_concurrency: 50
      queue_timeout_ms: 10000
      queue_policy: wait # wait | fallback | reject
  ```

  - 超过并发上限 → 排队等待（带超时）、立即 fallback，或返回 429
  - 成功、失败、stream 完成/中断均释放槽位
  - `/health`、Dashboard Nodes API、OpenTelemetry gauges 展示实时并发数和排队深度
- **抽象到企业版**：Fleet 级别并发配额分配

#### 3. 主动健康检查（Active Health Probing）

- **状态**：✅ v0.2.0 已发布
- **现状**：已在 v0.2 实现可选 per-node 主动探测，默认关闭
- **目标**：定期主动探测 Node 可用性
- **实现方案**：
  ```yaml
  nodes:
    - id: openai-prod
      health_check:
        enabled: true
        interval_seconds: 30
        timeout_ms: 5000
        method: HEAD # HEAD / GET / POST
        path: /healthz
        lightweight_model: gpt-4o-mini # 可选，合成 1-token POST 探测
  ```

  - 后台探测不发送真实用户内容；POST 使用合成 `health check` 小请求
  - 健康检查失败或超时 → 立即打开对应 node:model circuit，路由绕开
  - 探测恢复 → Circuit Breaker 进入恢复路径并关闭 circuit
  - `/health` 与 Dashboard nodes 返回 `active_probe.status`、`last_checked_at`、`failure_reason`
- **抽象到企业版**：Fleet 健康总览 + 异常告警推送

#### 4. 负载均衡策略（Load Balancing）

- **状态**：✅ v0.2.0 已发布；本地单机可用，Cloud 仍仅作为可选控制面
- **现状**：兼容既有 primary + fallback 顺序，并新增统一 `targets + strategy` schema
- **目标**：支持多种负载分发策略
- **实现方案**：
  ```yaml
  routing:
    tiers:
      standard:
        strategy: weighted # weighted | round_robin | least_latency | random
        targets:
          - node: openai-prod
            model: gpt-4o
            weight: 70
          - node: anthropic-prod
            model: claude-sonnet
            weight: 30
  ```

  - `round_robin`：轮询
  - `weighted`：按权重分配（兼容现有 A/B split）
  - `least_latency`：基于滑动窗口平均延迟选择
  - `random`：随机
  - `primary/fallbacks`：保留为 legacy `primary_fallback` 策略
  - `split`：保留为实验模式，配置存在时优先于 `targets`
  - Dashboard Routing 页展示策略、目标、权重、样本延迟和最近选择结果
- **抽象到企业版**：基于 Fleet 聚合延迟数据的自适应权重

---

### P1：开发者体验

#### 5. 内置 Playground（交互式测试界面）

- **状态**：🚧 已迁移到 v1.1 Developer Experience 实现
- **现状**：v0.2 阶段仍主要依赖 curl 或外部工具；v1.1 将其升级为多协议 Dashboard Playground
- **目标**：Dashboard 内嵌安全的交互式测试页面，复用真实 routing、权限、预算、成本、telemetry 和 route decision 路径
- **实现方案**：
  - 新增 Dashboard 页面 `/playground`
  - 支持 chat、responses、messages、embeddings、rerank、images、audio、video 和 realtime probe
  - 支持选择 API key、namespace、model、endpoint、routing hint 和 stream
  - 展示 request preview、response summary、usage、cost、latency 和路由决策链接
  - 默认 tiny synthetic sample，不自动发送用户真实内容
  - 默认不保存 Playground prompt/response/media bytes；普通 call log 只保留元数据
- **抽象到企业版**：多团队共享 Prompt Template 与实验用例管理

#### 6. OpenAPI 文档自动生成

- **状态**：✅ v0.2.0 已发布
- **现状**：无正式 API 文档，用户需阅读源码
- **目标**：自动生成 Swagger/OpenAPI 规范
- **v0.2 状态**：已在开源 Data Plane 实现 `/docs` 与 `/openapi.json`，覆盖三类 AI 入口、`/v1/models`、`/health`、Dashboard API、API Key 管理和配置重载；DTO 示例会遮蔽 Provider API key 与 Dashboard secret。
- **实现方案**：
  - 集成 `@nestjs/swagger`
  - 所有 Controller 加 DTO 装饰器
  - `/docs` 路径提供 Swagger UI
  - 导出 `openapi.json` 供客户端生成
  - e2e 校验文档端点可访问且不会暴露真实 secret
- **抽象到企业版**：API 文档作为开发者门户的一部分

#### 7. 配置校验 CLI

- **状态**：✅ v0.2.0 已发布（`siftgate validate` / `npm run validate:config`）
- **现状**：配置可在启动前和 CI 中校验，errors 返回非零退出码
- **目标**：提供 `npx siftgate validate` 命令
- **实现方案**：
  - 独立 CLI 入口，加载 YAML → 校验 → 输出 grouped errors / warnings / info
  - 复用 ConfigService 的 node/model/routing/pricing 诊断逻辑
  - 支持 `--config` 和 `--json`，便于本地排障和 CI 机器读取
  - CI 可用（exit code 非零 = 配置有误）
  - 检查项：YAML 解析、必填字段、节点/模型命名冲突、routing/fallback/split/targets 引用完整性、split 权重、定价配置 warning、env 引用格式、control_plane 安全配置

#### 8. 结构化输出透传（Structured Output）

- **状态**：已转入 v0.6 并完成 canonical 透传、降级和验证体验
- **历史现状**：`response_format: { type: "json_schema" }` 在协议转换中可能丢失
- **目标**：完整保留并适配各 Provider 的结构化输出能力
- **实现方案**：
  - Canonical format 增加 `response_format` 字段
  - Normalizer/Denormalizer 适配 OpenAI / Anthropic 的结构化输出参数
  - 路由时考虑模型是否支持 JSON mode / structured output

---

### P2：安全加固

#### 9. Provider Key 加密存储

- **状态**：未纳入 v0.2.0，保留为后续安全加固项
- **现状**：API key 明文存储在 YAML 和环境变量中
- **目标**：支持加密存储 + Secrets Manager 集成
- **实现方案**：
  - 支持 `${env:OPENAI_KEY}` 引用环境变量（已有）
  - 新增 `${vault:secret/openai}` 格式支持 HashiCorp Vault
  - 新增 `${aws-sm:openai-key}` 格式支持 AWS Secrets Manager
  - 本地 fallback：AES-256 加密文件

#### 10. 请求/响应审计日志

- **状态**：未纳入 v0.2.0，保留为后续安全加固项
- **现状**：Call Log 用于分析，但不是正式审计
- **目标**：不可篡改的操作审计日志
- **实现方案**：
  - 配置变更、API Key 操作、预算修改等管理操作审计
  - 可选：请求级审计（谁在什么时候用什么 Key 访问了什么模型）
  - 日志格式兼容 SIEM 工具（JSON Lines）
  - 可配置保留策略
- **抽象到企业版**：审计日志上传到控制面，统一查询

---

## v0.3 — Intelligence（智能路由进化 + 可观测性增强）

**v0.3.0 发布状态**：已完成并发布成本/上下文窗口感知路由、fallback 策略增强、自适应路由推荐模式、Webhook 告警、外部日志 Sink、业务 Prometheus 指标。高级分析仪表盘继续保留在后续 roadmap 中。

### P0：路由智能化

#### 11. 基于成本的路由优化

- **状态**：✅ v0.3.0 已发布
- **现状**：已支持 `routing.optimization` 在同能力候选目标内按成本、延迟、均衡或质量选择
- **目标**：在同等能力下选择最低成本路由
- **实现方案**：
  ```yaml
  routing:
    optimization: cost # cost | latency | balanced | quality
  ```

  - `cost`：同 tier 内选最便宜的模型，使用 `model_capabilities.*.pricing` 或 `models_pricing`
  - `latency`：同 tier 内选本地滑动窗口延迟最低的目标，冷启动保持稳定 fallback
  - `balanced`：归一化成本 × 延迟加权
  - `quality`：优先选配置了更高 `quality_score` 的模型，否则保留现有 tier/strategy 顺序
  - direct model routing 和 Gateway API key 权限边界保持不变
- **抽象到企业版**：Fleet 级成本优化报告 + 路由建议推送

#### 12. 上下文窗口感知路由

- **状态**：✅ v0.3.0 已发布
- **现状**：已在自动路由前做本地 token 估算，并根据 `max_context_tokens` 过滤或降级目标
- **目标**：预估 Token 数，避免发送到窗口不够的模型
- **实现方案**：
  - 为 node 或每个模型配置 `max_context_tokens`
  - 快速 Token 预估（基于字符数、消息、工具 schema 和输出预算）
  - 超过 80% 窗口 → 路由到长上下文模型
  - 超过目标窗口 → 自动路由移除该目标；direct route 返回清晰 400，不静默改道
  - 配置模型能力矩阵：
    ```yaml
    nodes:
      - id: openai-prod
        max_context_tokens: 128000
        structured_output: true
        models: [gpt-4o, gpt-4o-mini]
        model_capabilities:
          gpt-4o:
            max_context_tokens: 128000
            structured_output: true
            quality_score: 0.9
          gpt-4o-mini:
            max_context_tokens: 128000
            structured_output: true
            pricing: { input: 0.15, output: 0.60 }
    ```

#### 13. 自适应路由（基于历史表现）

- **状态**：✅ v0.3.0 已发布推荐模式（不自动应用配置）
- **现状**：路由权重静态配置；Data Plane 可基于本地日志生成只读推荐
- **目标**：基于实际表现动态调整路由偏好，先从人工审核推荐开始
- **实现方案**：
  - ✅ 收集每个 node:model 的 P50/P95 延迟、成功率、成本、fallback 率
  - ✅ 本地滑动窗口（默认最近 24 小时 / 1000 请求）统计
  - ✅ 推荐结果包含原因、置信度、潜在节省、风险说明
  - ✅ Dashboard 展示只读推荐视图，不自动修改 `routing` 配置
  - 后续：可配置激进程度（conservative / moderate / aggressive）
  - 后续：推荐历史、人工采纳记录、策略 diff 预览
- **抽象到企业版**：Fleet 聚合数据驱动的路由推荐引擎

#### 14. Fallback 触发策略增强

- **状态**：✅ v0.3.0 已发布
- **现状**：已支持本地 `routing.fallback_policy`，不会依赖 Cloud 控制面
- **目标**：支持更多 fallback 触发条件
- **实现方案**：
  - 超时 fallback：可配置 `threshold_ms`，默认顺序 abort-and-fallback；`race_fallback` 必须显式开启并声明阈值
  - 内容 fallback：OpenAI `response_format` / Responses `text.format` 结构化输出 JSON parse 或 schema 校验失败时切换 fallback
  - 成本 fallback：基于本地 token 粗估与 `models_pricing`，超过 `max_estimated_cost_usd` 时降级到更便宜 fallback
  - 限流 fallback：收到 429 可配置立即切换，不等待同节点 retry
  - Stream 请求保持保守：只在连接阶段 fallback，SSE 已开始后不因内容校验改道
  - `call_logs`、Dashboard、OpenTelemetry 与可选控制面 telemetry 记录 `fallback_reason`

---

### P1：可观测性增强

#### 15. 外部日志 Sink 支持

- **状态**：✅ v0.3.0 已发布
- **现状**：开源 Data Plane 已保留本地 SQLite/Postgres `call_logs`，并可选异步导出脱敏元数据
- **目标**：支持多种日志输出目标
- **实现方案**：
  ```yaml
  logging:
    enabled: true
    sinks:
      - type: webhook
        url: https://your-endpoint.com/logs
        batch_size: 100
      - type: file
        path: /var/log/siftgate/calls.jsonl
        max_queue: 10000
        overflow: drop_oldest
      - type: elasticsearch # minimal _bulk exporter
        url: http://elastic:9200
        index: siftgate-logs
      - type: s3 # interface placeholder
        enabled: false
        bucket: ai-gateway-logs
        region: us-east-1
  ```

  - 批量异步写入，不阻塞请求流；失败按 sink 独立重试
  - 每个 sink 支持 `batch_size`、`flush_interval_ms`、`max_queue`、`overflow`
  - 支持字段 allow-list / deny-list，默认排除 prompt、response、provider key、raw auth headers
  - 不影响现有 SQLite/Postgres `call_log`
  - 单测覆盖文件写入、webhook、失败重试、脱敏和队列溢出

#### 16. Webhook 告警系统

- **状态**：✅ v0.3.0 已发布
- **现状**：开源 Data Plane 已支持本地 webhook 告警，不依赖 Cloud 控制面
- **目标**：支持外部通知渠道
- **实现方案**：
  ```yaml
  alerts:
    enabled: true
    channels:
      - type: webhook
        name: ops
        url: https://hooks.slack.com/xxx
        events:
          [
            budget_threshold,
            budget_exceeded,
            node_down,
            node_recovered,
            circuit_open,
            circuit_close,
            error_spike,
            latency_spike,
          ]
        debounce_seconds: 300
        retry:
          attempts: 3
          backoff_ms: 1000
          timeout_ms: 5000
    error_spike:
      window_seconds: 300
      min_requests: 20
      error_rate: 0.1
    latency_spike:
      window_seconds: 300
      min_requests: 20
      p95_ms: 10000
  ```

  - 事件类型：budget_threshold, budget_exceeded, node_down, node_recovered, circuit_open, circuit_close, error_spike, latency_spike
  - 防抖（同一事件 N 分钟内不重复发送）
  - Webhook 发送异步执行并带重试，不阻塞主请求路径
  - 默认只发送脱敏元数据，不包含 prompt、response、provider key 或 raw headers
  - Dashboard 展示最近告警状态、发送结果和失败原因
- **抽象到企业版**：统一告警管理 + 告警路由

#### 17. 高级分析仪表盘

- **状态**：未纳入 v0.3.0，保留为后续开发项
- **现状**：Dashboard 有基础分析
- **目标**：更深度的分析视图
- **新增视图**：
  - Token 用量趋势（按 model/node/key 拆分，日/周/月）
  - 成本预测（基于历史趋势预测月底成本）
  - 路由决策分布（每个 tier 的命中分布）
  - 错误分析（按错误类型、Provider、时间分布）
  - 模型对比（同一请求发到不同模型的延迟/成本对比）
  - 缓存效率（命中率趋势 + 节省的 Token/成本）

#### 18. 自定义 Prometheus Metrics

- **状态**：✅ v0.3.0 已发布
- **现状**：已基于现有 OpenTelemetry/Prometheus exporter 补齐业务指标
- **目标**：暴露更丰富的 Prometheus-scrapeable 指标，同时控制 label cardinality
- **实现方案**：
  - 通过 `telemetry.enabled` 启动现有 Prometheus exporter，默认 `:9464/metrics`
  - 指标列表：
    - `siftgate_requests_total{tier, node, model, status}`
    - `siftgate_request_duration_seconds{tier, node, model, status}`
    - `siftgate_tokens_total{node, model, direction}`
    - `siftgate_cost_total{node, model}`
    - `siftgate_circuit_breaker_state{node, model}`
    - `siftgate_cache_hits_total` / `siftgate_cache_misses_total`
    - `siftgate_fallback_total{tier, node, model}`
    - `siftgate_budget_usage_ratio{scope, budget_type}`
    - `siftgate_concurrent_requests{node}`
  - 不使用 API key 明文、prompt、response、provider key、raw headers 作为指标 label

---

## v0.4 — Ecosystem（插件生态 + 多端点 + 集成）

**v0.4.0 发布状态**：已完成并发布 OpenAI-compatible Embeddings 端点、插件包管理器、首批官方运行时插件、LiteLLM 配置迁移 CLI、TypeScript SDK scaffold 与 Python SDK 设计文档。Image Generation、Completions Legacy、插件 Hook 扩展与 MCP 支持继续保留在后续 roadmap 中。

### P0：API 扩展

#### 19. Embeddings 端点

- **状态**：✅ v0.4.0 已发布
- **现状**：开源 Data Plane 已支持 OpenAI-compatible `POST /v1/embeddings`
- **目标**：支持 `/v1/embeddings`
- **实现方案**：
  - 新 Controller：`POST /v1/embeddings`
  - Canonical embeddings request/response 类型与 OpenAI-compatible normalizer
  - Node 配置增加 `embedding_models` 与可选 `embeddings_endpoint`
  - 支持批量 embedding 请求和 `dimensions` 参数
  - 路由：按 API key 权限、circuit 状态、维度兼容和价格选择 embedding 模型
  - 记录 usage/cost/call_log/telemetry，并复用并发控制、fallback、预算和外部日志路径

#### 20. Image Generation 端点

- **现状**：不支持图片生成
- **目标**：支持 `/v1/images/generations`
- **实现方案**：
  - 新 Controller：`POST /v1/images/generations`
  - Node 增加 `image_models` 配置
  - 路由：按风格/质量/价格选择
  - 支持 DALL-E / Stable Diffusion / Midjourney API 格式

#### 21. Completions Legacy 端点

- **现状**：不支持旧版 completions
- **目标**：支持 `/v1/completions`（为兼容旧系统）
- **实现方案**：
  - 新 Controller + Normalizer
  - 转为 canonical 格式走统一 pipeline
  - 标记为 deprecated，文档引导迁移到 chat/completions

---

### P1：插件生态

#### 22. 插件包管理器

- **状态**：✅ v0.4.0 已发布
- **现状**：支持本地路径与 `@siftgate/plugin-*` npm package 的声明式安装
- **目标**：支持 npm-like 插件安装
- **实现方案**：
  ```bash
  npx siftgate plugin install @siftgate/plugin-redis-cache
  npx siftgate plugin install @siftgate/plugin-guardrails
  npx siftgate plugin list
  npx siftgate plugin remove <name>
  ```

  - 插件 registry（初期用 npm scope `@siftgate/plugin-*`）
  - 插件版本管理 + 兼容性检查
  - `plugins.config.yaml` 声明式管理，不自动覆盖 `gateway.config.yaml`
  - Runtime loader 合并读取 `gateway.config.yaml` 与 `plugins.config.yaml`

#### 23. 官方插件集

- **状态**：✅ v0.4.0 已发布第一批
- **现状**：已交付首批官方插件：`redis-cache`、`analytics-sink`、`request-transform`、`guardrails` skeleton；每个插件包含 README、示例配置、测试和安全说明
- **目标**：继续扩展到 5-8 个高质量官方插件
- **插件列表**：

| 插件名                                 | 功能                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `plugins/redis-cache`                  | ✅ Redis 分布式缓存替代内存 LRU；默认不写响应，需显式 `store_responses: true` |
| `plugins/guardrails`                   | ✅ 输入/输出内容安全检查 skeleton；默认本地 audit/no-op                       |
| `plugins/request-transform`            | ✅ 请求自定义变换；仅本地改写                                                 |
| `plugins/analytics-sink`               | ✅ 安全 call-log 元数据推送到 webhook；默认不发送 prompt/response             |
| `@siftgate/plugin-prompt-template`     | 系统 prompt 注入 / 模板管理                                                   |
| `@siftgate/plugin-cost-alerting`       | 实时成本 webhook 通知                                                         |
| `@siftgate/plugin-model-router`        | 自定义路由逻辑覆盖                                                            |
| `@siftgate/plugin-rate-limit-advanced` | 滑动窗口 + Token-based 限流                                                   |

#### 24. 插件 Hook 扩展

- **现状**：7 个 pipeline hooks
- **新增 Hooks**：
  - `onConfigReload` — 配置热重载时触发
  - `onNodeHealthChange` — 节点健康状态变化
  - `onBudgetAlert` — 预算告警时触发
  - `onCacheHit` — 缓存命中时可修改响应
  - `onMetrics` — 自定义指标收集点

---

### P2：集成 & 兼容性

#### 25. LiteLLM 配置兼容

- **状态**：✅ v0.4.0 已发布
- **现状**：已提供 `siftgate migrate --from litellm`，可从 LiteLLM YAML 生成 SiftGate `gateway.config.yaml` 草案和迁移报告
- **目标**：降低从 LiteLLM 迁移到开源 Data Plane 的配置成本
- **实现方案**：
  ```bash
  npx siftgate migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
  ```

  - 解析 LiteLLM YAML → 生成 SiftGate `gateway.config.yaml`
  - 映射 model names、provider、API key env 引用、fallback rules、router retry/settings 和可识别 pricing
  - 输出迁移报告（兼容/不兼容/需人工处理）
  - 默认不覆盖已有 `gateway.config.yaml`

#### 26. SDK / 客户端库

- **状态**：✅ v0.4.0 TypeScript SDK scaffold 已发布；✅ v1.1.0 Python SDK scaffold 已发布
- **现状**：用户可继续用原生 HTTP 或 OpenAI SDK（指向 gateway），也可试用 `packages/client` TypeScript SDK 与 `packages/python` Python SDK scaffold
- **目标**：提供轻量 SDK 增强体验
- **实现方案**：
  - ✅ TypeScript SDK（`@siftgate/client`）：支持 `baseUrl`、Gateway API key、模型发现、Chat Completions、Responses、Messages、Embeddings helper、routing hint header、raw response access
  - ✅ Python SDK（`siftgate`）：支持 `base_url`、Gateway API key、模型发现、Chat Completions、Responses、Messages、Embeddings、Rerank、Images、Audio、Video Jobs helper、routing hint header、raw response access
  - 功能：自动 Gateway Key 认证、模型发现、路由 hint 注入、结构化错误、轻量本地安装
  - 与 OpenAI SDK 兼容（drop-in `base_url` 替换）

#### 27. MCP (Model Context Protocol) 支持

- **现状**：不支持 MCP
- **目标**：作为 MCP Server 端点，代理 AI tool use
- **实现方案**：
  - 实现 MCP Server transport
  - 将 MCP 请求映射到 canonical format
  - 支持 MCP 的 resource/tool/prompt primitives
  - 路由到后端 LLM 处理 tool_use

---

## v0.5 — Scale（高可用 + 高性能 + 企业就绪）

**v0.5.0 发布状态**：已完成并发布 Redis 共享状态、PostgreSQL 迁移 CLI、上游连接池、流式缓存、Embedding batching、Redis-backed cluster mode、本地 namespace 与 shadow traffic。开源版继续保持单机 memory/SQLite 默认可用，Redis/PostgreSQL/cluster/shadow 均为可选能力。

### P0：高可用

#### 28. Redis 共享状态

- **状态**：✅ v0.5.0 已发布；memory 仍为默认，Redis 为可选 backend
- **现状**：单机默认使用 in-memory；Redis 可选用于多实例共享运行时状态
- **目标**：支持 Redis 作为共享状态后端
- **实现方案**：
  ```yaml
  state:
    backend: redis  # memory | redis
    unavailable_policy: fail_open # fail_open | fail_closed
    redis:
      url: redis://localhost:6379
      prefix: siftgate:
      timeout_ms: 500
      sync_interval_ms: 2000
  ```

  - ✅ Circuit Breaker 状态 → Redis Hash + 本地 mirror 周期同步
  - ✅ Rate Limiter 计数 → Redis INCR + EXPIRE，支持 fail-open/fail-closed
  - ✅ Prompt Cache → Redis String + TTL
  - ✅ Momentum 窗口 → Redis Sorted Set + 本地 mirror
  - ✅ Docker Compose 提供可选 Redis profile
  - 所有实例共享状态 → 支持水平扩展

#### 29. 多实例集群模式

- **状态**：✅ v0.5 已实现开源 Data Plane 多实例集群模式；默认单实例行为不变
- **现状**：默认仍为单实例 memory 模式；启用 `state.backend=redis` 或 `cluster.enabled=true` 后进入 Redis-backed cluster mode
- **目标**：支持多实例部署 + 自动发现
- **实现方案**：
  - ✅ 基于 Redis Pub/Sub 的实例注册、生命周期事件和心跳广播
  - ✅ 配置变更广播（一个实例 reload → 通知所有实例本地校验并 reload；失败保留旧快照）
  - ✅ 集群健康端点：`GET /cluster/status`，仅在 `state.backend=redis` 或 `cluster.enabled=true` 时启用
  - ✅ 无 Leader Election 需求（每个实例独立处理请求）
  - 推荐部署：N 个无状态 Gateway + 共享 Redis + 负载均衡器

#### 30. PostgreSQL 推荐 + 数据迁移

- **现状**：SQLite 为默认，PostgreSQL 已支持但非推荐
- **状态**：✅ v0.5 已实现（`siftgate migrate-db --from sqlite --to postgres`）
- **目标**：生产部署推荐 PostgreSQL，提供迁移工具
- **实现方案**：
  - `npx siftgate migrate-db --from sqlite --to postgres`
  - 自动导出 SQLite 数据 → 导入 PostgreSQL
  - 支持 dry-run、SQLite 备份、非空目标保护、导入行数校验
  - 文档：生产部署最佳实践与 TypeORM schema/migration 策略

---

### P1：高性能

#### 31. HTTP/2 + 连接池

- **现状**：使用 Node.js 原生 fetch，无连接复用
- **状态**：✅ v0.5 已实现 per-node undici pool；HTTP/2 为 experimental opt-in
- **目标**：高吞吐场景下减少连接开销
- **实现方案**：
  - 引入 `undici` 连接池（per node）
  - 支持 stream / non-stream / embeddings 共享 per-node dispatcher
  - 支持 keep_alive、pool_size、headers timeout、body timeout
  - HTTP/2 multiplexing 先以 `connection.http2: true` 实验性启用
  - 配置：
    ```yaml
    nodes:
      - id: openai-prod
        connection:
          enabled: true
          pool_size: 10
          keep_alive: true
          keep_alive_ms: 60000
          headers_timeout_ms: 30000
          body_timeout_ms: 300000
          http2: true
    ```

#### 32. 流式缓存

- **状态**：✅ v0.5 已实现，默认关闭
- **目标**：支持流式请求的缓存
- **实现方案**：
  - 首次流式请求：正常流式返回 + 缓冲完整响应
  - 后续命中：从缓存重放为 SSE 流式事件
  - 取消、超时、中断或部分响应不写入缓存
  - Cache key 纳入协议、路由相关 headers、Gateway API key id/name、session，避免跨租户复用
  - 配置项：`cache.stream_cache.enabled: true`

#### 33. 请求批处理（Batching）

- **状态**：✅ v0.5 已实现 Embedding batching，默认关闭
- **目标**：将短时间内的小请求合并为 batch
- **实现方案**：
  - 适用于 embedding 等支持批量的端点
  - 收集 N ms 窗口内的请求 → 合并为一个 batch → 拆分响应分发
  - 按 node/model/dimensions/encoding_format/user/input kind/tenant 隔离 batch
  - 支持取消、超时、部分失败、队列上限和大请求旁路
  - 配置：
    ```yaml
    embedding_batching:
      enabled: true
      window_ms: 10
      max_batch_size: 64
      max_input_items: 8
      max_queue: 1000
      timeout_ms: 10000
    ```

---

### P2：企业就绪

#### 34. 数据面 RBAC

- **现状**：Dashboard 单密码，无角色区分
- **目标**：数据面本地用户 + 角色
- **实现方案**：
  - 角色：admin（全权限）、operator（查看+配置）、viewer（只读）
  - 本地用户管理或 JWT 验证
  - API 路径级权限控制
  - Gateway API Key 归属到 operator

#### 35. 多租户隔离

- **状态**：✅ v0.5 OSS 本地 namespace 已实现；企业 workspace/SSO/SCIM/组织计费不在开源数据面内
- **现状**：API Key 可绑定本地 namespace，并按 namespace 过滤 Dashboard 视图
- **目标**：支持本地 Namespace/Team 级别隔离
- **实现方案**：
  ```yaml
  namespaces:
    - id: team-a
      name: "Team A"
      allowed_nodes: [openai-prod, anthropic-prod]
      allowed_models: [gpt-4o, claude-sonnet]
      budget:
        daily_cost_limit: 100
      rate_limit:
        requests_per_minute: 120
    - id: team-b
      allowed_nodes: [openai-prod]
      budget:
        daily_cost_limit: 50
  ```

  - 每个 namespace 有独立的节点/模型权限、预算、限流
  - API Key 绑定到 namespace，权限与 key 自身限制取交集
  - Budget、call_log、Dashboard stats/logs/cost/budget 支持 namespace 维度
  - Dashboard 支持 namespace 过滤视图，并明确 OSS 版不包含 workspace/SSO/SCIM/org billing

#### 36. 请求重放 / 影子流量

- **状态**：✅ v0.5 OSS shadow traffic 已实现，默认关闭，只读观测
- **现状**：可按采样率将成功请求异步复制到测试 Node，不影响主路径
- **目标**：将生产流量副本安全发送到测试 Node
- **实现方案**：
  ```yaml
  shadow:
    enabled: true
    sample_rate: 0.1 # 10% 流量
    target_node: new-provider-test
    target_model: new-model-v1
    compare:
      store_prompts: false
      store_responses: false
  ```

  - 异步发送，不影响主路径延迟
  - 默认不保存 prompt/response，启用本地对比样本时配置校验给出隐私警告
  - Shadow 结果不写入主 call_log，不参与预算扣减
  - Dashboard 提供只读对比视图：主路径 vs 影子路径的状态、延迟、token、错误原因

---

---

## 功能优先级矩阵

### 按用户价值 × 实现难度排序

| #   | 功能               |  用户价值  | 实现难度 | 推荐优先级 |
| --- | ------------------ | :--------: | :------: | :--------: |
| 1   | 配置热重载         | ⭐⭐⭐⭐⭐ |    中    | ✅ v0.2.0  |
| 5   | Playground         | ⭐⭐⭐⭐⭐ |    中    |  🔴 立即   |
| 8   | 结构化输出透传     |  ⭐⭐⭐⭐  |    小    |  🔴 立即   |
| 4   | 负载均衡           | ⭐⭐⭐⭐⭐ |    中    | ✅ v0.2.0  |
| 2   | 并发控制           |  ⭐⭐⭐⭐  |    中    | ✅ v0.2.0  |
| 3   | 主动健康检查       |  ⭐⭐⭐⭐  |    中    | ✅ v0.2.0  |
| 6   | OpenAPI 文档       |  ⭐⭐⭐⭐  |    小    | ✅ v0.2.0  |
| 7   | 配置校验 CLI       |  ⭐⭐⭐⭐  |    小    | ✅ v0.2.0  |
| 11  | 成本路由优化       | ⭐⭐⭐⭐⭐ |    中    | ✅ v0.3.0  |
| 12  | 上下文窗口感知     |  ⭐⭐⭐⭐  |    小    | ✅ v0.3.0  |
| 16  | Webhook 告警       |  ⭐⭐⭐⭐  |    中    | ✅ v0.3.0  |
| 18  | Prometheus Metrics |  ⭐⭐⭐⭐  |    小    | ✅ v0.3.0  |
| 13  | 自适应路由         | ⭐⭐⭐⭐⭐ |    大    | ✅ v0.3.0  |
| 15  | 外部日志 Sink      |   ⭐⭐⭐   |    中    | ✅ v0.3.0  |
| 19  | Embeddings 端点    |   ⭐⭐⭐   |    中    |  ✅ v0.4   |
| 22  | 插件包管理器       |  ⭐⭐⭐⭐  |    中    |  ✅ v0.4   |
| 23  | 官方插件集         |  ⭐⭐⭐⭐  |    大    |  ✅ v0.4   |
| 25  | LiteLLM 配置兼容   |   ⭐⭐⭐   |    小    |  ✅ v0.4   |
| 26  | SDK / 客户端库     |   ⭐⭐⭐   |    小    |  ✅ v1.1.0 Python scaffold |
| 28  | Redis 共享状态     | ⭐⭐⭐⭐⭐ |    大    |  ✅ v0.5   |
| 29  | 多实例集群模式     | ⭐⭐⭐⭐⭐ |    中    |  ✅ v0.5   |
| 31  | HTTP/2 连接池      |   ⭐⭐⭐   |    中    |  ✅ v0.5 experimental |
| 32  | 流式缓存           |   ⭐⭐⭐   |    中    |  ✅ v0.5   |
| 33  | Embedding Batching |   ⭐⭐⭐   |    中    |  ✅ v0.5   |
| 35  | 多租户隔离         |  ⭐⭐⭐⭐  |    大    | ✅ v0.5 OSS |
| 36  | 影子流量           |  ⭐⭐⭐⭐  |    中    | ✅ v0.5 OSS |
| 37  | 多模态能力 Schema  | ⭐⭐⭐⭐⭐ |    中    | 🚧 v0.6 P0 |
| 38  | 结构化输出完整透传 | ⭐⭐⭐⭐⭐ |    中    | 🔴 v0.6 P0 |
| 39  | Image/Audio/Rerank/Realtime | ⭐⭐⭐⭐⭐ |    大    | 🔴 v0.6 P0 |
| 40  | 可解释路由 Trace + Dashboard | ⭐⭐⭐⭐⭐ |    中    | 🚧 v0.6 P0 |

---

## 开源 → 企业版功能流转规则

```
┌─────────────────┐     验证成功      ┌──────────────────┐
│  开源 Gateway    │  ──────────────→  │  企业版控制面     │
│  (单机功能)      │                   │  (Fleet 管理)     │
└─────────────────┘                   └──────────────────┘

规则：
1. 功能先在开源版实现 & 验证
2. 证明价值后，抽象出 "Fleet 管理层" 到企业版
3. 开源版保留完整的单机功能
4. 企业版提供多网关统一管理 + 高级策略
```

| 开源版功能   | 企业版抽象             |
| ------------ | ---------------------- |
| 配置热重载   | Policy Bundle 远程下发 |
| 健康检查     | Fleet 健康总览 + 告警  |
| 负载均衡     | Fleet 级跨地域负载分配 |
| 自适应路由   | Fleet 聚合数据路由推荐 |
| Webhook 告警 | 统一告警管理 + 路由    |
| 审计日志     | 合规审计 + SIEM 导出   |
| 预算管理     | 组织级成本管理 + 报表  |
| 多租户       | 工作区 + RBAC + SCIM   |

---

## 非功能性改进（持续进行）

| 项目            | 目标                                       |
| --------------- | ------------------------------------------ |
| **测试覆盖率**  | 保持 >90% 覆盖率，新功能必须带测试         |
| **文档**        | 每个新功能配套用户文档 + 配置示例          |
| **性能基准**    | 建立 benchmark suite，CI 中防止性能退化    |
| **安全审计**    | 每个版本前进行安全审查                     |
| **依赖更新**    | 月度依赖更新，及时修复安全漏洞             |
| **国际化**      | Dashboard 持续保持 7 语言同步              |
| **Docker 镜像** | 每个 release 发布 multi-arch 镜像          |
| **社区**        | Issue 模板、Discussion、Contributing Guide |

---

## 建议下一批启动项

基于**用户价值最大 + 为后续功能奠基**的原则，v0.6 阶段建议优先完成：

1. **Route Decision Trace + Dashboard 路线解释页**（把 explainable routing 做成核心差异）
2. **结构化输出透传**（提升 OpenAI/Claude 生产应用兼容性）
3. **Rerank / Image / Audio / Realtime 最小可用入口**（继续扩展开源网关的 API 覆盖面）

这些能力都必须继续保持单机 OSS Data Plane 可用，Cloud 只作为可选控制面。
