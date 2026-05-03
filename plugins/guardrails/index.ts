import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../../src/canonical/canonical.types';
import type {
  GatewayPlugin,
  HookContext,
  HookResult,
  PostUpstreamData,
  PreRequestData,
  StreamEventData,
} from '../../src/plugins/types';

type GuardrailDirection = 'input' | 'output' | 'both';
type GuardrailAction = 'audit' | 'block' | 'redact';
type GuardrailSeverity = 'low' | 'medium' | 'high';
type GuardrailKind =
  | 'policy'
  | 'pii'
  | 'prompt_injection'
  | 'schema';
type PiiEntity =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'api_key';

interface GuardrailsConfig {
  enabled?: boolean;
  mode?: 'audit' | 'block';
  input_patterns?: string[];
  output_patterns?: string[];
  blocked_message?: string;
  include_prompt_in_logs?: boolean;
  rules?: PolicyRuleConfig[];
  pii?: PiiConfig;
  prompt_injection?: PromptInjectionConfig;
  schema_validation?: SchemaValidationConfig;
}

interface PolicyRuleConfig {
  name?: string;
  direction?: GuardrailDirection;
  pattern?: string;
  action?: GuardrailAction;
  redaction?: string;
  severity?: GuardrailSeverity;
}

interface PiiConfig {
  enabled?: boolean;
  entities?: PiiEntity[];
  direction?: GuardrailDirection;
  action?: GuardrailAction;
  redaction?: string;
}

interface PromptInjectionConfig {
  enabled?: boolean;
  patterns?: string[];
  action?: GuardrailAction;
  redaction?: string;
  severity?: GuardrailSeverity;
}

interface SchemaValidationConfig {
  input?: SchemaRuleConfig;
  output?: SchemaRuleConfig;
}

interface SchemaRuleConfig {
  enabled?: boolean;
  action?: Exclude<GuardrailAction, 'redact'>;
  schema?: Record<string, unknown>;
  parse_json?: boolean;
}

interface CompiledTextRule {
  name: string;
  kind: Exclude<GuardrailKind, 'schema'>;
  direction: GuardrailDirection;
  action: GuardrailAction;
  severity: GuardrailSeverity;
  pattern: RegExp;
  redaction: string;
  category?: string;
  validateMatch?: (match: string) => boolean;
}

interface GuardrailFinding {
  direction: 'input' | 'output';
  kind: GuardrailKind;
  rule: string;
  action: GuardrailAction;
  severity: GuardrailSeverity;
  path: string;
  category?: string;
  message?: string;
}

interface TextPolicyResult {
  text: string;
  findings: GuardrailFinding[];
  modified: boolean;
}

const DEFAULT_REDACTION = '[REDACTED]';
const DEFAULT_BLOCKED_MESSAGE =
  'This request was blocked by the configured SiftGate guardrails policy.';
const DEFAULT_PII_ORDER: PiiEntity[] = [
  'api_key',
  'credit_card',
  'ssn',
  'email',
  'phone',
];
const STORE_FINDINGS_KEY = 'guardrails.findings';
const STORE_STREAM_BLOCKED_KEY = 'guardrails.stream_blocked';

const PROMPT_INJECTION_PATTERNS = [
  'ignore (all )?(previous|prior|above) (instructions|rules|messages)',
  'disregard (all )?(previous|prior|above) (instructions|rules|messages)',
  'reveal (the )?(system|developer|hidden) (prompt|message|instructions)',
  'print (the )?(system|developer|hidden) (prompt|message|instructions)',
  'bypass (the )?(safety|policy|guardrails|rules)',
  'jailbreak',
  'developer mode',
  '\\bDAN\\b',
];

export default class GuardrailsPlugin implements GatewayPlugin {
  meta = {
    name: 'guardrails',
    version: '0.7.0',
    priority: 20,
  };

  private enabled = false;
  private mode: 'audit' | 'block' = 'audit';
  private blockedMessage = DEFAULT_BLOCKED_MESSAGE;
  private includePromptInLogs = false;
  private textRules: CompiledTextRule[] = [];
  private inputSchema?: SchemaRuleConfig;
  private outputSchema?: SchemaRuleConfig;

  onLoad(config: Readonly<Record<string, unknown>>): void {
    const cfg = config as GuardrailsConfig;
    this.enabled = cfg.enabled === true;
    this.mode = cfg.mode === 'block' ? 'block' : 'audit';
    this.blockedMessage =
      typeof cfg.blocked_message === 'string' && cfg.blocked_message.length > 0
        ? cfg.blocked_message
        : DEFAULT_BLOCKED_MESSAGE;
    this.includePromptInLogs = cfg.include_prompt_in_logs === true;
    this.textRules = [
      ...this.compileLegacyPatternRules(cfg),
      ...this.compilePolicyRules(cfg.rules),
      ...this.compilePiiRules(cfg.pii),
      ...this.compilePromptInjectionRules(cfg.prompt_injection),
    ];
    this.inputSchema = normalizeSchemaRule(cfg.schema_validation?.input);
    this.outputSchema = normalizeSchemaRule(cfg.schema_validation?.output);
  }

  hooks = {
    preRequest: (
      ctx: HookContext<PreRequestData>,
    ): HookResult<PreRequestData> => {
      if (!this.enabled) return { unchanged: true };

      const textRules = this.rulesForDirection('input');
      const requestResult =
        textRules.length > 0
          ? applyRulesToMessages(ctx.data.request.messages, textRules, 'input')
          : {
              messages: ctx.data.request.messages,
              findings: [] as GuardrailFinding[],
              modified: false,
            };
      const schemaFindings = this.validateInputSchema(ctx.data.request);
      const findings = [...requestResult.findings, ...schemaFindings];
      if (findings.length === 0) return { unchanged: true };

      this.recordFindings(ctx, findings);
      if (hasBlockingFinding(findings)) {
        return { shortCircuit: this.blockedResponse() };
      }

      if (requestResult.modified) {
        return {
          request: {
            ...ctx.data.request,
            messages: requestResult.messages,
          },
        };
      }
      return { unchanged: true };
    },

    postUpstream: (
      ctx: HookContext<PostUpstreamData>,
    ): HookResult<PostUpstreamData> => {
      if (!this.enabled) return { unchanged: true };

      const textRules = this.rulesForDirection('output');
      const responseResult =
        textRules.length > 0
          ? applyRulesToBlocks(ctx.data.response.content, textRules, 'output')
          : {
              blocks: ctx.data.response.content,
              findings: [] as GuardrailFinding[],
              modified: false,
            };
      const schemaFindings = this.validateOutputSchema(ctx.data.response);
      const findings = [...responseResult.findings, ...schemaFindings];
      if (findings.length === 0) return { unchanged: true };

      this.recordFindings(ctx, findings);
      if (hasBlockingFinding(findings)) {
        return {
          response: this.replacementResponse(ctx.data.response),
        };
      }

      if (responseResult.modified) {
        return {
          response: {
            ...ctx.data.response,
            content: responseResult.blocks,
          },
        };
      }
      return { unchanged: true };
    },

    streamEvent: (
      ctx: HookContext<StreamEventData>,
    ): HookResult<StreamEventData> => {
      if (!this.enabled) return { unchanged: true };
      if (ctx.store.get(STORE_STREAM_BLOCKED_KEY) === true) {
        return { drop: true };
      }
      const event = ctx.data.event;
      if (event.type !== 'delta' || event.content.type !== 'text') {
        return { unchanged: true };
      }

      const result = applyRulesToText(
        event.content.text,
        this.rulesForDirection('output'),
        'output',
        'stream.delta',
      );
      if (result.findings.length === 0) return { unchanged: true };

      this.recordFindings(ctx, result.findings);
      if (hasBlockingFinding(result.findings)) {
        ctx.store.set(STORE_STREAM_BLOCKED_KEY, true);
        return {
          event: {
            ...event,
            content: { type: 'text', text: this.blockedMessage },
          } satisfies CanonicalStreamEvent,
        };
      }

      if (result.modified) {
        return {
          event: {
            ...event,
            content: { type: 'text', text: result.text },
          } satisfies CanonicalStreamEvent,
        };
      }
      return { unchanged: true };
    },
  };

  private compileLegacyPatternRules(cfg: GuardrailsConfig): CompiledTextRule[] {
    const defaultAction: GuardrailAction =
      this.mode === 'block' ? 'block' : 'audit';
    return [
      ...compilePatternList(cfg.input_patterns, {
        namePrefix: 'legacy_input',
        direction: 'input',
        kind: 'policy',
        action: defaultAction,
        severity: 'medium',
        redaction: DEFAULT_REDACTION,
      }),
      ...compilePatternList(cfg.output_patterns, {
        namePrefix: 'legacy_output',
        direction: 'output',
        kind: 'policy',
        action: defaultAction,
        severity: 'medium',
        redaction: DEFAULT_REDACTION,
      }),
    ];
  }

  private compilePolicyRules(values: unknown): CompiledTextRule[] {
    if (!Array.isArray(values)) return [];
    const rules: CompiledTextRule[] = [];
    values.forEach((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const cfg = value as PolicyRuleConfig;
      if (typeof cfg.pattern !== 'string' || cfg.pattern.length === 0) return;
      const pattern = compileRegex(cfg.pattern);
      if (!pattern) return;
      rules.push({
        name: safeName(cfg.name, `policy_${index}`),
        kind: 'policy',
        direction: normalizeDirection(cfg.direction),
        action: normalizeAction(cfg.action, this.mode === 'block' ? 'block' : 'audit'),
        severity: normalizeSeverity(cfg.severity, 'medium'),
        pattern,
        redaction: normalizeString(cfg.redaction, DEFAULT_REDACTION),
      });
    });
    return rules;
  }

  private compilePiiRules(cfg: PiiConfig | undefined): CompiledTextRule[] {
    if (cfg?.enabled !== true) return [];
    const action = normalizeAction(cfg.action, 'audit');
    const redaction = normalizeString(cfg.redaction, DEFAULT_REDACTION);
    const selected = new Set<PiiEntity>(
      Array.isArray(cfg.entities) && cfg.entities.length > 0
        ? cfg.entities.filter(isPiiEntity)
        : DEFAULT_PII_ORDER,
    );
    const direction = normalizeDirection(cfg.direction);
    const builtins: Record<PiiEntity, Omit<CompiledTextRule, 'direction' | 'action' | 'redaction'>> = {
      email: {
        name: 'pii.email',
        kind: 'pii',
        severity: 'medium',
        category: 'email',
        pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      },
      phone: {
        name: 'pii.phone',
        kind: 'pii',
        severity: 'low',
        category: 'phone',
        pattern: /\b(?:\+?\d[\d .()-]{7,}\d)\b/g,
      },
      ssn: {
        name: 'pii.ssn',
        kind: 'pii',
        severity: 'high',
        category: 'ssn',
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
      },
      credit_card: {
        name: 'pii.credit_card',
        kind: 'pii',
        severity: 'high',
        category: 'credit_card',
        pattern: /\b(?:\d[ -]*?){13,19}\b/g,
        validateMatch: looksLikeCreditCard,
      },
      api_key: {
        name: 'pii.api_key',
        kind: 'pii',
        severity: 'high',
        category: 'api_key',
        pattern: /\b(?:sk|gw_sk|xoxb|ghp|AIza)[A-Za-z0-9._~+/=-]{8,}\b/g,
      },
    };
    return DEFAULT_PII_ORDER.filter((entity) => selected.has(entity)).map((entity) => ({
      ...builtins[entity],
      direction,
      action,
      redaction,
    }));
  }

  private compilePromptInjectionRules(
    cfg: PromptInjectionConfig | undefined,
  ): CompiledTextRule[] {
    if (cfg?.enabled !== true) return [];
    const action = normalizeAction(cfg.action, 'audit');
    const redaction = normalizeString(cfg.redaction, '[filtered instruction]');
    const patterns =
      Array.isArray(cfg.patterns) && cfg.patterns.length > 0
        ? cfg.patterns
        : PROMPT_INJECTION_PATTERNS;
    return compilePatternList(patterns, {
      namePrefix: 'prompt_injection',
      direction: 'input',
      kind: 'prompt_injection',
      action,
      severity: normalizeSeverity(cfg.severity, 'high'),
      redaction,
      category: 'prompt_injection',
    });
  }

  private rulesForDirection(direction: 'input' | 'output'): CompiledTextRule[] {
    return this.textRules.filter(
      (rule) => rule.direction === direction || rule.direction === 'both',
    );
  }

  private validateInputSchema(request: CanonicalRequest): GuardrailFinding[] {
    if (!this.inputSchema?.enabled || !this.inputSchema.schema) return [];
    const errors = validateJsonSchemaLite(requestToSchemaDocument(request), this.inputSchema.schema);
    return errors.map((message) => ({
      direction: 'input',
      kind: 'schema',
      rule: 'schema.input',
      action: this.inputSchema?.action || 'audit',
      severity: 'high',
      path: 'request',
      category: 'schema_validation',
      message,
    }));
  }

  private validateOutputSchema(response: CanonicalResponse): GuardrailFinding[] {
    if (!this.outputSchema?.enabled || !this.outputSchema.schema) return [];
    let value: unknown;
    if (this.outputSchema.parse_json !== false) {
      const text = responseText(response);
      try {
        value = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        return [{
          direction: 'output',
          kind: 'schema',
          rule: 'schema.output',
          action: this.outputSchema.action || 'audit',
          severity: 'high',
          path: 'response.content',
          category: 'schema_validation',
          message: 'response content is not valid JSON',
        }];
      }
    } else {
      value = responseToSchemaDocument(response);
    }

    const errors = validateJsonSchemaLite(value, this.outputSchema.schema);
    return errors.map((message) => ({
      direction: 'output',
      kind: 'schema',
      rule: 'schema.output',
      action: this.outputSchema?.action || 'audit',
      severity: 'high',
      path: 'response',
      category: 'schema_validation',
      message,
    }));
  }

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

  private replacementResponse(response: CanonicalResponse): CanonicalResponse {
    return {
      ...response,
      content: [{ type: 'text', text: this.blockedMessage }],
      stop_reason: 'end_turn',
      model: response.model || 'guardrails',
    };
  }

  private recordFindings(
    ctx: HookContext<PreRequestData | PostUpstreamData | StreamEventData>,
    findings: GuardrailFinding[],
  ): void {
    const existing = ctx.store.get(STORE_FINDINGS_KEY);
    const combined = Array.isArray(existing) ? [...existing, ...findings] : findings;
    ctx.store.set(STORE_FINDINGS_KEY, combined);

    const categories = Array.from(
      new Set(findings.map((finding) => finding.category || finding.rule)),
    ).join(',');
    const detail = this.includePromptInLogs
      ? ` findings=${JSON.stringify(findings)}`
      : ` findings=${findings.length}`;
    ctx.log.warn(`guardrails matched${detail} categories=${categories}`);
  }
}

function applyRulesToMessages(
  messages: CanonicalMessage[],
  rules: CompiledTextRule[],
  direction: 'input' | 'output',
): {
  messages: CanonicalMessage[];
  findings: GuardrailFinding[];
  modified: boolean;
} {
  const findings: GuardrailFinding[] = [];
  let modified = false;
  const mapped = messages.map((message, messageIndex) => {
    if (typeof message.content === 'string') {
      const result = applyRulesToText(
        message.content,
        rules,
        direction,
        `messages[${messageIndex}].content`,
      );
      findings.push(...result.findings);
      if (!result.modified) return message;
      modified = true;
      return { ...message, content: result.text };
    }

    const blocks = message.content.map((block, blockIndex): CanonicalContentBlock => {
      if (block.type !== 'text') return block;
      const result = applyRulesToText(
        block.text,
        rules,
        direction,
        `messages[${messageIndex}].content[${blockIndex}]`,
      );
      findings.push(...result.findings);
      if (!result.modified) return block;
      modified = true;
      return { ...block, text: result.text };
    });
    return modified ? { ...message, content: blocks } : message;
  });
  return { messages: mapped, findings, modified };
}

function applyRulesToBlocks(
  blocks: CanonicalContentBlock[],
  rules: CompiledTextRule[],
  direction: 'input' | 'output',
): {
  blocks: CanonicalContentBlock[];
  findings: GuardrailFinding[];
  modified: boolean;
} {
  const findings: GuardrailFinding[] = [];
  let modified = false;
  const mapped = blocks.map((block, blockIndex): CanonicalContentBlock => {
    if (block.type !== 'text') return block;
    const result = applyRulesToText(
      block.text,
      rules,
      direction,
      `response.content[${blockIndex}]`,
    );
    findings.push(...result.findings);
    if (!result.modified) return block;
    modified = true;
    return { ...block, text: result.text };
  });
  return { blocks: mapped, findings, modified };
}

function applyRulesToText(
  text: string,
  rules: CompiledTextRule[],
  direction: 'input' | 'output',
  path: string,
): TextPolicyResult {
  let output = text;
  const findings: GuardrailFinding[] = [];
  let modified = false;

  for (const rule of rules) {
    const matches = matchingRule(rule, output);
    if (!matches) continue;
    findings.push({
      direction,
      kind: rule.kind,
      rule: rule.name,
      action: rule.action,
      severity: rule.severity,
      path,
      category: rule.category,
    });

    if (rule.action === 'redact') {
      const redacted = redactWithRule(output, rule);
      if (redacted !== output) {
        output = redacted;
        modified = true;
      }
    }
  }

  return { text: output, findings, modified };
}

function matchingRule(rule: CompiledTextRule, text: string): boolean {
  rule.pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = rule.pattern.exec(text)) !== null) {
    if (!rule.validateMatch || rule.validateMatch(match[0])) {
      return true;
    }
    if (match[0].length === 0 && rule.pattern.global) {
      rule.pattern.lastIndex += 1;
    }
    if (!rule.pattern.global) break;
  }
  return false;
}

function redactWithRule(text: string, rule: CompiledTextRule): string {
  rule.pattern.lastIndex = 0;
  return text.replace(rule.pattern, (match: string) => {
    if (rule.validateMatch && !rule.validateMatch(match)) return match;
    return rule.redaction;
  });
}

function hasBlockingFinding(findings: GuardrailFinding[]): boolean {
  return findings.some((finding) => finding.action === 'block');
}

function compilePatternList(
  values: unknown,
  options: {
    namePrefix: string;
    direction: GuardrailDirection;
    kind: Exclude<GuardrailKind, 'schema'>;
    action: GuardrailAction;
    severity: GuardrailSeverity;
    redaction: string;
    category?: string;
  },
): CompiledTextRule[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value, index): CompiledTextRule | null => {
      if (typeof value !== 'string' || value.length === 0) return null;
      const pattern = compileRegex(value);
      if (!pattern) return null;
      return {
        name: `${options.namePrefix}_${index}`,
        kind: options.kind,
        direction: options.direction,
        action: options.action,
        severity: options.severity,
        pattern,
        redaction: options.redaction,
        category: options.category,
      };
    })
    .filter((value): value is CompiledTextRule => value !== null);
}

function compileRegex(value: string): RegExp | null {
  let source = value;
  let flags = 'gi';
  const literal = /^\/(.+)\/([a-z]*)$/i.exec(value);
  if (literal) {
    source = literal[1];
    flags = literal[2] || flags;
  }
  if (source.startsWith('(?i)')) {
    source = source.slice(4);
    if (!flags.includes('i')) flags += 'i';
  }
  if (!flags.includes('g')) flags += 'g';
  try {
    return new RegExp(source, Array.from(new Set(flags.split(''))).join(''));
  } catch {
    return null;
  }
}

function normalizeSchemaRule(value: unknown): SchemaRuleConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const cfg = value as SchemaRuleConfig;
  const schema =
    cfg.schema && typeof cfg.schema === 'object' && !Array.isArray(cfg.schema)
      ? cfg.schema
      : undefined;
  return {
    enabled: cfg.enabled === true,
    action: cfg.action === 'block' ? 'block' : 'audit',
    schema,
    parse_json: cfg.parse_json !== false,
  };
}

function normalizeDirection(value: unknown): GuardrailDirection {
  return value === 'input' || value === 'output' || value === 'both'
    ? value
    : 'both';
}

function normalizeAction(
  value: unknown,
  fallback: GuardrailAction,
): GuardrailAction {
  return value === 'audit' || value === 'block' || value === 'redact'
    ? value
    : fallback;
}

function normalizeSeverity(
  value: unknown,
  fallback: GuardrailSeverity,
): GuardrailSeverity {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function safeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
}

function isPiiEntity(value: unknown): value is PiiEntity {
  return (
    value === 'email' ||
    value === 'phone' ||
    value === 'ssn' ||
    value === 'credit_card' ||
    value === 'api_key'
  );
}

function looksLikeCreditCard(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function requestToSchemaDocument(request: CanonicalRequest): Record<string, unknown> {
  return {
    source_format: request.metadata.source_format,
    model: request.metadata.original_model || 'auto',
    stream: request.stream,
    messages: request.messages.map((message) => ({
      role: message.role,
      text: messageText(message),
    })),
    tools_count: request.tools?.length || 0,
    has_tools: Boolean(request.tools?.length),
    structured_output_requested: request.structured_output?.requested === true,
  };
}

function responseToSchemaDocument(response: CanonicalResponse): Record<string, unknown> {
  return {
    model: response.model,
    stop_reason: response.stop_reason,
    text: responseText(response),
    content_blocks: response.content.length,
    usage: response.usage,
    routing: {
      tier: response.routing.tier,
      node: response.routing.node,
      is_fallback: response.routing.is_fallback,
    },
  };
}

function responseText(response: CanonicalResponse): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n')
    .trim();
}

function messageText(message: CanonicalMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n');
}

function validateJsonSchemaLite(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$',
): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (typeof type === 'string' && !matchesJsonSchemaType(value, type)) {
    return [`${path} must be ${type}`];
  }
  if (
    Array.isArray(type) &&
    !type.some((item) => typeof item === 'string' && matchesJsonSchemaType(value, item))
  ) {
    return [`${path} must match one of ${type.join(', ')}`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of the configured enum values`);
  }
  if (schema.const !== undefined && schema.const !== value) {
    errors.push(`${path} must equal the configured const value`);
  }

  if (typeof value === 'string') {
    const minLength = numberValue(schema.minLength);
    const maxLength = numberValue(schema.maxLength);
    if (minLength !== undefined && value.length < minLength) {
      errors.push(`${path} must have length >= ${minLength}`);
    }
    if (maxLength !== undefined && value.length > maxLength) {
      errors.push(`${path} must have length <= ${maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      const pattern = compileRegex(schema.pattern);
      if (pattern && !matchingRule({
        name: 'schema.pattern',
        kind: 'policy',
        direction: 'both',
        action: 'audit',
        severity: 'low',
        pattern,
        redaction: DEFAULT_REDACTION,
      }, value)) {
        errors.push(`${path} must match configured pattern`);
      }
    }
  }

  if (typeof value === 'number') {
    const minimum = numberValue(schema.minimum);
    const maximum = numberValue(schema.maximum);
    if (minimum !== undefined && value < minimum) {
      errors.push(`${path} must be >= ${minimum}`);
    }
    if (maximum !== undefined && value > maximum) {
      errors.push(`${path} must be <= ${maximum}`);
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties)
      ? schema.properties
      : {};
    if (Array.isArray(schema.required)) {
      for (const requiredKey of schema.required) {
        if (typeof requiredKey === 'string' && !(requiredKey in value)) {
          errors.push(`${path}.${requiredKey} is required`);
        }
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isPlainObject(childSchema)) {
        errors.push(
          ...validateJsonSchemaLite(
            value[key],
            childSchema,
            `${path}.${key}`,
          ),
        );
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
  }

  if (Array.isArray(value)) {
    const minItems = numberValue(schema.minItems);
    const maxItems = numberValue(schema.maxItems);
    if (minItems !== undefined && value.length < minItems) {
      errors.push(`${path} must have at least ${minItems} item(s)`);
    }
    if (maxItems !== undefined && value.length > maxItems) {
      errors.push(`${path} must have at most ${maxItems} item(s)`);
    }
    if (isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(
          ...validateJsonSchemaLite(
            item,
            schema.items as Record<string, unknown>,
            `${path}[${index}]`,
          ),
        );
      });
    }
  }

  return errors;
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
