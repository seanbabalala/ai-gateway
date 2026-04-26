# AI Gateway — 本地多协议智能 AI 代理

## Context

公司内网有 3 个 AI 节点，分别使用不同的 API 协议：
- **Google 节点** — `chat/completions` 格式（OpenAI 兼容）
- **GPT 节点** — `responses` 格式（OpenAI 新接口）
- **Claude 节点** — `messages` 格式（Anthropic 接口）

manifest 项目只支持 `chat/completions` 作为统一入口，无法原生支持 `responses` 和 `messages` 接口。与其缝补 manifest，不如借鉴其核心架构（复杂度评分 → 智能路由 → 自动回退），从零构建一个支持全部三种协议的本地智能代理。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                     客户端请求                            │
│  POST /v1/chat/completions  |  /v1/responses  |  /v1/messages │
└──────────┬──────────────────┬──────────────────┬────────┘
           │                  │                  │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │  Chat Ctrl  │   │  Resp Ctrl  │   │  Msg Ctrl   │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                  │                  │
           └──────────┬───────┘──────────────────┘
                      ▼
              ┌───────────────┐
              │  Normalizer   │  ← 输入格式 → Canonical 格式
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  Scorer       │  ← 请求复杂度评分 (simple/standard/complex/reasoning)
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  Router       │  ← Tier → 选择节点 + 回退链
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  Denormalizer │  ← Canonical 格式 → 目标节点格式
              └───────┬───────┘
                      ▼
    ┌─────────┬───────┴───────┬─────────┐
    ▼         ▼               ▼         │
 ┌──────┐ ┌──────┐      ┌──────┐       │
 │Google│ │ GPT  │      │Claude│       │ Fallback
 │(chat)│ │(resp)│      │(msg) │  ◄────┘
 └──┬───┘ └──┬───┘      └──┬───┘
    │        │              │
    └────────┴──────┬───────┘
                    ▼
              ┌───────────────┐
              │  Re-Normalize │  ← 响应回转为客户端请求的格式
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  Logger       │  ← 记录调用日志、token、成本
              └───────┬───────┘
                      ▼
                  客户端响应
```

## 项目结构

```
ai-gateway/
├── package.json
├── tsconfig.json
├── docker-compose.yml
├── gateway.config.yaml          # 节点配置文件
├── src/
│   ├── main.ts                  # NestJS 启动入口
│   ├── app.module.ts
│   │
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── config.service.ts    # 读取 YAML + env 配置
│   │   └── gateway.config.ts    # 配置类型定义
│   │
│   ├── canonical/               # ★ 核心: 统一内部格式
│   │   ├── canonical.types.ts   # CanonicalRequest / CanonicalResponse
│   │   ├── normalizers/
│   │   │   ├── chat-completions.normalizer.ts
│   │   │   ├── responses.normalizer.ts
│   │   │   └── messages.normalizer.ts
│   │   └── denormalizers/
│   │       ├── chat-completions.denormalizer.ts
│   │       ├── responses.denormalizer.ts
│   │       └── messages.denormalizer.ts
│   │
│   ├── pipeline/                # ★ 核心调度管线
│   │   ├── pipeline.module.ts
│   │   └── pipeline.service.ts   # Normalize → Score → Route → Forward → Denormalize
│   │
│   ├── ingest/                  # 入口控制器 (3个API端点)
│   │   ├── ingest.module.ts
│   │   ├── chat-completions.controller.ts
│   │   ├── responses.controller.ts
│   │   └── messages.controller.ts
│   │
│   ├── scoring/                 # 请求复杂度评分引擎
│   │   ├── scoring.module.ts
│   │   ├── scoring.service.ts
│   │   ├── dimensions/          # 评分维度
│   │   │   ├── keyword.dimension.ts
│   │   │   ├── structural.dimension.ts
│   │   │   └── tool.dimension.ts
│   │   └── trie.ts              # 关键词 Trie 匹配 (借鉴 manifest)
│   │
│   ├── routing/                 # 智能路由 + 回退
│   │   ├── routing.module.ts
│   │   ├── routing.service.ts   # Tier → 节点选择
│   │   ├── fallback.service.ts  # 回退链管理
│   │   ├── momentum.service.ts  # 会话动量平滑
│   │   └── circuit-breaker.service.ts  # 节点熔断器
│   │
│   ├── providers/               # 后端节点客户端
│   │   ├── providers.module.ts
│   │   ├── provider.interface.ts
│   │   ├── provider-client.service.ts  # 统一转发逻辑
│   │   ├── adapters/
│   │   │   ├── chat-completions.adapter.ts
│   │   │   ├── responses.adapter.ts
│   │   │   └── messages.adapter.ts
│   │   └── stream/
│   │       ├── stream-transformer.ts      # SSE 流式转换
│   │       ├── chat-completions.stream.ts
│   │       ├── responses.stream.ts
│   │       └── messages.stream.ts
│   │
│   ├── budget/                  # 预算控制
│   │   ├── budget.module.ts
│   │   ├── budget.service.ts
│   │   └── token-counter.ts
│   │
│   ├── observability/           # 可观测性
│   │   ├── observability.module.ts
│   │   ├── logger.service.ts    # 调用日志记录
│   │   ├── metrics.service.ts   # 指标聚合
│   │   └── health.controller.ts # GET /health 端点 (Docker 健康检查)
│   │
│   ├── dashboard/               # API 端点 (仪表盘数据)
│   │   ├── dashboard.module.ts
│   │   ├── dashboard.controller.ts
│   │   └── dashboard.service.ts
│   │
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── entities/
│   │   │   ├── node.entity.ts           # AI 节点配置
│   │   │   ├── tier-assignment.entity.ts # Tier → 节点映射
│   │   │   ├── call-log.entity.ts       # 调用日志
│   │   │   ├── budget-rule.entity.ts    # 预算规则
│   │   │   └── session.entity.ts        # 会话状态
│   │   └── migrations/
│   │
│   └── auth/
│       ├── auth.module.ts
│       └── api-key.guard.ts     # API Key 鉴权
│
├── frontend/                    # 仪表盘前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx    # 总览页
│       │   ├── Logs.tsx         # 调用日志
│       │   ├── Nodes.tsx        # 节点管理
│       │   ├── Routing.tsx      # 路由配置
│       │   └── Budget.tsx       # 预算管理
│       └── components/
│           ├── Chart.tsx        # 时序图表
│           └── Layout.tsx
│
└── test/
    ├── unit/
    │   ├── scoring.spec.ts
    │   ├── normalizer.spec.ts
    │   └── routing.spec.ts
    └── e2e/
        ├── chat-completions.e2e.ts
        ├── responses.e2e.ts
        └── messages.e2e.ts
```

## Phase 1: Canonical 格式 + 配置系统

### 1.1 Canonical 内部消息格式

这是整个系统的核心 — 三种 API 格式的统一内部表示：

```typescript
// canonical.types.ts

// ===== 角色统一 =====
type CanonicalRole = 'system' | 'user' | 'assistant' | 'tool';

// ===== 内容块统一 =====
type CanonicalContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | CanonicalContentBlock[] };

// ===== 消息统一 =====
interface CanonicalMessage {
  role: CanonicalRole;
  content: string | CanonicalContentBlock[];
}

// ===== 工具定义统一 =====
interface CanonicalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}

// ===== 请求统一 =====
interface CanonicalRequest {
  messages: CanonicalMessage[];
  tools?: CanonicalTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { name: string };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
  // 原始请求的元数据
  metadata: {
    source_format: 'chat_completions' | 'responses' | 'messages';
    original_model?: string;
    session_key?: string;
    raw_headers: Record<string, string>;
  };
}

// ===== 响应统一 =====
interface CanonicalResponse {
  id: string;
  content: CanonicalContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  // 路由元数据
  routing: {
    tier: string;
    node: string;
    latency_ms: number;
    score: number;
  };
}

// ===== 流式事件统一 =====
type CanonicalStreamEvent =
  | { type: 'start'; id: string; model: string }
  | { type: 'delta'; content: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name?: string; input_delta?: string } }
  | { type: 'stop'; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };
```

### 1.2 配置系统 (`gateway.config.yaml`)

```yaml
# gateway.config.yaml
server:
  port: 2099
  host: 0.0.0.0

database:
  type: sqlite              # MVP 用 SQLite，后续可切 PostgreSQL
  path: ./data/gateway.db

auth:
  api_keys:
    - key: "gw_sk_xxxxxxxx"
      name: "default"

nodes:
  - id: google
    name: "Google (Gemini)"
    protocol: chat_completions    # chat_completions | responses | messages
    base_url: "http://10.0.1.10:8080"
    endpoint: "/v1/chat/completions"
    api_key: "${GOOGLE_API_KEY}"
    models: ["gemini-2.0-flash", "gemini-2.5-pro"]
    timeout_ms: 30000

  - id: gpt
    name: "GPT (Responses)"
    protocol: responses
    base_url: "http://10.0.1.11:8080"
    endpoint: "/v1/responses"
    api_key: "${GPT_API_KEY}"
    models: ["gpt-4.1", "gpt-4.1-mini"]
    timeout_ms: 60000

  - id: claude
    name: "Claude (Messages)"
    protocol: messages
    base_url: "http://10.0.1.12:8080"
    endpoint: "/v1/messages"
    api_key: "${CLAUDE_API_KEY}"
    models: ["claude-sonnet-4-20250514"]
    timeout_ms: 60000
    headers:
      anthropic-version: "2023-06-01"

routing:
  tiers:
    simple:
      primary: { node: google, model: gemini-2.0-flash }
      fallbacks:
        - { node: gpt, model: gpt-4.1-mini }
    standard:
      primary: { node: gpt, model: gpt-4.1-mini }
      fallbacks:
        - { node: google, model: gemini-2.0-flash }
        - { node: claude, model: claude-sonnet-4-20250514 }
    complex:
      primary: { node: claude, model: claude-sonnet-4-20250514 }
      fallbacks:
        - { node: gpt, model: gpt-4.1 }
    reasoning:
      primary: { node: claude, model: claude-sonnet-4-20250514 }
      fallbacks:
        - { node: gpt, model: gpt-4.1 }

  scoring:
    simple_max: -0.1
    standard_max: 0.08
    complex_max: 0.35

budget:
  daily_token_limit: 1000000
  daily_cost_limit: 50.00
  alert_threshold: 0.8   # 80% 时告警

models_pricing:            # 每百万 token 成本 (USD)
  gemini-2.0-flash: { input: 0.10, output: 0.40 }
  gemini-2.5-pro: { input: 1.25, output: 10.00 }
  gpt-4.1: { input: 2.00, output: 8.00 }
  gpt-4.1-mini: { input: 0.40, output: 1.60 }
  claude-sonnet-4-20250514: { input: 3.00, output: 15.00 }
```

**关键文件**: `src/config/config.service.ts`, `src/config/gateway.config.ts`, `gateway.config.yaml`

---

## Phase 2: 格式转换层 (Normalizers / Denormalizers)

这是本项目与 manifest 的**最大区别** — manifest 只做 chat/completions → 各 provider；我们需要 **3×3 的全矩阵转换**。

### 2.1 输入归一化 (Input → Canonical)

| 输入格式 | 转换要点 |
|---|---|
| **chat/completions** | `messages[].role` + `messages[].content` 直接映射；`tools` → `CanonicalTool`；`function_call` 旧格式兼容 |
| **responses** | `input` (string/array) → `messages`；`tools` 的 `type: "function"` 提取；`instructions` → system message |
| | ⚠️ `previous_response_id` — **MVP 阶段标记为 out of scope**，不支持服务端多轮状态管理。客户端需自行维护上下文并在每次请求中传完整 `input`。后续可通过 `session.entity.ts` 扩展支持。|
| **messages** | 基本直接映射（最接近 Canonical 格式）；`system` 字段 → system message；`tool_use`/`tool_result` content block 映射 |

### 2.2 输出反归一化 (Canonical → Provider Format)

| 目标协议 | 转换要点 |
|---|---|
| **→ chat/completions** | `CanonicalMessage` → `{role, content}`；tool_use → `tool_calls` 数组；需设 `model` 字段 |
| **→ responses** | `CanonicalMessage` → `input` items；tool 定义转换；需要生成 `response` 包装结构 |
| **→ messages** | 直接映射；system 提取为顶层 `system` 字段；需设 `anthropic-version` header |

### 2.3 响应回转 (Provider Response → Canonical → Client Format)

同样是 3×3 矩阵，但方向相反。最复杂的是流式响应的回转。

**关键文件**: `src/canonical/normalizers/*.ts`, `src/canonical/denormalizers/*.ts`

---

## Phase 3: 入口控制器 + 请求管线

### 3.1 三个入口端点

```typescript
// chat-completions.controller.ts
@Controller('v1')
class ChatCompletionsController {
  @Post('chat/completions')
  async handle(@Req() req, @Res() res) {
    // 1. 验证请求格式
    // 2. normalize → CanonicalRequest
    // 3. 进入统一管线 pipeline.process(canonical, res)
  }
}

// responses.controller.ts
@Controller('v1')
class ResponsesController {
  @Post('responses')
  async handle(@Req() req, @Res() res) { /* ... */ }
}

// messages.controller.ts
@Controller('v1')
class MessagesController {
  @Post('messages')
  async handle(@Req() req, @Res() res) { /* ... */ }
}
```

### 3.2 统一处理管线

```typescript
// pipeline.service.ts — 核心调度
class PipelineService {
  async process(canonical: CanonicalRequest, res: Response) {
    // 1. 预算检查 → budgetService.check()
    // 2. 评分 → scoringService.score(canonical) → tier
    // 3. 路由 → routingService.resolve(tier, sessionKey) → { node, model, fallbacks }
    // 4. 转发 → providerClient.forward(canonical, node, model)
    //    ↳ 失败则遍历 fallbacks 重试
    // 5. 响应回转 → denormalize 为客户端期望的格式
    // 6. 日志记录 → loggerService.log(...)
  }
}
```

**关键文件**: `src/ingest/*.controller.ts`, `src/pipeline/pipeline.service.ts`

---

## Phase 4: 评分引擎

借鉴 manifest 的 23 维评分，简化为 **12 个核心维度**（够用且易维护）：

| 维度 | 权重 | 说明 |
|---|---|---|
| `simpleIndicators` | 0.10 | 简单问候/翻译/查询（降低分数）|
| `codeGeneration` | 0.12 | 代码生成相关关键词 |
| `formalLogic` | 0.10 | 逻辑推理/数学关键词 |
| `technicalTerms` | 0.08 | 专业技术术语密度 |
| `multiStep` | 0.08 | 多步骤任务指标 |
| `analyticalReasoning` | 0.08 | 分析推理关键词 |
| `tokenCount` | 0.10 | 输入 token 长度 |
| `toolCount` | 0.10 | 工具数量（tools 越多越复杂）|
| `conversationDepth` | 0.06 | 对话轮次深度 |
| `constraintDensity` | 0.06 | 约束条件密度 |
| `expectedOutputLength` | 0.06 | 预期输出长度 |
| `codeToProse` | 0.06 | 代码与自然语言比例 |

**快速路径**：
- 消息 < 50 字符且无复杂关键词 → 直接 `simple`
- 检测到形式逻辑模式 → 直接 `reasoning`
- 有 tools 定义 → 至少 `standard`

**关键文件**: `src/scoring/scoring.service.ts`, `src/scoring/dimensions/*.ts`, `src/scoring/trie.ts`

---

## Phase 5: 路由 + 回退 + 动量

### 5.1 路由逻辑

```typescript
// routing.service.ts
class RoutingService {
  resolve(tier: Tier, sessionKey?: string): RouteDecision {
    // 1. 查询 tier → primary node + fallbacks (从配置)
    // 2. 应用动量调整 (momentum)
    // 3. 返回 { node, model, fallbacks[] }
  }
}
```

### 5.2 回退链

```typescript
// fallback.service.ts
class FallbackService {
  async executeWithFallback(
    canonical: CanonicalRequest,
    primary: RouteTarget,
    fallbacks: RouteTarget[]
  ): Promise<CanonicalResponse | ReadableStream> {
    // 尝试 primary → 如果 HTTP 错误 → 依次尝试 fallbacks
    // 记录每次尝试的结果
  }
}
```

#### 流式回退策略

流式请求的回退遵循 **"连接阶段可回退，传输阶段不回退"** 原则：

| 阶段 | 失败场景 | 策略 |
|---|---|---|
| **连接建立阶段** | TCP 连接失败、HTTP 4xx/5xx、首个 SSE chunk 超时 | ✅ 触发回退链，尝试下一个 fallback 节点 |
| **传输阶段** | 已开始发送 chunk 后连接断开或节点超时 | ❌ 不回退，发送 SSE error event 通知客户端，由客户端决定是否重试 |

原因：一旦开始向客户端 stream 数据，中途切换到另一个节点会导致上下文断裂和内容不一致。

### 5.3 会话动量

```typescript
// momentum.service.ts — 内存中的会话 tier 历史
class MomentumService {
  // sessionKey → recent tier history (sliding window)
  // 加权平均 smoothing，避免同一会话中频繁跳 tier
}
```

### 5.4 节点熔断器 (Circuit Breaker)

基于被动健康检测的熔断机制，避免持续向不可用节点发送请求：

```typescript
// circuit-breaker.service.ts
enum CircuitState { CLOSED, OPEN, HALF_OPEN }

class CircuitBreakerService {
  // 每个节点独立维护状态
  // CLOSED  → 正常通行，记录失败次数
  // OPEN    → 连续失败达阈值后熔断，所有请求直接跳过该节点
  // HALF_OPEN → 熔断冷却期过后，放行一个探测请求
  //            → 成功则恢复 CLOSED，失败则重回 OPEN
}
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `failureThreshold` | 3 | 连续失败 N 次后触发熔断 |
| `cooldownMs` | 30000 | 熔断后等待 30s 进入 HALF_OPEN |
| `halfOpenMax` | 1 | HALF_OPEN 状态允许的探测请求数 |

与路由的集成：`RoutingService.resolve()` 在选节点时，跳过处于 OPEN 状态的节点，如果 primary 被熔断则直接使用第一个可用 fallback。

**关键文件**: `src/routing/*.ts`

---

## Phase 6: Provider 客户端 + 流式处理

### 6.1 统一转发

```typescript
// provider-client.service.ts
class ProviderClientService {
  async forward(
    canonical: CanonicalRequest,
    node: NodeConfig,
    model: string
  ): Promise<CanonicalResponse | ReadableStream<CanonicalStreamEvent>> {
    // 1. denormalize canonical → 目标节点格式
    // 2. HTTP 请求 (fetch / undici)
    // 3. 非流式: 解析响应 → normalize → CanonicalResponse
    // 4. 流式: 管道转换 SSE → CanonicalStreamEvent 流
  }
}
```

### 6.2 三种流式格式差异

| 格式 | SSE 结构 | Delta 路径 |
|---|---|---|
| **chat/completions** | `data: {"choices":[{"delta":{"content":"..."}}]}` | `choices[0].delta.content` |
| **responses** | `event: response.output_item.delta\ndata: {"delta":"..."}` | 多种 event type，有 `response.completed` |
| **messages** | `event: content_block_delta\ndata: {"delta":{"text":"..."}}` | `delta.text`，有 `message_start`/`message_stop` |

每种格式都需要一个 **StreamParser**（读取 provider SSE → CanonicalStreamEvent）和一个 **StreamSerializer**（CanonicalStreamEvent → 客户端 SSE）。

**关键文件**: `src/providers/adapters/*.ts`, `src/providers/stream/*.ts`

---

## Phase 7: 预算控制 + 可观测性

### 7.1 数据库 Schema (SQLite/PostgreSQL)

```sql
-- 调用日志
CREATE TABLE call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT UNIQUE,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  source_format TEXT,       -- chat_completions | responses | messages
  tier TEXT,                -- simple | standard | complex | reasoning
  score REAL,
  node_id TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  status_code INTEGER,
  is_fallback BOOLEAN,
  session_key TEXT,
  error TEXT
);

-- 预算规则
CREATE TABLE budget_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,                -- daily_tokens | daily_cost | monthly_cost
  limit_value REAL,
  alert_threshold REAL,
  current_value REAL DEFAULT 0,
  period_start DATETIME,
  is_active BOOLEAN DEFAULT TRUE
);

-- 节点状态
CREATE TABLE node_status (
  node_id TEXT PRIMARY KEY,
  is_healthy BOOLEAN DEFAULT TRUE,
  last_check DATETIME,
  consecutive_failures INTEGER DEFAULT 0,
  avg_latency_ms REAL
);
```

### 7.2 Token 计数策略

**不自行实现 tokenizer**。不同模型的 tokenizer 差异大（BPE / SentencePiece 等），自行计算容易不准且维护成本高。

策略：
1. **优先使用 provider 返回的 `usage` 字段**（`input_tokens` + `output_tokens`），这是最准确的数据
2. 非流式请求：直接从响应体提取 `usage`
3. 流式请求：从最后一个 SSE event（`message_stop` / `[DONE]` / `response.completed`）中提取 `usage`
4. 兜底：如果 provider 未返回 usage（极少数情况），按字符数 ÷ 4 粗略估算

### 7.3 Dashboard API

```
GET  /health                      → 网关健康状态 + 各节点连通性 (供 Docker/K8s 探针使用)

GET  /api/dashboard/overview      → 总览数据 (总调用/token/成本/按tier分布)
GET  /api/dashboard/logs          → 调用日志列表 (分页/筛选)
GET  /api/dashboard/logs/stream   → SSE 实时日志流推送 (前端实时日志页)
GET  /api/dashboard/timeseries    → 时序数据 (调用量/延迟/成本曲线)
GET  /api/dashboard/nodes         → 节点健康状态 + 熔断器状态
POST /api/dashboard/nodes/:id     → 更新节点配置
GET  /api/dashboard/budget        → 预算使用情况
POST /api/dashboard/budget        → 设置预算规则
GET  /api/dashboard/routing       → 路由配置
POST /api/dashboard/routing       → 更新路由映射
```

**关键文件**: `src/budget/*.ts`, `src/observability/*.ts`, `src/dashboard/*.ts`, `src/database/entities/*.ts`

---

## Phase 8: 前端仪表盘

### 设计风格：深色极简 (Dark Minimal)

参考 manifest 项目 (mnfst/manifest) 的功能布局，但完全重新设计视觉风格。manifest 的设计问题：颜色寡淡缺层次、卡片无质感、Chart 区域老气、Sidebar 太基础。我们的方案：

**设计理念**：Vercel / Linear / Raycast 风格 — 深色沉浸、微光质感、信息密度高

#### 色彩系统

```
背景层级:
  └── Level 0 (页面背景):  #09090b    (zinc-950)
  └── Level 1 (Sidebar):    #0c0c0f
  └── Level 2 (卡片/面板):  #18181b    (zinc-900)
  └── Level 3 (悬浮/弹窗):  #27272a    (zinc-800)

边框:       #27272a (zinc-800) — 默认
            #3f3f46 (zinc-700) — hover/focus

文字:
  └── 主文字:    #fafafa (zinc-50)
  └── 次文字:    #a1a1aa (zinc-400)
  └── 弱文字:    #71717a (zinc-500)

强调色 (蓝紫渐变):
  └── Primary:    linear-gradient(135deg, #6366f1, #8b5cf6)  — Indigo → Violet
  └── Primary 纯色: #818cf8 (indigo-400)

语义色:
  └── 成功/健康:  #34d399 (emerald-400)
  └── 警告:       #fbbf24 (amber-400)
  └── 错误/危险:  #f87171 (red-400)
  └── 信息:       #60a5fa (blue-400)

Tier 标签色:
  └── simple:     #34d399 (emerald)
  └── standard:   #60a5fa (blue)
  └── complex:    #c084fc (purple)
  └── reasoning:  #f472b6 (pink)
```

#### 质感效果

```css
/* 卡片微光边框 */
.card {
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.03),   /* 内发光 */
    0 1px 2px rgba(0,0,0,0.4);           /* 底部阴影 */
}
.card:hover {
  border-color: #3f3f46;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.05),
    0 4px 12px rgba(0,0,0,0.5);
}

/* 数据指标数字 — 渐变高亮 */
.metric-value {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  background: linear-gradient(180deg, #fafafa 0%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Sidebar 选中态 — 左侧发光条 */
.sidebar-item.active {
  background: rgba(99, 102, 241, 0.1);
  border-left: 2px solid #818cf8;
}
```

#### 排版

```
字体:
  └── 正文:   Inter (无衬线)
  └── 数字:   JetBrains Mono / Geist Mono (等宽，让数字对齐)
  └── 代码:   JetBrains Mono

字号:
  └── 页面标题:   24px / 600
  └── 卡片标题:   13px / 500 / uppercase / letter-spacing: 0.05em (次文字色)
  └── 指标数字:   32px / 700 / -0.03em
  └── 正文:       14px / 400
  └── 辅助文字:   12px / 400
```

### 页面设计

| 页面 | 功能 | 设计要点 |
|---|---|---|
| **Dashboard** | 总览卡片 + 时序图 + 最近调用 | 顶部 4 列指标卡 (总调用/Token/成本/延迟)，每个带 sparkline 小图 + 趋势箭头；下方大面积 area chart (支持 Cost/Token/Messages 切换)；底部最近 5 条调用记录 |
| **Logs** | 调用日志表格 | 顶部筛选栏 (Tier/Node/Status 多选 tag)；表格行带 Tier 颜色标签 + 节点图标 + 延迟条形图；点击行展开 JSON 详情面板 (代码高亮) |
| **Nodes** | 节点管理 | 3 个节点卡片 (Google/GPT/Claude)，每个显示：状态圆点 (绿/黄/红) + 成功率环形进度条 + 平均延迟 + 熔断器状态 badge；卡片可点击进入编辑 |
| **Routing** | 路由可视化 | 左侧 4 个 Tier 卡 (simple/standard/complex/reasoning)；右侧连线到节点卡，展示 primary + fallback 关系；支持 drag-drop 调整优先级 |
| **Budget** | 预算管理 | 大号环形仪表 (已用/总额)；下方分模型成本柱状图 + 预算规则列表 |

### 布局结构

```
┌─────────────────────────────────────────────────────────┐
│  [Logo]  AI Gateway                    [Status] [Theme] │  ← Header: 48px, 毛玻璃背景
├────────┬────────────────────────────────────────────────┤
│        │                                                │
│  ◈ 总览 │   ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│  ◈ 日志 │   │调用│ │Token│ │成本│ │延迟│  ← 指标卡       │
│  ◈ 节点 │   └────┘ └────┘ └────┘ └────┘                │
│  ◈ 路由 │                                                │
│  ◈ 预算 │   ┌────────────────────────────┐              │
│        │   │                              │              │
│ 200px  │   │     Area Chart (24h)         │  ← 主图表   │
│ Sidebar│   │                              │              │
│        │   └────────────────────────────┘              │
│        │                                                │
│        │   ┌────────────────────────────┐              │
│        │   │   Recent Calls Table        │  ← 最近调用  │
│        │   └────────────────────────────┘              │
└────────┴────────────────────────────────────────────────┘
```

Sidebar 特点：
- 每个导航项带图标 (Lucide Icons)
- 分组：MONITORING (总览/日志) / MANAGE (节点/路由/预算)
- 底部显示网关状态 (online/offline) + 版本号
- 宽度 200px，固定定位

### 技术栈

| 方面 | 方案 |
|---|---|
| **框架** | React 19 + Vite |
| **HTTP 客户端** | `fetch` API（轻量，无需额外依赖） |
| **实时日志** | SSE（Server-Sent Events）推送，`/api/dashboard/logs/stream` 端点 |
| **UI 组件库** | Tailwind CSS v4 + shadcn/ui (New York 主题 + 自定义深色 token) |
| **图标** | Lucide React |
| **图表** | Recharts（React 生态最成熟的图表库） |
| **状态管理** | React Query (TanStack Query) 管理服务端状态 + 自动缓存/刷新 |
| **路由** | React Router v7 |
| **动效** | Framer Motion (页面切换 + 卡片交互) |

### 与 manifest 前端的差异

| 方面 | manifest | AI Gateway (我们) |
|---|---|---|
| 框架 | SolidJS | React 19 |
| 样式方案 | 原生 CSS (BEM) + 30 个 CSS 文件 | Tailwind CSS + shadcn/ui 组件 |
| 主题 | Light + 简陋 Dark | 深色优先，微光质感 |
| 组件数 | 72 个 (大量重复/碎片化) | 精简组件，composable 设计 |
| 页面数 | 23 个 (含登录注册/多 agent) | 5 个核心页 (无用户系统) |
| 图标 | Box Icons (过时) | Lucide (现代统一) |
| 图表 | uPlot (轻量但定制难) | Recharts (易定制主题色) |
| 设计感 | 中规中矩，缺乏层次 | 深色极简，Vercel/Linear 级别 |

**关键文件**: `frontend/src/pages/*.tsx`, `frontend/src/components/*.tsx`

---

## 实施顺序

```
Phase 1: 基础设施 (2-3天)
  ├── NestJS 项目初始化 + 配置系统
  ├── Canonical 类型定义
  └── SQLite 数据库 + 实体

Phase 2: 格式转换核心 (3-4天)  ★ 最关键
  ├── 3 个 Normalizer (输入 → Canonical)
  ├── 3 个 Denormalizer (Canonical → 输出)
  └── 单元测试覆盖转换正确性

Phase 3: 代理转发 (2-3天)
  ├── 3 个入口 Controller
  ├── Pipeline 管线
  ├── Provider Client (非流式先行)
  └── E2E 测试: 请求 → 转发 → 响应

Phase 4: 流式支持 (3-4天)  ← 调整: 流式转换+跨格式SSE容易踩坑
  ├── 3 种 StreamParser
  ├── 3 种 StreamSerializer
  ├── 流式回退策略 (连接阶段回退/传输阶段不回退)
  └── 流式 E2E 测试 (覆盖中断场景)

Phase 5: 智能路由 (2-3天)  ← 调整: 加入熔断器
  ├── 评分引擎 + Trie
  ├── 路由解析 + 回退链
  ├── 动量服务
  └── Circuit Breaker 熔断器

Phase 6: 预算 + 可观测性 (2天)
  ├── Token 计数 (基于 provider 返回的 usage)
  ├── 成本计算 + 预算规则引擎
  ├── /health 端点
  └── 日志记录

Phase 7: 仪表盘前端 (3-4天)  ← 调整: 增加 SSE 实时日志
  ├── React + Vite + Tailwind + shadcn/ui 初始化
  ├── Dashboard API + SSE 日志流
  └── 5 个页面

Phase 8: 容器化 + 文档 (1天)
  ├── Dockerfile + docker-compose
  └── 使用文档
```

**总预估: 18-24 天**

---

## 验证计划

### 单元测试
- 每个 Normalizer/Denormalizer 的转换正确性（覆盖 tool_use、streaming、多轮对话等边界情况）
- 评分引擎的分类准确性（准备 50+ 测试用例覆盖 4 个 tier）
- 路由/回退逻辑

### E2E 测试
1. **基本代理**: 用 curl 发送 3 种格式的请求，验证返回正确格式
2. **交叉转换**: 用 chat/completions 格式请求，路由到 Claude (messages) 节点，验证转换正确
3. **流式**: 验证 3 种流式格式的正确转换
4. **回退**: 模拟主节点超时，验证自动切换到 fallback
5. **预算**: 设置低预算限额，验证超限拒绝

### 集成测试
- 用真实的 3 个内网节点进行端到端测试
- 用 OpenAI SDK / Anthropic SDK 作为客户端验证兼容性

---

## 与 Manifest 的关键差异

| 方面 | Manifest | AI Gateway (我们) |
|---|---|---|
| 入口协议 | 仅 chat/completions | 3 种全部支持 |
| 内部格式 | 直接用 OpenAI 格式 | Canonical 统一格式 |
| 数据库 | PostgreSQL 必需 | SQLite (轻量) 可选 PG |
| 部署 | Docker + 云服务 | 纯本地内网 |
| 认证 | Better Auth (完整用户系统) | 简单 API Key |
| 前端 | SolidJS | React (生态更好) |
| 评分维度 | 23 维 | 12 维 (精简但够用) |
| 节点数 | 15+ provider | 3 个内网节点 (可扩展) |
