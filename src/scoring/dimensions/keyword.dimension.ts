// ===================================================================
// Keyword Dimensions — simpleIndicators, codeGeneration, formalLogic,
//                       technicalTerms, analyticalReasoning
// ===================================================================
// These dimensions use Trie-based keyword matching to score text.
// Each returns a normalized score in [-1, 1] range.
// ===================================================================

import { KeywordTrie } from '../trie';
import { CanonicalRequest } from '../../canonical/canonical.types';

// ─── Keyword Lists ────────────────────────────────────────

const SIMPLE_INDICATORS = [
  // Greetings / chit-chat
  '你好', '你好啊', '嗨', '在吗', 'hello', 'hi', 'hey', 'good morning',
  'good afternoon', 'good evening', 'how are you', '早上好', '晚上好',
  // Simple tasks
  '翻译', 'translate', '翻译一下', '帮我翻译',
  '什么意思', 'what does', 'what is', 'define',
  '几点', 'what time', '天气', 'weather',
  '谢谢', 'thanks', 'thank you', '好的', 'ok', 'okay',
  // Simple lookups
  '简单介绍', '简要说明', 'briefly explain', 'summarize in one sentence',
];

const CODE_GENERATION = [
  // General code tasks (domain-neutral)
  '写代码', '写一个', '实现一个', '编写', '代码', '函数', '类',
  'write code', 'implement', 'create a function', 'write a class',
  'code review', 'refactor', 'debug', 'fix the bug', 'unit test',
  // General concepts
  'algorithm', '算法', 'data structure', '数据结构',
  'regex', '正则', 'design pattern', '设计模式',
  // Build / tooling
  'npm', 'yarn', 'pip', 'cargo', 'gradle', 'maven',
];

// ─── Frontend-specific keywords ───────────────────────────

const CODE_FRONTEND = [
  // Frameworks / libs
  'react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'remix',
  'tailwind', 'shadcn', 'radix', 'chakra', 'antd', 'ant design', 'element-ui',
  'material-ui', 'mui', 'styled-components', 'emotion', 'framer motion',
  // Core web
  'html', 'css', 'scss', 'sass', 'less', 'dom',
  'responsive', '响应式', 'layout', '布局', 'flex', 'grid',
  'animation', '动画', 'transition', '过渡',
  // Frontend concepts
  'component', '组件', 'props', 'state', 'hook', 'usestate', 'useeffect',
  'virtual dom', 'jsx', 'tsx', 'ssr', 'ssg', 'hydration',
  'client-side', '前端', 'frontend', 'ui', 'ux',
  'landing page', '页面', 'form', '表单', 'modal', '弹窗',
  'responsive design', 'dark mode', '暗色模式',
  // Build
  'webpack', 'vite', 'rollup', 'esbuild', 'turbopack',
  'storybook', 'playwright', 'cypress',
];

// ─── Backend / system-level keywords ──────────────────────

const CODE_BACKEND = [
  // Languages (backend-heavy)
  'python', 'java', 'rust', 'golang', 'go', 'c++', 'c#', 'scala', 'elixir', 'erlang',
  // Backend frameworks
  'nestjs', 'express', 'fastify', 'koa', 'django', 'flask', 'fastapi',
  'spring', 'spring boot', 'gin', 'actix', 'rocket',
  'ruby on rails', 'rails', 'laravel', 'phoenix',
  // Backend concepts
  'api', 'rest', 'graphql', 'grpc', 'websocket', 'protobuf',
  'database', 'sql', 'nosql', 'orm', 'typeorm', 'prisma', 'sequelize',
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
  'migration', '数据库', '后端', 'backend', 'server-side', '服务端',
  // Infrastructure
  'docker', 'kubernetes', 'k8s', 'ci/cd', 'pipeline',
  'nginx', 'load balancer', '负载均衡', 'reverse proxy',
  'message queue', '消息队列', 'kafka', 'rabbitmq', 'celery',
  'cron', 'worker', 'daemon', '进程', 'thread', '线程',
  // Architecture patterns (backend-heavy)
  'middleware', '中间件', 'interceptor', 'guard', 'decorator',
  'repository pattern', 'service layer', 'dependency injection',
  'event driven', 'pub/sub', 'saga', 'outbox pattern',
  'transaction', '事务', 'lock', '锁', 'concurrency', '并发',
];

const FORMAL_LOGIC = [
  // Math
  '证明', '推导', '定理', '公理', '引理',
  'prove', 'proof', 'theorem', 'axiom', 'lemma', 'corollary',
  '数学', 'mathematical', 'equation', '方程',
  'calculus', '微积分', 'integral', '积分', 'derivative', '导数',
  'linear algebra', '线性代数', 'matrix', '矩阵',
  'probability', '概率', 'statistics', '统计',
  // Logic
  '逻辑', 'logical', 'reasoning', '推理',
  'if and only if', '当且仅当', 'necessary and sufficient', '充要条件',
  'contradiction', '矛盾', 'induction', '归纳',
  'deduction', '演绎', 'syllogism', '三段论',
  // Formal methods
  'formal verification', '形式化验证',
  'state machine', '状态机', 'automaton', '自动机',
  'complexity', 'np-hard', 'np-complete', 'big-o', '时间复杂度',
];

const TECHNICAL_TERMS = [
  // ML/AI
  'machine learning', '机器学习', 'deep learning', '深度学习',
  'neural network', '神经网络', 'transformer', 'attention mechanism',
  'gradient descent', '梯度下降', 'backpropagation', '反向传播',
  'fine-tuning', '微调', 'embedding', '向量', 'token',
  'llm', 'large language model', '大语言模型',
  // Systems
  'distributed system', '分布式', 'microservice', '微服务',
  'load balancing', '负载均衡', 'sharding', '分片',
  'consensus', '一致性', 'raft', 'paxos', 'cap theorem',
  'eventual consistency', '最终一致性',
  // Crypto / Security
  'encryption', '加密', 'authentication', '认证',
  'cryptography', '密码学', 'hash', 'hmac', 'jwt', 'oauth',
  // Architecture
  'architecture', '架构', 'scalability', '可扩展性',
  'high availability', '高可用', 'fault tolerance', '容错',
  'event sourcing', 'cqrs', 'domain driven', 'ddd',
];

const ANALYTICAL_REASONING = [
  // Analysis keywords
  '分析', '对比', '比较', '权衡', '评估', '优缺点',
  'analyze', 'compare', 'contrast', 'evaluate', 'trade-off', 'pros and cons',
  'advantages and disadvantages', 'strengths and weaknesses',
  // Critical thinking
  '深入分析', 'in-depth analysis', '全面分析', 'comprehensive analysis',
  '根本原因', 'root cause', 'impact analysis', '影响分析',
  // Planning
  '方案设计', '系统设计', 'system design', 'architecture design',
  '技术选型', 'technology selection', '最佳实践', 'best practice',
  // Multi-perspective
  '从...角度', 'from the perspective of', '多个维度', 'multiple dimensions',
  '综合考虑', 'considering', '长远来看', 'in the long run',
];

// ─── Trie Instances (built once, reused) ──────────────────

let _simpleTrie: KeywordTrie | null = null;
let _codeTrie: KeywordTrie | null = null;
let _codeFrontendTrie: KeywordTrie | null = null;
let _codeBackendTrie: KeywordTrie | null = null;
let _logicTrie: KeywordTrie | null = null;
let _technicalTrie: KeywordTrie | null = null;
let _analyticalTrie: KeywordTrie | null = null;

/** Reset all trie singletons (called when config changes). */
export function resetTries(): void {
  _simpleTrie = null;
  _codeTrie = null;
  _codeFrontendTrie = null;
  _codeBackendTrie = null;
  _logicTrie = null;
  _technicalTrie = null;
  _analyticalTrie = null;
}

/** Dimension name → trie getter mapping (for custom keyword injection). */
const DIMENSION_TRIE_MAP: Record<string, () => KeywordTrie> = {
  simpleIndicators: () => getSimpleTrie(),
  codeGeneration: () => getCodeTrie(),
  codeFrontend: () => getCodeFrontendTrie(),
  codeBackend: () => getCodeBackendTrie(),
  formalLogic: () => getLogicTrie(),
  technicalTerms: () => getTechnicalTrie(),
  analyticalReasoning: () => getAnalyticalTrie(),
};

/**
 * Inject custom keywords from config into the appropriate tries.
 * Call after resetTries() to ensure tries are rebuilt with customs.
 */
export function injectCustomKeywords(
  entries: { pattern: string; dimension: string; weight?: number }[],
): void {
  for (const entry of entries) {
    const getTrieFn = DIMENSION_TRIE_MAP[entry.dimension];
    if (!getTrieFn) continue; // Unknown dimension — skip silently

    const trie = getTrieFn();
    const keywords = entry.pattern.split('|').map((k) => k.trim()).filter(Boolean);
    const weight = entry.weight ?? 1.0;

    for (const kw of keywords) {
      trie.insert(kw, weight);
    }
  }
}

function getSimpleTrie(): KeywordTrie {
  if (!_simpleTrie) {
    _simpleTrie = new KeywordTrie();
    _simpleTrie.insertAll(SIMPLE_INDICATORS);
  }
  return _simpleTrie;
}

function getCodeTrie(): KeywordTrie {
  if (!_codeTrie) {
    _codeTrie = new KeywordTrie();
    _codeTrie.insertAll(CODE_GENERATION);
  }
  return _codeTrie;
}

function getCodeFrontendTrie(): KeywordTrie {
  if (!_codeFrontendTrie) {
    _codeFrontendTrie = new KeywordTrie();
    _codeFrontendTrie.insertAll(CODE_FRONTEND);
  }
  return _codeFrontendTrie;
}

function getCodeBackendTrie(): KeywordTrie {
  if (!_codeBackendTrie) {
    _codeBackendTrie = new KeywordTrie();
    _codeBackendTrie.insertAll(CODE_BACKEND);
  }
  return _codeBackendTrie;
}

function getLogicTrie(): KeywordTrie {
  if (!_logicTrie) {
    _logicTrie = new KeywordTrie();
    _logicTrie.insertAll(FORMAL_LOGIC);
  }
  return _logicTrie;
}

function getTechnicalTrie(): KeywordTrie {
  if (!_technicalTrie) {
    _technicalTrie = new KeywordTrie();
    _technicalTrie.insertAll(TECHNICAL_TERMS);
  }
  return _technicalTrie;
}

function getAnalyticalTrie(): KeywordTrie {
  if (!_analyticalTrie) {
    _analyticalTrie = new KeywordTrie();
    _analyticalTrie.insertAll(ANALYTICAL_REASONING);
  }
  return _analyticalTrie;
}

// ─── Helper: Extract all text from a CanonicalRequest ─────

export function extractAllText(req: CanonicalRequest): string {
  const parts: string[] = [];

  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push(block.text);
        }
      }
    }
  }

  return parts.join('\n');
}

/**
 * Get only the last user message text (most relevant for scoring intent).
 */
export function extractLastUserText(req: CanonicalRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const msg = req.messages[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n');
      }
    }
  }
  return '';
}

// ─── Dimension Functions ──────────────────────────────────

/**
 * simpleIndicators — detects simple greetings/lookups.
 * Returns negative score (reduces complexity).
 * Range: [-1, 0]
 */
export function scoreSimpleIndicators(req: CanonicalRequest): number {
  const text = extractLastUserText(req);
  if (!text) return 0;

  const trie = getSimpleTrie();
  const matchCount = trie.countMatches(text);

  if (matchCount === 0) return 0;

  // More simple keywords → more negative score
  // Normalize: 1 match = -0.3, 2 = -0.6, 3+ = -1.0
  const raw = Math.min(matchCount / 3, 1.0);
  return -raw;
}

/**
 * codeGeneration — detects code-related tasks (general + frontend + backend combined).
 * Range: [0, 1]
 */
export function scoreCodeGeneration(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const generalCount = getCodeTrie().countMatches(text);
  const frontendCount = getCodeFrontendTrie().countMatches(text);
  const backendCount = getCodeBackendTrie().countMatches(text);
  const totalCount = generalCount + frontendCount + backendCount;

  // Normalize: 0 = 0, 1-2 = 0.3, 3-5 = 0.6, 6+ = 1.0
  if (totalCount === 0) return 0;
  if (totalCount <= 2) return 0.3;
  if (totalCount <= 5) return 0.6;
  return 1.0;
}

/**
 * codeFrontend — frontend-specific keyword density.
 * Range: [0, 1]
 */
export function scoreCodeFrontend(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const matchCount = getCodeFrontendTrie().countMatches(text);

  if (matchCount === 0) return 0;
  if (matchCount <= 1) return 0.3;
  if (matchCount <= 3) return 0.6;
  return 1.0;
}

/**
 * codeBackend — backend/system-level keyword density.
 * Range: [0, 1]
 */
export function scoreCodeBackend(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const matchCount = getCodeBackendTrie().countMatches(text);

  if (matchCount === 0) return 0;
  if (matchCount <= 1) return 0.3;
  if (matchCount <= 3) return 0.6;
  return 1.0;
}

/**
 * Detect code domain: 'frontend' | 'backend' | null.
 * Compares frontend vs backend keyword density to determine the dominant domain.
 */
export function detectCodeDomain(req: CanonicalRequest): 'frontend' | 'backend' | null {
  const text = extractAllText(req);
  if (!text) return null;

  const frontendCount = getCodeFrontendTrie().countMatches(text);
  const backendCount = getCodeBackendTrie().countMatches(text);

  // Need at least some signal
  if (frontendCount === 0 && backendCount === 0) return null;

  // Clear winner (2x or more advantage, or one side is 0)
  if (frontendCount >= 2 && frontendCount > backendCount * 1.5) return 'frontend';
  if (backendCount >= 2 && backendCount > frontendCount * 1.5) return 'backend';

  // Slight lean
  if (frontendCount > backendCount) return 'frontend';
  if (backendCount > frontendCount) return 'backend';

  return null; // tied or ambiguous
}

/**
 * formalLogic — detects math/logic/proof-related content.
 * Range: [0, 1]
 */
export function scoreFormalLogic(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const trie = getLogicTrie();
  const matchCount = trie.countMatches(text);

  if (matchCount === 0) return 0;
  if (matchCount <= 2) return 0.4;
  if (matchCount <= 4) return 0.7;
  return 1.0;
}

/**
 * technicalTerms — measures density of technical vocabulary.
 * Range: [0, 1]
 */
export function scoreTechnicalTerms(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const trie = getTechnicalTrie();
  const matchCount = trie.countMatches(text);

  // Word count for density calculation
  const wordCount = text.split(/\s+/).length;
  const density = matchCount / Math.max(wordCount / 20, 1); // normalize by ~20 words

  return Math.min(density, 1.0);
}

/**
 * analyticalReasoning — detects analysis/comparison/evaluation tasks.
 * Range: [0, 1]
 */
export function scoreAnalyticalReasoning(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const trie = getAnalyticalTrie();
  const matchCount = trie.countMatches(text);

  if (matchCount === 0) return 0;
  if (matchCount <= 1) return 0.3;
  if (matchCount <= 3) return 0.6;
  return 1.0;
}
