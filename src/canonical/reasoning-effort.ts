import type {
  CanonicalReasoningEffort,
  CanonicalReasoningIntent,
  CanonicalThinkingConfig,
  ReasoningSource,
  ReasoningStrategy,
  SourceFormat,
} from './canonical.types';
import type { NodeProtocol } from '../config/gateway.config';

export interface ReasoningFields {
  reasoning_effort?: CanonicalReasoningEffort;
  thinking?: CanonicalThinkingConfig;
  budget_tokens?: number;
  reasoning?: CanonicalReasoningIntent;
}

export interface ReasoningForwarding {
  requested: boolean;
  effort: CanonicalReasoningEffort | null;
  strategy: ReasoningStrategy | null;
  supported: boolean | null;
  budget_tokens: number | null;
  source: ReasoningSource | null;
  reason: string | null;
}

const OPENAI_EFFORTS = new Set(['minimal', 'low', 'medium', 'high']);

export function normalizeReasoningFromBody(
  sourceFormat: SourceFormat,
  body: Record<string, unknown>,
): ReasoningFields {
  const intent = extractReasoningIntent(sourceFormat, body);
  if (!intent) return {};

  return {
    reasoning_effort: intent.effort,
    thinking: intent.thinking,
    budget_tokens: intent.budget_tokens,
    reasoning: intent,
  };
}

export function toOpenAiChatReasoning(
  intent?: CanonicalReasoningIntent,
): Record<string, unknown> {
  if (!intent?.requested) return {};

  if (intent.source === 'chat_completions.reasoning_effort') {
    const effort = normalizeEffort(intent.raw) || intent.effort;
    return effort && effort !== 'unknown' ? { reasoning_effort: effort } : {};
  }

  if (intent.source === 'gemini.thinking_config' && intent.thinking?.raw) {
    return { thinking_config: clone(intent.thinking.raw) };
  }

  if (intent.effort && intent.effort !== 'unknown') {
    return { reasoning_effort: intent.effort };
  }

  return {};
}

export function toOpenAiResponsesReasoning(
  intent?: CanonicalReasoningIntent,
): Record<string, unknown> | undefined {
  if (!intent?.requested) return undefined;

  if (intent.source === 'responses.reasoning') {
    return clone(intent.raw) as Record<string, unknown>;
  }

  if (intent.effort && intent.effort !== 'unknown') {
    return { effort: intent.effort };
  }

  return undefined;
}

export function toAnthropicThinking(
  intent?: CanonicalReasoningIntent,
  maxTokens?: number,
): Record<string, unknown> | undefined {
  if (!intent?.requested) return undefined;

  if (intent.source === 'messages.thinking' && intent.thinking?.raw) {
    return clone(intent.thinking.raw) as Record<string, unknown>;
  }

  const budget = intent.budget_tokens || budgetTokensForEffort(intent.effort);
  if (!budget) return undefined;
  if (maxTokens && maxTokens <= budget) return undefined;

  return {
    type: 'enabled',
    budget_tokens: budget,
  };
}

export function resolveReasoningForwarding(
  intent: CanonicalReasoningIntent | undefined,
  sourceFormat: SourceFormat,
  targetProtocol: NodeProtocol | undefined,
  declaredSupport: boolean | null | undefined,
): ReasoningForwarding {
  if (!intent?.requested) {
    return {
      requested: false,
      effort: null,
      strategy: null,
      supported: null,
      budget_tokens: null,
      source: null,
      reason: null,
    };
  }

  const base = {
    requested: true,
    effort: intent.effort || null,
    budget_tokens: intent.budget_tokens || null,
    source: intent.source,
  };

  if (!targetProtocol) {
    return {
      ...base,
      strategy: 'none',
      supported: null,
      reason: 'target protocol is unavailable',
    };
  }

  if (declaredSupport === false) {
    return {
      ...base,
      strategy: 'unsupported',
      supported: false,
      reason: 'target declares supports_reasoning=false',
    };
  }

  const passthrough =
    (sourceFormat === 'chat_completions' &&
      targetProtocol === 'chat_completions' &&
      (intent.source === 'chat_completions.reasoning_effort' ||
        intent.source === 'gemini.thinking_config')) ||
    (sourceFormat === 'responses' && targetProtocol === 'responses') ||
    (sourceFormat === 'messages' && targetProtocol === 'messages');

  if (passthrough) {
    return {
      ...base,
      strategy: 'passthrough',
      supported: declaredSupport === null || declaredSupport === undefined ? true : declaredSupport,
      reason: null,
    };
  }

  if (targetProtocol === 'chat_completions') {
    const canMap =
      (intent.effort && intent.effort !== 'unknown') ||
      intent.source === 'gemini.thinking_config';
    return {
      ...base,
      strategy: canMap ? 'native' : 'downgraded',
      supported: canMap,
      reason: canMap
        ? null
        : 'chat_completions reasoning requires reasoning_effort or native thinking_config passthrough',
    };
  }

  if (targetProtocol === 'responses') {
    const canMap = Boolean(intent.effort && intent.effort !== 'unknown');
    return {
      ...base,
      strategy: canMap ? 'native' : 'downgraded',
      supported: canMap,
      reason: canMap
        ? null
        : 'responses reasoning requires an effort level',
    };
  }

  if (targetProtocol === 'messages') {
    const canMap = Boolean(
      intent.budget_tokens ||
        intent.source === 'messages.thinking' ||
        (intent.effort && intent.effort !== 'unknown'),
    );
    return {
      ...base,
      strategy: canMap ? 'native' : 'downgraded',
      supported: canMap,
      reason: canMap
        ? null
        : 'messages thinking requires budget_tokens or a mappable effort level',
    };
  }

  if (targetProtocol === 'gemini') {
    const canMap = Boolean(
      intent.budget_tokens ||
        intent.source === 'gemini.thinking_config' ||
        (intent.effort && intent.effort !== 'unknown'),
    );
    return {
      ...base,
      strategy: canMap ? 'native' : 'downgraded',
      supported: canMap,
      reason: canMap
        ? null
        : 'gemini thinking requires budget_tokens or a native thinking_config',
    };
  }

  return {
    ...base,
    strategy: 'downgraded',
    supported: false,
    reason: `target protocol ${targetProtocol} has no reasoning mapping`,
  };
}

export function requestRequiresReasoning(
  intent?: CanonicalReasoningIntent,
): boolean {
  return Boolean(intent?.requested);
}

export function budgetTokensForEffort(
  effort?: CanonicalReasoningEffort,
): number | undefined {
  switch (effort) {
    case 'minimal':
    case 'low':
      return 1024;
    case 'medium':
      return 2048;
    case 'high':
      return 3072;
    default:
      return undefined;
  }
}

function extractReasoningIntent(
  sourceFormat: SourceFormat,
  body: Record<string, unknown>,
): CanonicalReasoningIntent | undefined {
  if (sourceFormat === 'chat_completions') {
    return (
      normalizeOpenAiReasoningEffort(body.reasoning_effort, 'chat_completions.reasoning_effort') ||
      normalizeGeminiThinkingConfig(body.thinking_config) ||
      normalizeResponsesReasoning(body.reasoning, 'responses.reasoning') ||
      normalizeAnthropicThinking(body.thinking)
    );
  }

  if (sourceFormat === 'responses') {
    return (
      normalizeResponsesReasoning(body.reasoning, 'responses.reasoning') ||
      normalizeOpenAiReasoningEffort(body.reasoning_effort, 'responses.reasoning_effort') ||
      normalizeGeminiThinkingConfig(body.thinking_config) ||
      normalizeAnthropicThinking(body.thinking)
    );
  }

  if (sourceFormat === 'messages') {
    return (
      normalizeAnthropicThinking(body.thinking) ||
      normalizeOpenAiReasoningEffort(body.reasoning_effort, 'chat_completions.reasoning_effort') ||
      normalizeResponsesReasoning(body.reasoning, 'responses.reasoning') ||
      normalizeGeminiThinkingConfig(body.thinking_config)
    );
  }

  return undefined;
}

function normalizeOpenAiReasoningEffort(
  value: unknown,
  source: ReasoningSource,
): CanonicalReasoningIntent | undefined {
  const effort = normalizeEffort(value);
  if (!effort) return undefined;
  return {
    requested: true,
    source,
    effort,
    raw: value,
  };
}

function normalizeResponsesReasoning(
  value: unknown,
  source: ReasoningSource,
): CanonicalReasoningIntent | undefined {
  const reasoning = asRecord(value);
  if (!reasoning) return undefined;
  const effort = normalizeEffort(reasoning.effort) || 'unknown';
  const budget = numberOrUndefined(reasoning.budget_tokens);
  const thinking: CanonicalThinkingConfig | undefined = budget
    ? {
        source,
        raw: clone(reasoning),
        type: stringOrUndefined(reasoning.type),
        budget_tokens: budget,
      }
    : undefined;
  return {
    requested: true,
    source,
    effort,
    budget_tokens: budget,
    thinking,
    raw: clone(reasoning),
  };
}

function normalizeAnthropicThinking(
  value: unknown,
): CanonicalReasoningIntent | undefined {
  const thinking = asRecord(value);
  if (!thinking) return undefined;
  const budget = numberOrUndefined(thinking.budget_tokens);
  const effort = normalizeEffort(thinking.effort) || (budget ? 'unknown' : undefined);
  const enabled =
    thinking.type === 'enabled' ||
    budget !== undefined ||
    thinking.enabled === true;
  if (!enabled && !effort) return undefined;

  const config: CanonicalThinkingConfig = {
    source: 'messages.thinking',
    raw: clone(thinking),
    type: stringOrUndefined(thinking.type),
    budget_tokens: budget,
  };

  return {
    requested: true,
    source: 'messages.thinking',
    effort,
    budget_tokens: budget,
    thinking: config,
    raw: clone(thinking),
  };
}

function normalizeGeminiThinkingConfig(
  value: unknown,
): CanonicalReasoningIntent | undefined {
  const thinking = asRecord(value);
  if (!thinking) return undefined;
  const budget =
    numberOrUndefined(thinking.budget_tokens) ??
    numberOrUndefined(thinking.thinking_budget_tokens) ??
    numberOrUndefined(thinking.thinking_budget);
  const effort = normalizeEffort(thinking.effort) || (budget ? 'unknown' : undefined);
  const includeThoughts = booleanOrUndefined(thinking.include_thoughts);
  const requested =
    effort !== undefined ||
    budget !== undefined ||
    includeThoughts === true ||
    Object.keys(thinking).length > 0;
  if (!requested) return undefined;

  const config: CanonicalThinkingConfig = {
    source: 'gemini.thinking_config',
    raw: clone(thinking),
    type: stringOrUndefined(thinking.type),
    budget_tokens: budget,
    include_thoughts: includeThoughts,
  };

  return {
    requested: true,
    source: 'gemini.thinking_config',
    effort,
    budget_tokens: budget,
    thinking: config,
    raw: clone(thinking),
  };
}

function normalizeEffort(value: unknown): CanonicalReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!OPENAI_EFFORTS.has(normalized)) return 'unknown';
  return normalized as CanonicalReasoningEffort;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
