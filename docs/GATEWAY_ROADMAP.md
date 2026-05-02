# SiftGate 开源 Gateway Roadmap

> 本文档定义开源数据面（Data Plane）的功能迭代计划。
> 经过验证的功能将在后续抽象到企业版云控制面。
> 最后更新：2026-05-02

---

## 版本策略

| 版本 | 代号 | 目标 | 时间线 |
|------|------|------|--------|
| v0.1 | Foundation | 已完成 — 发布开源 | ✅ Done |
| v0.2 | Resilience | 已发布 — v0.2.0 可靠性 + 开发者体验 | ✅ Released |
| v0.3 | Intelligence | 已发布 — v0.3.0 智能路由 + 可观测性 | ✅ Released |
| v0.4 | Ecosystem | 插件生态 + 多端点 + 集成 | 4 周 |
| v0.5 | Scale | 高可用 + 高性能 + 企业就绪 | 6 周 |

---

## v0.2 — Resilience（生产环境可靠性 + 开发者体验）

**v0.2.0 发布状态**：已完成并发布配置校验 CLI、per-node 并发控制、配置热重载增强、主动健康检查、负载均衡 schema、OpenAPI/Swagger 文档。Playground、结构化输出透传与 P2 安全加固继续保留在后续 roadmap 中。

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
      queue_policy: wait  # wait | fallback | reject
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
        method: HEAD  # HEAD / GET / POST
        path: /healthz
        lightweight_model: gpt-4o-mini  # 可选，合成 1-token POST 探测
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
        strategy: weighted  # weighted | round_robin | least_latency | random
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

#### 5. 内置 Playground（Chat 测试界面）
- **状态**：未纳入 v0.2.0，保留为后续开发项
- **现状**：测试需要 curl 或外部工具
- **目标**：Dashboard 内嵌一个 Chat Playground
- **实现方案**：
  - 新增 Dashboard 页面 `/playground`
  - 支持选择模型（auto / 指定 node:model）
  - 流式输出展示
  - System prompt 编辑
  - 请求/响应对比视图（展示路由决策）
  - 延迟、Token、成本实时展示
- **抽象到企业版**：多团队共享 Prompt Template

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
- **状态**：未纳入 v0.2.0，保留为后续开发项
- **现状**：`response_format: { type: "json_schema" }` 在协议转换中可能丢失
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
    optimization: cost  # cost | latency | balanced | quality
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
        events: [budget_threshold, budget_exceeded, node_down, node_recovered, circuit_open, circuit_close, error_spike, latency_spike]
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

### P0：API 扩展

#### 19. Embeddings 端点
- **状态**：✅ v0.4 已实现（功能分支 `codex/v0.4-embeddings-endpoint`）
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
- **状态**：✅ v0.4 已实现（功能分支 `codex/v0.4-plugin-manager`）
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
- **现状**：仅 1 个示例插件（pii-filter）
- **目标**：提供 5-8 个高质量官方插件
- **计划插件列表**：

| 插件名 | 功能 |
|--------|------|
| `@siftgate/plugin-redis-cache` | Redis 分布式缓存替代内存 LRU |
| `@siftgate/plugin-guardrails` | 输入/输出内容安全检查 |
| `@siftgate/plugin-prompt-template` | 系统 prompt 注入 / 模板管理 |
| `@siftgate/plugin-cost-alerting` | 实时成本 webhook 通知 |
| `@siftgate/plugin-request-transform` | 请求/响应自定义变换 |
| `@siftgate/plugin-analytics-sink` | 日志推送到 ES/S3/Webhook |
| `@siftgate/plugin-model-router` | 自定义路由逻辑覆盖 |
| `@siftgate/plugin-rate-limit-advanced` | 滑动窗口 + Token-based 限流 |

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
- **现状**：从 LiteLLM 迁移需手动重写配置
- **目标**：提供迁移工具
- **实现方案**：
  ```bash
  npx siftgate migrate --from litellm --config ./litellm_config.yaml
  ```
  - 解析 LiteLLM YAML → 生成 SiftGate `gateway.config.yaml`
  - 映射 model names, API keys, fallback rules
  - 输出迁移报告（兼容/不兼容功能列表）

#### 26. SDK / 客户端库
- **现状**：用户用原生 HTTP 或 OpenAI SDK（指向 gateway）
- **目标**：提供轻量 SDK 增强体验
- **实现方案**：
  - TypeScript SDK（`@siftgate/client`）
  - Python SDK（`siftgate-python`）
  - 功能：自动 Gateway Key 认证、模型发现、路由 hint 注入、错误重试
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

### P0：高可用

#### 28. Redis 共享状态
- **现状**：Circuit Breaker、Rate Limiter、Cache、Momentum 全部 in-memory
- **目标**：支持 Redis 作为共享状态后端
- **实现方案**：
  ```yaml
  state:
    backend: redis  # memory | redis
    redis:
      url: redis://localhost:6379
      prefix: siftgate:
  ```
  - Circuit Breaker 状态 → Redis Hash
  - Rate Limiter 计数 → Redis INCR + EXPIRE
  - Prompt Cache → Redis String + TTL
  - Momentum 窗口 → Redis Sorted Set
  - 所有实例共享状态 → 支持水平扩展

#### 29. 多实例集群模式
- **现状**：单实例运行
- **目标**：支持多实例部署 + 自动发现
- **实现方案**：
  - 基于 Redis Pub/Sub 的实例注册
  - 配置变更广播（一个实例 reload → 通知所有实例）
  - 集群健康端点：`GET /cluster/status`
  - 无 Leader Election 需求（每个实例独立处理请求）
  - 推荐部署：N 个无状态 Gateway + 共享 Redis + 负载均衡器

#### 30. PostgreSQL 推荐 + 数据迁移
- **现状**：SQLite 为默认，PostgreSQL 已支持但非推荐
- **目标**：生产部署推荐 PostgreSQL，提供迁移工具
- **实现方案**：
  - `npx siftgate migrate-db --from sqlite --to postgres`
  - 自动导出 SQLite 数据 → 导入 PostgreSQL
  - 文档：生产部署最佳实践

---

### P1：高性能

#### 31. HTTP/2 + 连接池
- **现状**：使用 Node.js 原生 fetch，无连接复用
- **目标**：高吞吐场景下减少连接开销
- **实现方案**：
  - 引入 `undici` 连接池（per node）
  - 支持 HTTP/2 multiplexing 到支持的 Provider
  - 配置：
    ```yaml
    nodes:
      - id: openai-prod
        connection:
          pool_size: 10
          keep_alive_ms: 60000
          http2: true
    ```

#### 32. 流式缓存
- **现状**：Cache 只对非流式 temperature=0 请求生效
- **目标**：支持流式请求的缓存
- **实现方案**：
  - 首次流式请求：正常流式返回 + 后台缓冲完整响应
  - 后续命中：从缓存重放为流式事件（模拟延迟或即时发送）
  - 配置项：`cache.streaming: true`

#### 33. 请求批处理（Batching）
- **现状**：每个请求独立转发
- **目标**：将短时间内的小请求合并为 batch
- **实现方案**：
  - 适用于 embedding 等支持批量的端点
  - 收集 N ms 窗口内的请求 → 合并为一个 batch → 拆分响应分发
  - 配置：
    ```yaml
    batching:
      enabled: true
      window_ms: 50
      max_batch_size: 20
      endpoints: [embeddings]
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
- **现状**：所有 API Key 共享同一套节点和路由
- **目标**：支持 Namespace/Team 级别隔离
- **实现方案**：
  ```yaml
  namespaces:
    - name: team-a
      allowed_nodes: [openai-prod, anthropic-prod]
      budget:
        daily_cost_limit: 100
      rate_limit:
        requests_per_minute: 120
    - name: team-b
      allowed_nodes: [openai-prod]
      budget:
        daily_cost_limit: 50
  ```
  - 每个 namespace 有独立的节点权限、预算、限流
  - API Key 绑定到 namespace
  - Dashboard 支持 namespace 切换视图

#### 36. 请求重放 / 影子流量
- **现状**：无法安全测试新模型/新 Provider
- **目标**：将生产流量副本发送到测试 Node
- **实现方案**：
  ```yaml
  shadow:
    enabled: true
    targets:
      - node: new-provider-test
        model: new-model-v1
        sample_rate: 0.1  # 10% 流量
    compare: true  # 是否记录对比结果
  ```
  - 异步发送，不影响主路径延迟
  - 对比视图：主路径 vs 影子路径的延迟/成本/质量

---

## 功能优先级矩阵

### 按用户价值 × 实现难度排序

| # | 功能 | 用户价值 | 实现难度 | 推荐优先级 |
|---|------|:--------:|:--------:|:----------:|
| 1 | 配置热重载 | ⭐⭐⭐⭐⭐ | 中 | ✅ v0.2.0 |
| 5 | Playground | ⭐⭐⭐⭐⭐ | 中 | 🔴 立即 |
| 8 | 结构化输出透传 | ⭐⭐⭐⭐ | 小 | 🔴 立即 |
| 4 | 负载均衡 | ⭐⭐⭐⭐⭐ | 中 | ✅ v0.2.0 |
| 2 | 并发控制 | ⭐⭐⭐⭐ | 中 | ✅ v0.2.0 |
| 3 | 主动健康检查 | ⭐⭐⭐⭐ | 中 | ✅ v0.2.0 |
| 6 | OpenAPI 文档 | ⭐⭐⭐⭐ | 小 | ✅ v0.2.0 |
| 7 | 配置校验 CLI | ⭐⭐⭐⭐ | 小 | ✅ v0.2.0 |
| 11 | 成本路由优化 | ⭐⭐⭐⭐⭐ | 中 | ✅ v0.3.0 |
| 12 | 上下文窗口感知 | ⭐⭐⭐⭐ | 小 | ✅ v0.3.0 |
| 16 | Webhook 告警 | ⭐⭐⭐⭐ | 中 | ✅ v0.3.0 |
| 18 | Prometheus Metrics | ⭐⭐⭐⭐ | 小 | ✅ v0.3.0 |
| 13 | 自适应路由 | ⭐⭐⭐⭐⭐ | 大 | ✅ v0.3.0 |
| 15 | 外部日志 Sink | ⭐⭐⭐ | 中 | ✅ v0.3.0 |
| 19 | Embeddings 端点 | ⭐⭐⭐ | 中 | ✅ v0.4 |
| 22 | 插件包管理器 | ⭐⭐⭐⭐ | 中 | ✅ v0.4 |
| 23 | 官方插件集 | ⭐⭐⭐⭐ | 大 | 🔵 v0.4 |
| 28 | Redis 共享状态 | ⭐⭐⭐⭐⭐ | 大 | 🟣 v0.5 |
| 31 | HTTP/2 连接池 | ⭐⭐⭐ | 中 | 🟣 v0.5 |
| 35 | 多租户隔离 | ⭐⭐⭐⭐ | 大 | 🟣 v0.5 |

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

| 开源版功能 | 企业版抽象 |
|-----------|-----------|
| 配置热重载 | Policy Bundle 远程下发 |
| 健康检查 | Fleet 健康总览 + 告警 |
| 负载均衡 | Fleet 级跨地域负载分配 |
| 自适应路由 | Fleet 聚合数据路由推荐 |
| Webhook 告警 | 统一告警管理 + 路由 |
| 审计日志 | 合规审计 + SIEM 导出 |
| 预算管理 | 组织级成本管理 + 报表 |
| 多租户 | 工作区 + RBAC + SCIM |

---

## 非功能性改进（持续进行）

| 项目 | 目标 |
|------|------|
| **测试覆盖率** | 保持 >90% 覆盖率，新功能必须带测试 |
| **文档** | 每个新功能配套用户文档 + 配置示例 |
| **性能基准** | 建立 benchmark suite，CI 中防止性能退化 |
| **安全审计** | 每个版本前进行安全审查 |
| **依赖更新** | 月度依赖更新，及时修复安全漏洞 |
| **国际化** | Dashboard 持续保持 7 语言同步 |
| **Docker 镜像** | 每个 release 发布 multi-arch 镜像 |
| **社区** | Issue 模板、Discussion、Contributing Guide |

---

## 建议下一批启动项

基于**用户价值最大 + 为后续功能奠基**的原则，v0.3.0 发布后建议优先启动：

1. **内置 Playground**（最直观的用户体验提升）
2. **结构化输出透传**（提升跨协议兼容性）
3. **Embeddings 端点**（扩展开源网关的 API 覆盖面）

这三项可以并行开发，互不依赖，并且都能继续保持 Cloud 作为可选控制面。
