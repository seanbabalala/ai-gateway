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
type GuardrailAction = 'audit' | 'redact' | 'block' | 'allow';
type GuardrailSeverity = 'low' | 'medium' | 'high';
type GuardrailKind = 'policy' | 'pii' | 'prompt_injection' | 'schema';
type PiiEntity = 'email' | 'phone' | 'ssn' | 'credit_card' | 'api_key';

interface GuardrailsConfig {
  enabled?: boolean;
  mode?: 'audit' | 'redact' | 'block';
  input_patterns?: string[];
  output_patterns?: string[];
  blocked_message?: string;
  include_prompt_in_logs?: boolean;
  policies?: PolicyRuleConfig[];
  rules?: PolicyRuleConfig[];
  pii?: PiiConfig;
  prompt_injection?: PromptInjectionConfig;
  schema?: SchemaConfig;
  schema_validation?: LegacySchemaValidationConfig;
  max_findings_per_request?: number;
}

interface PolicyRuleConfig {
  enabled?: boolean;
  name?: string;
  direction?: GuardrailDirection;
  pattern?: string;
  action?: GuardrailAction;
  redaction?: string;
  severity?: GuardrailSeverity;
  category?: string;
}

interface PiiConfig {
  enabled?: boolean;
  entities?: PiiEntity[];
  direction?: GuardrailDirection;
  action?: Exclude<GuardrailAction, 'allow'>;
  redaction?: string;
}

interface PromptInjectionConfig {
  enabled?: boolean;
  patterns?: string[];
  direction?: GuardrailDirection;
  action?: Exclude<GuardrailAction, 'allow'>;
  redaction?: string;
  severity?: GuardrailSeverity;
}

interface SchemaConfig {
  enabled?: boolean;
  action?: 'audit' | 'block';
  trigger_fallback?: boolean;
  parse_json?: boolean;
  schema?: Record<string, unknown>;
  input?: SchemaRuleConfig;
  output?: SchemaRuleConfig;
}

interface LegacySchemaValidationConfig {
  input?: SchemaRuleConfig;
  output?: SchemaRuleConfig;
}

interface SchemaRuleConfig {
  enabled?: boolean;
  action?: 'audit' | 'block';
  trigger_fallback?: boolean;
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
  request_id?: string;
  direction: 'input' | 'output';
  kind: GuardrailKind;
  rule: string;
  action: GuardrailAction;
  severity: GuardrailSeverity;
  path: string;
  category?: string;
  match_count?: number;
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
const DEFAULT_MAX_FINDINGS = 50;
const STORE_FINDINGS_KEY = 'guardrails.findings';
const STORE_STREAM_BLOCKED_KEY = 'guardrails.stream_blocked';
const STORE_SCHEMA_FALLBACK_KEY = 'guardrails.schema_fallback_requested';

const DEFAULT_PII_ORDER: PiiEntity[] = [
  'api_key',
  'credit_card',
  'ssn',
  'email',
  'phone',
];

const PROMPT_INJECTION_PATTERNS = [
  'ignore (all )?(previous|prior|above) (instructions|rules|messages)',
  'disregard (all )?(previous|prior|above) (instructions|rules|messages)',
  'reveal (the )?(system|developer|hidden) (prompt|message|instructions)',
  'print (the )?(system|developer|hidden) (prompt|message|instructions)',
  'bypass (the )?(safety|policy|guardrails|rules)',
  'override (the )?(system|developer|hidden) (prompt|instructions|rules)',
  'jailbreak',
  'developer mode',
  '\\bDAN\\b',
];

export default class GuardrailsPlugin implements GatewayPlugin {
  meta = {
    name: 'guardrails',
    version: '0.9.0',
    priority: 20,
  };

  private enabled = false;
  private mode: 'audit' | 'redact' | 'block' = 'audit';
  private blockedMessage = DEFAULT_BLOCKED_MESSAGE;
  private maxFindingsPerRequest = DEFAULT_MAX_FINDINGS;
  private textRules: CompiledTextRule[] = [];
  private inputSchema?: SchemaRuleConfig;
  private outputSchema?: SchemaRuleConfig;

  onLoad(config: Readonly<Record<string, unknown>>): void {
    const cfg = config as GuardrailsConfig;
    this.enabled = cfg.enabled === true;
    this.mode = normalizeMode(cfg.mode);
    this.blockedMessage =
      typeof cfg.blocked_message === 'string' && cfg.blocked_message.length > 0
        ? cfg.blocked_message
        : DEFAULT_BLOCKED_MESSAGE;
    this.maxFindingsPerRequest = normalizeMaxFindings(
      cfg.max_findings_per_request,
    );
    const policyValues = [
      ...(Array.isArray(cfg.policies) ? cfg.policies : []),
      ...(Array.isArray(cfg.rules) ? cfg.rules : []),
    ];
    this.textRules = [
      ...this.compileLegacyPatternRules(cfg),
      ...this.compilePolicyRules(policyValues),
      ...this.compilePiiRules(cfg.pii),
      ...this.compilePromptInjectionRules(cfg.prompt_injection),
    ];
    const schemas = normalizeSchemaConfig(cfg.schema, cfg.schema_validation, this.mode);
    this.inputSchema = schemas.input;
    this.outputSchema = schemas.output;
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
      this.markSchemaFallbackIntent(ctx, findings);

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
    const defaultAction = this.defaultAction();
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
      if (cfg.enabled === false) return;
      if (typeof cfg.pattern !== 'string' || cfg.pattern.length === 0) return;
      const pattern = compileRegex(cfg.pattern);
      if (!pattern) return;
      rules.push({
        name: safeName(cfg.name, `policy_${index}`),
        kind: 'policy',
        direction: normalizeDirection(cfg.direction),
        action: normalizeAction(cfg.action, this.defaultAction()),
        severity: normalizeSeverity(cfg.severity, 'medium'),
        pattern,
        redaction: normalizeString(cfg.redaction, DEFAULT_REDACTION),
        category: safeOptionalName(cfg.category),
      });
    });
    return rules;
  }

  private compilePiiRules(cfg: PiiConfig | undefined): CompiledTextRule[] {
    if (cfg?.enabled !== true) return [];
    const action = normalizeEnforcementAction(cfg.action, this.defaultAction());
    const redaction = normalizeString(cfg.redaction, DEFAULT_REDACTION);
    const selected = new Set<PiiEntity>(
      Array.isArray(cfg.entities) && cfg.entities.length > 0
        ? cfg.entities.filter(isPiiEntity)
        : DEFAULT_PII_ORDER,
    );
    const direction = normalizeDirection(cfg.direction);
    const builtins: Record<
      PiiEntity,
      Omit<CompiledTextRule, 'direction' | 'action' | 'redaction'>
    > = {
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
    const action = normalizeEnforcementAction(cfg.action, this.defaultAction());
    const redaction = normalizeString(cfg.redaction, '[filtered instruction]');
    const patterns =
      Array.isArray(cfg.patterns) && cfg.patterns.length > 0
        ? cfg.patterns
        : PROMPT_INJECTION_PATTERNS;
    return compilePatternList(patterns, {
      namePrefix: 'prompt_injection',
      direction: normalizeDirection(cfg.direction || 'input'),
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
    const errors = validateJsonSchemaLite(
      requestToSchemaDocument(request),
      this.inputSchema.schema,
    );
    return errors.map((message) =>
      schemaFinding('input', 'schema.input', this.inputSchema, 'request', message),
    );
  }

  private validateOutputSchema(response: CanonicalResponse): GuardrailFinding[] {
    if (!this.outputSchema?.enabled || !this.outputSchema.schema) return [];
    let value: unknown;
    if (this.outputSchema.parse_json !== false) {
      const text = responseText(response);
      try {
        value = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        return [
          schemaFinding(
            'output',
            'schema.output',
            this.outputSchema,
            'response.content',
            'response content is not valid JSON',
          ),
        ];
      }
    } else {
      value = responseToSchemaDocument(response);
    }

    const errors = validateJsonSchemaLite(value, this.outputSchema.schema);
    return errors.map((message) =>
      schemaFinding('output', 'schema.output', this.outputSchema, 'response', message),
    );
  }

  private markSchemaFallbackIntent(
    ctx: HookContext<PostUpstreamData>,
    findings: GuardrailFinding[],
  ): void {
    if (
      findings.some(
        (finding) =>
          finding.kind === 'schema' &&
          finding.direction === 'output' &&
          this.outputSchema?.trigger_fallback === true,
      )
    ) {
      ctx.store.set(STORE_SCHEMA_FALLBACK_KEY, true);
    }
  }

  private defaultAction(): Exclude<GuardrailAction, 'allow'> {
    return this.mode;
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
    const requestId = typeof ctx.store.get('request_id') === 'string'
      ? (ctx.store.get('request_id') as string)
      : undefined;
    const enriched = findings.map((finding) => ({
      ...finding,
      request_id: finding.request_id || requestId,
    }));
    const existing = ctx.store.get(STORE_FINDINGS_KEY);
    const combined = Array.isArray(existing) ? [...existing, ...enriched] : enriched;
    const capped = capFindings(combined, this.maxFindingsPerRequest, requestId);
    ctx.store.set(STORE_FINDINGS_KEY, capped);

    const rules = Array.from(new Set(enriched.map((finding) => finding.rule))).join(',');
    const actions = Array.from(new Set(enriched.map((finding) => finding.action))).join(',');
    ctx.log.warn(
      `guardrails matched findings=${enriched.length} total=${capped.length}` +
        ` rules=${rules || 'none'} actions=${actions || 'none'}` +
        ` request_id=${requestId || 'unknown'}`,
    );
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
  const allowRules = rules.filter(
    (rule) => rule.kind === 'policy' && rule.action === 'allow',
  );
  const allowFindings = collectFindings(output, allowRules, direction, path);
  findings.push(...allowFindings);
  const hasPolicyAllow = allowFindings.length > 0;

  for (const rule of rules) {
    if (rule.action === 'allow') continue;
    if (hasPolicyAllow && rule.kind === 'policy') continue;
    const matches = collectMatches(rule, output);
    if (matches === 0) continue;
    findings.push({
      direction,
      kind: rule.kind,
      rule: rule.name,
      action: rule.action,
      severity: rule.severity,
      path,
      category: rule.category,
      match_count: matches,
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

function collectFindings(
  text: string,
  rules: CompiledTextRule[],
  direction: 'input' | 'output',
  path: string,
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  for (const rule of rules) {
    const matches = collectMatches(rule, text);
    if (matches === 0) continue;
    findings.push({
      direction,
      kind: rule.kind,
      rule: rule.name,
      action: rule.action,
      severity: rule.severity,
      path,
      category: rule.category,
      match_count: matches,
    });
  }
  return findings;
}

function collectMatches(rule: CompiledTextRule, text: string): number {
  rule.pattern.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = rule.pattern.exec(text)) !== null) {
    if (!rule.validateMatch || rule.validateMatch(match[0])) {
      count += 1;
    }
    if (!rule.pattern.global) break;
    if (match[0].length === 0) rule.pattern.lastIndex += 1;
  }
  return count;
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

function normalizeSchemaConfig(
  schema: SchemaConfig | undefined,
  legacy: LegacySchemaValidationConfig | undefined,
  mode: 'audit' | 'redact' | 'block',
): { input?: SchemaRuleConfig; output?: SchemaRuleConfig } {
  const defaultAction = mode === 'block' ? 'block' : 'audit';
  const input = normalizeSchemaRule(
    schema?.input || legacy?.input,
    schema,
    defaultAction,
  );
  const output = normalizeSchemaRule(
    schema?.output ||
      legacy?.output ||
      (schema?.schema ? { ...schema, schema: schema.schema } : undefined),
    schema,
    defaultAction,
  );
  return { input, output };
}

function normalizeSchemaRule(
  value: unknown,
  parent: SchemaConfig | undefined,
  defaultAction: 'audit' | 'block',
): SchemaRuleConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const cfg = value as SchemaRuleConfig;
  const schema =
    cfg.schema && typeof cfg.schema === 'object' && !Array.isArray(cfg.schema)
      ? cfg.schema
      : undefined;
  return {
    enabled: cfg.enabled === true || parent?.enabled === true,
    action: cfg.action === 'block' || parent?.action === 'block'
      ? 'block'
      : defaultAction,
    trigger_fallback: cfg.trigger_fallback === true || parent?.trigger_fallback === true,
    schema,
    parse_json: cfg.parse_json !== false && parent?.parse_json !== false,
  };
}

function normalizeMode(value: unknown): 'audit' | 'redact' | 'block' {
  return value === 'redact' || value === 'block' ? value : 'audit';
}

function normalizeDirection(value: unknown): GuardrailDirection {
  return value === 'input' || value === 'output' || value === 'both'
    ? value
    : 'both';
}

function normalizeAction(
  value: unknown,
  fallback: Exclude<GuardrailAction, 'allow'>,
): GuardrailAction {
  return value === 'audit' || value === 'redact' || value === 'block' || value === 'allow'
    ? value
    : fallback;
}

function normalizeEnforcementAction(
  value: unknown,
  fallback: Exclude<GuardrailAction, 'allow'>,
): Exclude<GuardrailAction, 'allow'> {
  return value === 'audit' || value === 'redact' || value === 'block'
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

function normalizeMaxFindings(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_FINDINGS;
  return Math.max(1, Math.min(Math.floor(value), 500));
}

function safeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
}

function safeOptionalName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return safeName(value, 'policy');
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

function schemaFinding(
  direction: 'input' | 'output',
  rule: string,
  cfg: SchemaRuleConfig | undefined,
  path: string,
  message: string,
): GuardrailFinding {
  return {
    direction,
    kind: 'schema',
    rule,
    action: cfg?.action || 'audit',
    severity: 'high',
    path,
    category: cfg?.trigger_fallback ? 'schema_validation_fallback' : 'schema_validation',
    message,
    match_count: 1,
  };
}

function requestToSchemaDocument(request: CanonicalRequest): Record<string, unknown> {
  return {
    source_format: request.metadata.source_format,
    model: request.metadata.original_model || 'auto',
    stream: request.stream,
    message_count: request.messages.length,
    messages: request.messages.map((message) => ({
      role: message.role,
      text_length: messageText(message).length,
      has_text: messageText(message).length > 0,
    })),
    tools_count: request.tools?.length || 0,
    has_tools: Boolean(request.tools?.length),
    structured_output_requested: request.structured_output?.requested === true,
    structured_output_type: request.structured_output?.type || null,
    media: request.metadata.media
      ? {
          media_type: request.metadata.media.media_type,
          operation: request.metadata.media.operation,
          multipart: request.metadata.media.multipart,
          file_count: request.metadata.media.file_count,
          byte_size: request.metadata.media.byte_size,
          requested_format: request.metadata.media.requested_format || null,
          response_format: request.metadata.media.response_format || null,
        }
      : null,
  };
}

function responseToSchemaDocument(response: CanonicalResponse): Record<string, unknown> {
  return {
    model: response.model,
    stop_reason: response.stop_reason,
    text_length: responseText(response).length,
    content_blocks: response.content.length,
    usage: response.usage,
    routing: {
      tier: response.routing.tier,
      node: response.routing.node,
      is_fallback: response.routing.is_fallback,
      fallback_reason: response.routing.fallback_reason || null,
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

function capFindings(
  findings: GuardrailFinding[],
  max: number,
  requestId?: string,
): GuardrailFinding[] {
  if (findings.length <= max) return findings;
  const capped = findings.slice(0, Math.max(1, max));
  capped[capped.length - 1] = {
    request_id: requestId,
    direction: 'input',
    kind: 'policy',
    rule: 'findings.truncated',
    action: 'audit',
    severity: 'low',
    path: 'guardrails.findings',
    category: 'limit',
    message: `findings truncated to ${max}`,
    match_count: findings.length - max,
  };
  return capped;
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

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push(`${path} must match enum`);
  }
  if ('const' in schema && schema.const !== value) {
    errors.push(`${path} must match const`);
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in obj)) {
          errors.push(`${path}.${key} is required`);
        }
      }
    }
    if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in obj && childSchema && typeof childSchema === 'object' && !Array.isArray(childSchema)) {
          errors.push(
            ...validateJsonSchemaLite(obj[key], childSchema as Record<string, unknown>, `${path}.${key}`),
          );
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties && typeof schema.properties === 'object') {
      const allowed = new Set(Object.keys(schema.properties as Record<string, unknown>));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} is shorter than ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} is longer than ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push(`${path} does not match pattern`);
        }
      } catch {
        errors.push(`${path} has invalid schema pattern`);
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path} is below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path} is above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} has fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} has more than ${schema.maxItems} items`);
    }
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
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
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number';
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}
