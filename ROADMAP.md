# AI Gateway — Roadmap（待做事项总览）

> 最后更新: 2026-04-28
> 已完成: Dashboard 认证 (JWT 登录 + Guard + 自动 hash), 多模态路由 (#11)

---

## 当前状态速览

| 维度 | 状态 |
|------|------|
| 协议 | ✅ 3 协议互转 |
| 评分 | ✅ 14 维度 + 快速路径 |
| 路由 | ✅ Tier 路由 + Circuit Breaker + Momentum 平滑 |
| Dashboard | ✅ 5 页面 + SSE 实时 + CRUD + JWT 认证 |
| 预算 | ✅ 日 Token + 日费用双限额 |
| 流式 | ✅ 3 协议完整 SSE |
| Docker | ✅ 多阶段构建 |

---

## P0 — 高优先级（直接影响生产可用性）

### 1. 路由配置 UI
**现状**: `RoutingPage` 纯只读展示 tier/primary/fallbacks，改路由必须手编 YAML。
**目标**: 在前端直接编辑路由配置，所见即所得。

#### 后端
- `PUT /api/dashboard/routing/tiers` — 接收完整 tiers 配置，校验节点/模型存在性，写入 YAML
- `PUT /api/dashboard/routing/scoring` — 修改评分阈值
- `PUT /api/dashboard/routing/domain-preferences` — 修改域名偏好
- `ConfigService` 新增 `updateRouting(partial)` + `saveConfig()`

#### 前端
- **Tier 编辑卡片**: 每个 tier 一张卡片，primary 用 Select 选节点+模型，fallbacks 支持拖拽排序 + 增删
- **阈值滑块**: 当前的彩色条变为可拖拽的双向滑块，实时预览 tier 分界线
- **域名偏好编辑**: 可添加/删除域名 → 节点映射
- 保存按钮 + 确认对话框（改路由影响全局）

**复杂度**: 中 | **预计**: 前端为主

---

### 2. 请求重试策略
**现状**: Pipeline 中 fallback 是顺序尝试下一个节点，没有重试同一节点的能力，也没有退避策略。
**目标**: 支持可配置的重试 + 指数退避。

#### 配置 (`gateway.config.yaml`)
```yaml
routing:
  retry:
    max_retries: 2          # 每个节点最多重试次数
    backoff_base_ms: 500    # 初始退避
    backoff_max_ms: 5000    # 最大退避
    retryable_status: [429, 502, 503]  # 可重试的状态码
```

#### 后端
- `RoutingConfig` 新增 `RetryConfig` 接口
- `PipelineService.tryProvider()` 加重试循环：失败 → 检查 status code 是否可重试 → 指数退避 → 重试
- 429 特殊处理：读取 `Retry-After` header
- 流式请求：仅在连接阶段（收到第一个 chunk 之前）可重试
- CallLog 记录重试次数

#### 前端
- Dashboard stats 新增 "重试率" 指标
- Logs 展开详情中显示重试次数

**复杂度**: 小 | **预计**: 纯后端

---

### 3. API Key 认证守卫
**现状**: `auth.api_keys` 配置存在但 `/v1/*` 入口完全没有校验！任何人都能调用代理。
**目标**: 对 `/v1/*` 端点强制 API Key 认证。

#### 后端
- 新建 `src/auth/api-key.guard.ts` — `CanActivate` 守卫
  - 从 `Authorization: Bearer <key>` 提取 key
  - 对比 `config.auth.api_keys[].key`
  - 匹配 → 在 request 上附加 `apiKeyName`（用于日志归属）
  - 不匹配 → 401
  - `auth.api_keys` 为空 → 放行（向后兼容，开发友好）
- 在 `ChatCompletionsController`、`ResponsesController`、`MessagesController` 加 `@UseGuards(ApiKeyGuard)`
- CallLog 新增 `api_key_name` 字段，记录哪个 key 发起的请求

**复杂度**: 小 | **预计**: 纯后端

---

## P1 — 增强竞争力

### 4. Rate Limiting
**现状**: 无任何限流，API Key 被泄露后无法防御。
**目标**: 按 API Key / IP 限流。

#### 方案
- 使用内存滑动窗口计数器（无需 Redis）
- 配置:
```yaml
auth:
  rate_limit:
    requests_per_minute: 60     # 每个 API Key 每分钟
    requests_per_minute_ip: 120 # 每个 IP 每分钟（无 key 时）
```
- 新建 `src/auth/rate-limit.guard.ts`
- 响应头: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- 超限返回 429 + `Retry-After`

**复杂度**: 中

---

### 5. 模型级 Circuit Breaker
**现状**: Circuit Breaker 是节点级别，节点 A 的模型 X 故障会导致节点 A 的所有模型都被熔断。
**目标**: 细化到 `nodeId:model` 粒度。

#### 后端
- `CircuitBreakerService` 的 key 从 `nodeId` 改为 `${nodeId}:${model}`
- 保留节点级聚合状态（Dashboard 展示用）：任一模型 OPEN → 节点显示 degraded
- `reset(nodeId)` 同时重置该节点所有模型的 breaker
- 新增 `reset(nodeId, model)` 重置单个模型

#### 前端
- Nodes 页面展开详情显示每个模型的熔断状态
- 支持按模型重置 circuit breaker

**复杂度**: 中

---

### 6. 成本分析仪表板
**现状**: DashboardPage 有总成本和 24h 成本，但没有趋势和明细。
**目标**: 新增 Cost Analytics 页面。

#### 后端
- `GET /api/dashboard/analytics/cost` — 参数: `period=7d|30d|90d`, `groupBy=model|node|tier`
- 按日聚合: `SELECT date(timestamp), node_id, model, SUM(cost_usd), SUM(input_tokens+output_tokens) GROUP BY ...`
- 按模型/节点/tier 汇总 top N

#### 前端
- 新增 `/analytics` 页面（Sidebar 加入口）
- **折线图**: 每日成本趋势（Recharts `AreaChart`）
- **饼图**: 按模型/节点的成本分布
- **表格**: 明细 — 模型、调用次数、总 token、总成本、平均成本/次
- 时间范围切换: 7d / 30d / 90d

**复杂度**: 中

---

### 7. 请求日志导出
**现状**: Logs 页面只有浏览，没有导出。
**目标**: 支持 CSV/JSON 导出 + 日志自动清理。

#### 后端
- `GET /api/dashboard/logs/export?format=csv|json&days=7` — 流式输出
- CSV: 标准字段（timestamp, tier, node, model, status, latency, tokens, cost）
- 日志清理: 配置 `database.log_retention_days: 30`，启动时和每日 0 点检查删除过期日志

#### 前端
- Logs 页面右上角加 "Export" 按钮 + 格式选择下拉
- 点击后浏览器直接下载文件

**复杂度**: 小

---

### 8. 自定义评分维度
**现状**: 14 维度硬编码，用户无法调整权重或加关键词。
**目标**: 允许通过配置调整权重 + 添加自定义关键词。

#### 配置
```yaml
routing:
  scoring:
    simple_max: -0.1
    standard_max: 0.08
    complex_max: 0.35
    # 新增:
    weights:
      codeGeneration: 0.12    # 覆盖默认权重
      formalLogic: 0.15       # 加大逻辑推理权重
    custom_keywords:
      - pattern: "kubernetes|k8s|helm"
        dimension: codeBackend
        weight: 0.6
      - pattern: "legal|contract|compliance"
        dimension: analyticalReasoning
        weight: 0.7
```

#### 后端
- `ScoringThresholds` 扩展: 新增 `weights?` 和 `custom_keywords?`
- `ScoringService` 初始化时合并默认权重 + 用户覆盖
- 自定义关键词注入到对应维度的 Trie 中

**复杂度**: 中

---

## P2 — 长期方向

### 9. 多租户支持
**现状**: 单一配置空间，所有 API Key 共享节点/路由/预算。
**目标**: 每个 API Key（或 Key Group）有独立的预算、路由策略、日志隔离。

#### 设计
- `auth.api_keys` 扩展:
```yaml
auth:
  api_keys:
    - key: "${KEY_A}"
      name: "team-frontend"
      group: "frontend"
      budget: { daily_cost_limit: 20 }
      routing_override: { ... }
```
- BudgetService 按 group 隔离计量
- CallLog 加 `api_key_group` 字段
- Dashboard 按 group 筛选

**复杂度**: 大

---

### 10. A/B 测试框架
**现状**: 每个 tier 只有固定的 primary + fallback 链。
**目标**: 同一 tier 按百分比分流到不同模型，对比质量和成本。

#### 设计
```yaml
routing:
  tiers:
    complex:
      split:
        - { node: claude, model: claude-opus-4-6-v1, weight: 70 }
        - { node: gpt, model: gpt-5.4, weight: 30 }
      fallbacks: [...]
```
- RoutingService 加权随机选择
- CallLog 记录 `experiment_group`
- Analytics 页面对比两组的延迟/成本/成功率

**复杂度**: 大

---

### 11. Vision / 多模态路由
**现状**: 评分引擎只分析文本内容，不感知图片/音频。
**目标**: 检测请求中的多模态内容，自动路由到支持该模态的节点。

#### 设计
- Normalizer 阶段检测 `content` 中是否含 `image_url` / `image` 类型 block
- 节点配置新增 `modalities: ["text", "vision", "audio"]`
- RoutingService 过滤不支持该模态的节点
- 评分引擎: 含图片自动提升到 standard 以上

**复杂度**: 中

---

### 12. Plugin / 中间件系统
**现状**: Pipeline 流程硬编码。
**目标**: 允许在请求/响应链中插入自定义处理逻辑。

#### 设计
- 请求生命周期钩子: `beforeScoring` → `afterRouting` → `beforeUpstream` → `afterUpstream`
- Plugin 通过配置文件指定 JS/TS 脚本路径
- 用例: PII 脱敏、Prompt 注入检测、自定义日志、响应后处理

**复杂度**: 大

---

### 13. OpenTelemetry 可观测性
**现状**: 日志写 DB + SSE，没有标准 Traces/Metrics。
**目标**: 集成 OpenTelemetry，支持 Jaeger/Prometheus/Grafana。

#### 设计
- 每个请求创建 Span: `gateway.request` → `scoring` → `routing` → `upstream.call`
- Metrics: 请求延迟直方图、吞吐量、错误率、token 消耗速率
- 配置:
```yaml
telemetry:
  enabled: true
  endpoint: "http://localhost:4318"  # OTLP endpoint
```

**复杂度**: 中

---

### 14. Prompt 缓存
**现状**: 每次请求都打上游，相同的简单问题也会重复消耗 token。
**目标**: 对相似请求缓存响应，降低成本和延迟。

#### 设计
- 缓存 key: `SHA-256(model + messages[-1].content + temperature)`（仅 temperature=0 时缓存）
- 存储: 内存 LRU（可选 SQLite 表持久化）
- TTL: 可配置（默认 1h）
- 命中时直接返回缓存，CallLog 标记 `cached: true`
- Dashboard 显示缓存命中率

**复杂度**: 大

---

## 实施顺序建议

```
Phase A (P0 — 生产必备)
  ├── #3 API Key 守卫        ← 最小改动，立即堵住安全漏洞
  ├── #2 请求重试策略         ← 小改动，大幅提升稳定性
  └── #1 路由配置 UI          ← 前端为主，提升日常使用体验

Phase B (P1 — 竞争力)
  ├── #4 Rate Limiting        ← 配合 API Key 守卫
  ├── #5 模型级 Circuit Breaker
  ├── #7 日志导出             ← 小改动
  ├── #6 成本分析仪表板
  └── #8 自定义评分维度

Phase C (P2 — 长期)
  ├── #9  多租户
  ├── #10 A/B 测试
  └── #13 OpenTelemetry
```

---

## 已完成

- [x] ~~Dashboard 认证~~ — JWT 登录 + DashboardGuard + 明文自动 hash + 退出按钮 (2026-04-27)
- [x] ~~API Key 认证守卫~~ — /v1/* 全部端点强制校验 API Key + CallLog 记录 key name (2026-04-27)
- [x] ~~请求重试策略~~ — 指数退避 + 可配置 max_retries/backoff/retryable_status + 429 Retry-After + CallLog retry_count (2026-04-27)
- [x] ~~路由配置 UI~~ — RoutingPage 支持编辑模式: tier primary/fallbacks 选择、阈值编辑、域名偏好增删改 + PUT /api/dashboard/routing (2026-04-27)
- [x] ~~日志导出~~ — GET /api/dashboard/logs/export CSV/JSON 下载 + log_retention_days 自动清理 + 前端 Export 按钮 (2026-04-27)
- [x] ~~Rate Limiting~~ — 滑动窗口限流 per API Key/IP + X-RateLimit-* 响应头 + 429 Retry-After + 自动清理 (2026-04-27)
- [x] ~~模型级 Circuit Breaker~~ — 熔断粒度从 nodeId 细化到 nodeId:model + 节点级聚合状态 + Dashboard 显示每模型状态 + 按模型重置 (2026-04-27)
- [x] ~~成本分析仪表板~~ — GET /api/dashboard/analytics/cost 多维度聚合 + AnalyticsPage 折线图/饼图/柱状图/表格 + 7d/30d/90d 切换 (2026-04-27)
- [x] ~~自定义评分维度~~ — ScoringThresholds 扩展 weights + custom_keywords + ScoringService 合并用户权重 + 自定义关键词注入 Trie (2026-04-27)
- [x] ~~Prompt 缓存~~ — SHA-256 cache key + 内存 LRU + TTL + temperature=0 缓存 + 流式回放/累积 + Dashboard 缓存状态卡片 + 清空按钮 (2026-04-27)
- [x] ~~Vision / 多模态路由~~ — 三层模态检测 (显式声明 + 模型名推断 + Capability 回退) + 请求模态扫描 + vision tier floor + 路由模态过滤 + 降级 fallback + Dashboard modality badges (2026-04-28)
- [x] ~~Plugin 系统~~ — 7 个管道钩子 (preRequest/postScoring/preUpstream/postUpstream/preResponse/streamEvent/onError) + waterfall 执行 + 短路返回 + 自定义评分维度注册 + 多主题 EventBus + plugins/ 目录自动发现 + ajv 配置校验 + 零插件零开销 + 2 个示例插件 (request-logger, pii-filter) (2026-04-28)
