import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalResponse,
} from '../../src/canonical/canonical.types';
import type {
  GatewayPlugin,
  HookContext,
  HookResult,
  PostUpstreamData,
  PreRequestData,
} from '../../src/plugins/types';
import { canonicalMessageText } from '../_shared/safety';

interface GuardrailsConfig {
  enabled?: boolean;
  mode?: 'audit' | 'block';
  input_patterns?: string[];
  output_patterns?: string[];
  blocked_message?: string;
  include_prompt_in_logs?: boolean;
}

interface GuardrailFinding {
  direction: 'input' | 'output';
  pattern_index: number;
}

export default class GuardrailsPlugin implements GatewayPlugin {
  meta = {
    name: 'guardrails',
    version: '0.4.0',
    priority: 20,
  };

  private enabled = false;
  private mode: 'audit' | 'block' = 'audit';
  private inputPatterns: RegExp[] = [];
  private outputPatterns: RegExp[] = [];
  private blockedMessage =
    'This request was blocked by the configured SiftGate guardrails policy.';
  private includePromptInLogs = false;

  onLoad(config: Readonly<Record<string, unknown>>): void {
    const cfg = config as GuardrailsConfig;
    this.enabled = cfg.enabled === true;
    this.mode = cfg.mode === 'block' ? 'block' : 'audit';
    this.inputPatterns = compilePatterns(cfg.input_patterns);
    this.outputPatterns = compilePatterns(cfg.output_patterns);
    this.blockedMessage =
      typeof cfg.blocked_message === 'string' && cfg.blocked_message.length > 0
        ? cfg.blocked_message
        : this.blockedMessage;
    this.includePromptInLogs = cfg.include_prompt_in_logs === true;
  }

  hooks = {
    preRequest: (
      ctx: HookContext<PreRequestData>,
    ): HookResult<PreRequestData> => {
      if (!this.enabled || this.inputPatterns.length === 0) {
        return { unchanged: true };
      }

      const findings = scanMessages(ctx.data.request.messages, this.inputPatterns, 'input');
      if (findings.length === 0) return { unchanged: true };
      this.recordFindings(ctx, findings);

      if (this.mode !== 'block') return { unchanged: true };
      return { shortCircuit: this.blockedResponse() };
    },

    postUpstream: (
      ctx: HookContext<PostUpstreamData>,
    ): HookResult<PostUpstreamData> => {
      if (!this.enabled || this.outputPatterns.length === 0) {
        return { unchanged: true };
      }

      const findings = scanBlocks(
        ctx.data.response.content,
        this.outputPatterns,
        'output',
      );
      if (findings.length === 0) return { unchanged: true };
      this.recordFindings(ctx, findings);

      if (this.mode !== 'block') return { unchanged: true };
      return {
        response: {
          ...ctx.data.response,
          content: [{ type: 'text', text: this.blockedMessage }],
          stop_reason: 'end_turn',
          model: ctx.data.response.model || 'guardrails',
        },
      };
    },
  };

  private blockedResponse(): CanonicalResponse {
    return {
      id: `guardrails-${Date.now()}`,
      content: [{ type: 'text', text: this.blockedMessage }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'guardrails',
      routing: {
        tier: 'direct',
        node: 'guardrails',
        latency_ms: 0,
        score: 0,
        is_fallback: false,
      },
    };
  }

  private recordFindings(
    ctx: HookContext<PreRequestData | PostUpstreamData>,
    findings: GuardrailFinding[],
  ): void {
    const existing = ctx.store.get('guardrails.findings');
    const combined = Array.isArray(existing) ? [...existing, ...findings] : findings;
    ctx.store.set('guardrails.findings', combined);
    const detail = this.includePromptInLogs
      ? ` findings=${JSON.stringify(findings)}`
      : ` findings=${findings.length}`;
    ctx.log.warn(`guardrails matched${detail}`);
  }
}

function scanMessages(
  messages: CanonicalMessage[],
  patterns: RegExp[],
  direction: 'input' | 'output',
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  for (const message of messages) {
    const text = canonicalMessageText(message);
    findings.push(...scanText(text, patterns, direction));
  }
  return findings;
}

function scanBlocks(
  blocks: CanonicalContentBlock[],
  patterns: RegExp[],
  direction: 'input' | 'output',
): GuardrailFinding[] {
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n');
  return scanText(text, patterns, direction);
}

function scanText(
  text: string,
  patterns: RegExp[],
  direction: 'input' | 'output',
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  patterns.forEach((pattern, patternIndex) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      findings.push({ direction, pattern_index: patternIndex });
    }
  });
  return findings;
}

function compilePatterns(values: unknown): RegExp[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => {
      try {
        return new RegExp(value, 'i');
      } catch {
        return null;
      }
    })
    .filter((value): value is RegExp => value !== null);
}
