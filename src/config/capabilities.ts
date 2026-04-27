// ===================================================================
// Capability Registry — 10 capability tag definitions
// ===================================================================
// Pure data file defining the capability abstraction layer.
// Maps user-understandable capability tags to internal tier affinity scores.
// The 14-dimension scoring engine is NOT modified — this is an overlay.
// ===================================================================

export interface CapabilityDefinition {
  /** Unique identifier used in config and API */
  id: string;
  /** Display labels */
  label: { en: string; cn: string };
  /** Lucide icon name */
  icon: string;
  /** Description of what this capability covers */
  description: { en: string; cn: string };
  /** Tier affinity scores (0-1) — how well this capability maps to each tier */
  tierAffinity: {
    simple: number;
    standard: number;
    complex: number;
    reasoning: number;
  };
}

// ── Capability Definitions ──────────────────────────────────────────

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  {
    id: 'coding',
    label: { en: 'Coding', cn: '代码编写' },
    icon: 'Code2',
    description: {
      en: 'General programming, code generation, debugging',
      cn: '通用编程、代码生成、调试',
    },
    tierAffinity: { simple: 0, standard: 0.6, complex: 1.0, reasoning: 0.7 },
  },
  {
    id: 'coding_frontend',
    label: { en: 'Frontend Dev', cn: '前端开发' },
    icon: 'Layout',
    description: {
      en: 'React/Vue/CSS/UI development',
      cn: 'React/Vue/CSS/UI 开发',
    },
    tierAffinity: { simple: 0, standard: 0.5, complex: 0.8, reasoning: 0.3 },
  },
  {
    id: 'coding_backend',
    label: { en: 'Backend Dev', cn: '后端开发' },
    icon: 'Server',
    description: {
      en: 'API, database, infrastructure',
      cn: 'API、数据库、基础设施',
    },
    tierAffinity: { simple: 0, standard: 0.5, complex: 1.0, reasoning: 0.7 },
  },
  {
    id: 'reasoning',
    label: { en: 'Reasoning & Math', cn: '推理与数学' },
    icon: 'Brain',
    description: {
      en: 'Logic, proofs, mathematical derivation',
      cn: '逻辑、证明、数学推导',
    },
    tierAffinity: { simple: 0, standard: 0.2, complex: 0.7, reasoning: 1.0 },
  },
  {
    id: 'analysis',
    label: { en: 'Analysis', cn: '分析评估' },
    icon: 'BarChart3',
    description: {
      en: 'Comparative analysis, trade-offs, architecture design',
      cn: '比较分析、权衡、架构设计',
    },
    tierAffinity: { simple: 0, standard: 0.4, complex: 0.8, reasoning: 0.9 },
  },
  {
    id: 'creative',
    label: { en: 'Creative Writing', cn: '创意写作' },
    icon: 'Sparkles',
    description: {
      en: 'Articles, stories, marketing copy',
      cn: '文章、故事、营销文案',
    },
    tierAffinity: { simple: 0.2, standard: 0.7, complex: 0.5, reasoning: 0.2 },
  },
  {
    id: 'long_context',
    label: { en: 'Long Context', cn: '长文本' },
    icon: 'FileText',
    description: {
      en: 'Processing or generating long documents',
      cn: '处理或生成长文档',
    },
    tierAffinity: { simple: 0, standard: 0.5, complex: 0.8, reasoning: 0.6 },
  },
  {
    id: 'tool_use',
    label: { en: 'Tool Use', cn: '工具调用' },
    icon: 'Wrench',
    description: {
      en: 'Function calling, multi-tool orchestration',
      cn: '函数调用、多工具编排',
    },
    tierAffinity: { simple: 0, standard: 0.7, complex: 0.8, reasoning: 0.5 },
  },
  {
    id: 'fast',
    label: { en: 'Fast & Cheap', cn: '快速低成本' },
    icon: 'Zap',
    description: {
      en: 'Latency-sensitive, simple queries',
      cn: '延迟敏感、简单查询',
    },
    tierAffinity: { simple: 1.0, standard: 0.3, complex: 0, reasoning: 0 },
  },
  {
    id: 'multilingual',
    label: { en: 'Multilingual', cn: '多语言' },
    icon: 'Globe',
    description: {
      en: 'Non-English or multilingual tasks',
      cn: '非英语或多语言任务',
    },
    tierAffinity: { simple: 0.3, standard: 0.6, complex: 0.5, reasoning: 0.3 },
  },
];

// ── Quick lookup map ────────────────────────────────────────────────

export const CAPABILITY_MAP: Record<string, CapabilityDefinition> =
  Object.fromEntries(CAPABILITY_REGISTRY.map((c) => [c.id, c]));

export const VALID_CAPABILITY_IDS: string[] = CAPABILITY_REGISTRY.map(
  (c) => c.id,
);

// ── Tag → Capability Inference Mapping ──────────────────────────────
// Maps common free-text tags to structured capability IDs.
// Used for backward compatibility when nodes only have `tags` defined.

export const TAG_TO_CAPABILITY_MAP: Record<string, string> = {
  // coding
  code: 'coding',
  coding: 'coding',
  programming: 'coding',
  // frontend
  frontend: 'coding_frontend',
  'frontend-dev': 'coding_frontend',
  ui: 'coding_frontend',
  react: 'coding_frontend',
  vue: 'coding_frontend',
  css: 'coding_frontend',
  // backend
  backend: 'coding_backend',
  'backend-dev': 'coding_backend',
  api: 'coding_backend',
  infrastructure: 'coding_backend',
  // reasoning
  reasoning: 'reasoning',
  math: 'reasoning',
  logic: 'reasoning',
  // analysis
  analysis: 'analysis',
  analytical: 'analysis',
  // creative
  creative: 'creative',
  writing: 'creative',
  // long context
  'long-context': 'long_context',
  'long_context': 'long_context',
  // tool use
  tool: 'tool_use',
  tools: 'tool_use',
  'tool-use': 'tool_use',
  'tool_use': 'tool_use',
  'function-calling': 'tool_use',
  // fast
  fast: 'fast',
  cheap: 'fast',
  // multilingual
  multilingual: 'multilingual',
  'multi-language': 'multilingual',
};
