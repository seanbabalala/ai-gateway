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
type GuardrailAction = 'audit' | 'redact' | 'block' | 'allow' | 'webhook';
type GuardrailSeverity = 'low' | 'medium' | 'high';
type GuardrailKind =
  | 'policy'
  | 'pii'
  | 'secret'
  | 'prompt_injection'
  | 'jailbreak'
  | 'unsafe_url'
  | 'schema'
  | 'tool_call_policy';
type PiiEntity =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'api_key'
  | 'ip_address'
  | 'iban'
  | 'passport';
type GuardrailsWebhookDeliveryState =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'debounced'
  | 'dropped';
type GuardrailsWebhookDropPolicy = 'drop_newest' | 'drop_oldest';

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
  secrets?: SecretPatternConfig;
  secret_patterns?: SecretPatternConfig;
  prompt_injection?: PromptInjectionConfig;
  jailbreak?: PromptInjectionConfig;
  unsafe_url?: UnsafeUrlConfig;
  tool_call_policy?: ToolCallPolicyConfig;
  schema?: SchemaConfig;
  schema_validation?: LegacySchemaValidationConfig;
  webhook?: WebhookSinkConfig;
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

interface SecretPatternConfig {
  enabled?: boolean;
  patterns?: string[];
  direction?: GuardrailDirection;
  action?: Exclude<GuardrailAction, 'allow'>;
  redaction?: string;
  severity?: GuardrailSeverity;
}

interface PromptInjectionConfig {
  enabled?: boolean;
  patterns?: string[];
  direction?: GuardrailDirection;
  action?: Exclude<GuardrailAction, 'allow'>;
  redaction?: string;
  severity?: GuardrailSeverity;
}

interface UnsafeUrlConfig {
  enabled?: boolean;
  patterns?: string[];
  direction?: GuardrailDirection;
  action?: Exclude<GuardrailAction, 'allow'>;
  redaction?: string;
  severity?: GuardrailSeverity;
  block_private_ips?: boolean;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

interface ToolCallPolicyConfig {
  enabled?: boolean;
  direction?: GuardrailDirection;
  action?: Exclude<GuardrailAction, 'allow' | 'redact'>;
  allowed_tools?: string[];
  blocked_tools?: string[];
  require_known_tools?: boolean;
  severity?: GuardrailSeverity;
}

interface SchemaConfig {
  enabled?: boolean;
  action?: 'audit' | 'block' | 'webhook';
  trigger_fallback?: boolean;
  parse_json?: boolean;
  strict?: boolean;
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
  action?: 'audit' | 'block' | 'webhook';
  trigger_fallback?: boolean;
  schema?: Record<string, unknown>;
  parse_json?: boolean;
  strict?: boolean;
}

interface WebhookSinkConfig {
  enabled?: boolean;
  url?: string;
  headers?: Record<string, string>;
  include_actions?: GuardrailAction[];
  debounce_seconds?: number;
  retry?: {
    attempts?: number;
    backoff_ms?: number;
  };
  timeout_ms?: number;
  max_queue?: number;
  drop_policy?: GuardrailsWebhookDropPolicy;
}

interface NormalizedWebhookSinkConfig {
  enabled: boolean;
  configured: boolean;
  url?: string;
  headers: Record<string, string>;
  includeActions: Set<GuardrailAction>;
  debounceMs: number;
  attempts: number;
  backoffMs: number;
  timeoutMs: number;
  maxQueue: number;
  dropPolicy: GuardrailsWebhookDropPolicy;
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

interface PendingWebhookDelivery {
  id: string;
  payload: Record<string, unknown>;
  findings: GuardrailFinding[];
  timestamp: string;
}

interface GuardrailsWebhookStatus {
  id: string;
  status: GuardrailsWebhookDeliveryState;
  attempts: number;
  timestamp: string;
  finding_count: number;
  rules: string[];
  actions: string[];
  last_error: string | null;
  sent_at: string | null;
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
  'iban',
  'passport',
  'email',
  'phone',
  'ip_address',
];

const PROMPT_INJECTION_PATTERNS = [
  'ignore (all )?(previous|prior|above) (instructions|rules|messages)',
  'disregard (all )?(previous|prior|above) (instructions|rules|messages)',
  'reveal (the )?(system|developer|hidden) (prompt|message|instructions)',
  'print (the )?(system|developer|hidden) (prompt|message|instructions)',
  'bypass (the )?(safety|policy|guardrails|rules)',
  'override (the )?(system|developer|hidden) (prompt|instructions|rules)',
  'follow only my next message',
  'you are no longer bound by (policy|rules|instructions)',
];

const JAILBREAK_PATTERNS = [
  'jailbreak',
  'developer mode',
  '\\bDAN\\b',
  'do anything now',
  'simulate unrestricted',
  'ignore (the )?(safety|moderation|policy) layer',
];

const SECRET_PATTERNS = [
  '\\bAKIA[0-9A-Z]{16}\\b',
  '\\bASIA[0-9A-Z]{16}\\b',
  '\\bgh[pousr]_[A-Za-z0-9_]{20,}\\b',
  '\\bgithub_pat_[A-Za-z0-9_]{20,}\\b',
  '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b',
  '\\bsk-(?:live|test)_[A-Za-z0-9]{16,}\\b',
  '\\bsk-ant-[A-Za-z0-9._-]{16,}\\b',
  '\\bAIza[0-9A-Za-z_-]{20,}\\b',
  '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b',
  '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
];

const URL_PATTERN =
  '\\bhttps?:\\/\\/(?:[A-Za-z0-9-]+\\.)*[A-Za-z0-9-]+(?::\\d+)?(?:\\/[^\\s<>"\\\']*)?';

const DEFAULT_WEBHOOK_STATUS_LIMIT = 20;

export default class GuardrailsPlugin implements GatewayPlugin {
  meta = {
    name: 'guardrails',
    version: '1.0.0',
    priority: 20,
  };

  private enabled = false;
  private mode: 'audit' | 'redact' | 'block' = 'audit';
  private blockedMessage = DEFAULT_BLOCKED_MESSAGE;
  private maxFindingsPerRequest = DEFAULT_MAX_FINDINGS;
  private textRules: CompiledTextRule[] = [];
  private toolPolicy?: Required<
    Pick<ToolCallPolicyConfig, 'direction' | 'action' | 'severity'>
  > & {
    allowedTools: Set<string>;
    blockedTools: Set<string>;
    requireKnownTools: boolean;
  };
  private inputSchema?: SchemaRuleConfig;
  private outputSchema?: SchemaRuleConfig;
  private webhook = normalizeWebhookSink(undefined);
  private webhookQueue: PendingWebhookDelivery[] = [];
  private webhookRecent: GuardrailsWebhookStatus[] = [];
  private webhookDebounce = new Map<string, number>();
  private webhookProcessing = false;
  private webhookDrainTimer?: NodeJS.Timeout;
  private webhookSequence = 0;
  private webhookDropped = 0;
  private totalFindings = 0;
  private findingsByKind: Record<string, number> = {};
  private findingsByAction: Record<string, number> = {};
  private recentFindings: GuardrailFinding[] = [];
  private lastFindingAt: string | null = null;

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
      ...this.compileSecretRules(cfg.secrets || cfg.secret_patterns),
      ...this.compilePromptInjectionRules(cfg.prompt_injection),
      ...this.compileJailbreakRules(cfg.jailbreak),
      ...this.compileUnsafeUrlRules(cfg.unsafe_url),
    ];
    this.toolPolicy = normalizeToolPolicy(cfg.tool_call_policy, this.defaultAction());
    const schemas = normalizeSchemaConfig(cfg.schema, cfg.schema_validation, this.mode);
    this.inputSchema = schemas.input;
    this.outputSchema = schemas.output;
    this.webhook = normalizeWebhookSink(cfg.webhook);
  }

  onDestroy(): void {
    if (this.webhookDrainTimer) {
      clearTimeout(this.webhookDrainTimer);
      this.webhookDrainTimer = undefined;
    }
  }

  getStatus(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      mode: this.mode,
      rules: {
        total: this.textRules.length + (this.toolPolicy ? 1 : 0),
        by_kind: this.countRulesByKind(),
        by_action: this.countRulesByAction(),
        schema: {
          input_enabled: this.inputSchema?.enabled === true,
          output_enabled: this.outputSchema?.enabled === true,
          input_strict: this.inputSchema?.strict === true,
          output_strict: this.outputSchema?.strict === true,
        },
      },
      findings: {
        total: this.totalFindings,
        by_kind: { ...this.findingsByKind },
        by_action: { ...this.findingsByAction },
        last_seen_at: this.lastFindingAt,
        recent: this.recentFindings.slice(0, DEFAULT_WEBHOOK_STATUS_LIMIT),
      },
      webhook: {
        enabled: this.webhook.enabled,
        configured: this.webhook.configured,
        queue_depth: this.webhookQueue.length,
        max_queue: this.webhook.maxQueue,
        drop_policy: this.webhook.dropPolicy,
        dropped: this.webhookDropped,
        last_status: this.webhookRecent[0]?.status || null,
        last_error: this.webhookRecent[0]?.last_error || null,
        last_sent_at: this.webhookRecent.find((item) => item.sent_at)?.sent_at || null,
        recent: [...this.webhookRecent],
      },
      privacy: {
        prompt: false,
        response: false,
        raw_headers: false,
        provider_keys: false,
        media_bytes: false,
      },
    };
  }

  async flushWebhooksForTests(): Promise<void> {
    if (this.webhookDrainTimer) {
      clearTimeout(this.webhookDrainTimer);
      this.webhookDrainTimer = undefined;
    }
    await this.drainWebhookQueue();
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
      const toolFindings = this.validateInputToolPolicy(ctx.data.request);
      const findings = [
        ...requestResult.findings,
        ...schemaFindings,
        ...toolFindings,
      ];
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
      const toolFindings = this.validateOutputToolPolicy(ctx.data.response);
      const findings = [
        ...responseResult.findings,
        ...schemaFindings,
        ...toolFindings,
      ];
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
      ip_address: {
        name: 'pii.ip_address',
        kind: 'pii',
        severity: 'low',
        category: 'ip_address',
        pattern:
          /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
      },
      iban: {
        name: 'pii.iban',
        kind: 'pii',
        severity: 'high',
        category: 'iban',
        pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,
      },
      passport: {
        name: 'pii.passport',
        kind: 'pii',
        severity: 'medium',
        category: 'passport',
        pattern: /\b(?:passport|passaporte|pasaporte|护照|パスポート)\s*[:#-]?\s*[A-Z0-9]{6,12}\b/gi,
      },
    };
    return DEFAULT_PII_ORDER.filter((entity) => selected.has(entity)).map((entity) => ({
      ...builtins[entity],
      direction,
      action,
      redaction,
    }));
  }

  private compileSecretRules(
    cfg: SecretPatternConfig | undefined,
  ): CompiledTextRule[] {
    if (cfg?.enabled !== true) return [];
    const action = normalizeEnforcementAction(cfg.action, this.defaultAction());
    const redaction = normalizeString(cfg.redaction, DEFAULT_REDACTION);
    const patterns =
      Array.isArray(cfg.patterns) && cfg.patterns.length > 0
        ? cfg.patterns
        : SECRET_PATTERNS;
    return compilePatternList(patterns, {
      namePrefix: 'secret',
      direction: normalizeDirection(cfg.direction),
      kind: 'secret',
      action,
      severity: normalizeSeverity(cfg.severity, 'high'),
      redaction,
      category: 'secret_token',
    });
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

  private compileJailbreakRules(
    cfg: PromptInjectionConfig | undefined,
  ): CompiledTextRule[] {
    if (cfg?.enabled !== true) return [];
    const action = normalizeEnforcementAction(cfg.action, this.defaultAction());
    const redaction = normalizeString(cfg.redaction, '[filtered jailbreak]');
    const patterns =
      Array.isArray(cfg.patterns) && cfg.patterns.length > 0
        ? cfg.patterns
        : JAILBREAK_PATTERNS;
    return compilePatternList(patterns, {
      namePrefix: 'jailbreak',
      direction: normalizeDirection(cfg.direction || 'input'),
      kind: 'jailbreak',
      action,
      severity: normalizeSeverity(cfg.severity, 'high'),
      redaction,
      category: 'jailbreak',
    });
  }

  private compileUnsafeUrlRules(
    cfg: UnsafeUrlConfig | undefined,
  ): CompiledTextRule[] {
    if (cfg?.enabled !== true) return [];
    const action = normalizeEnforcementAction(cfg.action, this.defaultAction());
    const redaction = normalizeString(cfg.redaction, '[unsafe-url]');
    const patterns =
      Array.isArray(cfg.patterns) && cfg.patterns.length > 0
        ? cfg.patterns
        : [URL_PATTERN];
    const options = {
      blockPrivateIps: cfg.block_private_ips !== false,
      allowedDomains: normalizeDomainList(cfg.allowed_domains),
      blockedDomains: normalizeDomainList(cfg.blocked_domains),
    };
    return compilePatternList(patterns, {
      namePrefix: 'unsafe_url',
      direction: normalizeDirection(cfg.direction),
      kind: 'unsafe_url',
      action,
      severity: normalizeSeverity(cfg.severity, 'medium'),
      redaction,
      category: 'unsafe_url',
      validateMatch: (value) => isUnsafeUrl(value, options),
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

  private validateInputToolPolicy(request: CanonicalRequest): GuardrailFinding[] {
    if (
      !this.toolPolicy ||
      (this.toolPolicy.direction !== 'input' && this.toolPolicy.direction !== 'both')
    ) {
      return [];
    }
    const findings: GuardrailFinding[] = [];
    const tools = request.tools || [];
    tools.forEach((tool, index) => {
      const reason = this.toolPolicyViolation(tool.name);
      if (!reason) return;
      findings.push({
        direction: 'input',
        kind: 'tool_call_policy',
        rule: 'tool_call_policy.input',
        action: this.toolPolicy!.action,
        severity: this.toolPolicy!.severity,
        path: `tools[${index}]`,
        category: reason,
        match_count: 1,
        message: `tool "${safeToolName(tool.name)}" ${reason}`,
      });
    });
    if (
      typeof request.tool_choice === 'object' &&
      request.tool_choice?.name &&
      this.toolPolicyViolation(request.tool_choice.name)
    ) {
      findings.push({
        direction: 'input',
        kind: 'tool_call_policy',
        rule: 'tool_call_policy.choice',
        action: this.toolPolicy.action,
        severity: this.toolPolicy.severity,
        path: 'tool_choice',
        category: 'tool_choice_not_allowed',
        match_count: 1,
        message: `tool choice "${safeToolName(request.tool_choice.name)}" is not allowed`,
      });
    }
    return findings;
  }

  private validateOutputToolPolicy(response: CanonicalResponse): GuardrailFinding[] {
    if (
      !this.toolPolicy ||
      (this.toolPolicy.direction !== 'output' && this.toolPolicy.direction !== 'both')
    ) {
      return [];
    }
    const findings: GuardrailFinding[] = [];
    response.content.forEach((block, index) => {
      if (block.type !== 'tool_use') return;
      const reason = this.toolPolicyViolation(block.name);
      if (!reason) return;
      findings.push({
        direction: 'output',
        kind: 'tool_call_policy',
        rule: 'tool_call_policy.output',
        action: this.toolPolicy!.action,
        severity: this.toolPolicy!.severity,
        path: `response.content[${index}]`,
        category: reason,
        match_count: 1,
        message: `tool "${safeToolName(block.name)}" ${reason}`,
      });
    });
    return findings;
  }

  private toolPolicyViolation(name: string): string | null {
    if (!this.toolPolicy) return null;
    const normalized = normalizeToolName(name);
    if (this.toolPolicy.blockedTools.has(normalized)) return 'tool_blocked';
    if (
      this.toolPolicy.requireKnownTools &&
      !this.toolPolicy.allowedTools.has(normalized)
    ) {
      return 'tool_not_allowed';
    }
    return null;
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
    this.recordFindingStats(enriched);
    this.enqueueWebhookFindings(ctx, enriched);

    const rules = Array.from(new Set(enriched.map((finding) => finding.rule))).join(',');
    const actions = Array.from(new Set(enriched.map((finding) => finding.action))).join(',');
    ctx.log.warn(
      `guardrails matched findings=${enriched.length} total=${capped.length}` +
        ` rules=${rules || 'none'} actions=${actions || 'none'}` +
        ` request_id=${requestId || 'unknown'}`,
    );
  }

  private recordFindingStats(findings: GuardrailFinding[]): void {
    if (findings.length === 0) return;
    const now = new Date().toISOString();
    this.lastFindingAt = now;
    this.totalFindings += findings.length;
    for (const finding of findings) {
      this.findingsByKind[finding.kind] = (this.findingsByKind[finding.kind] || 0) + 1;
      this.findingsByAction[finding.action] =
        (this.findingsByAction[finding.action] || 0) + 1;
    }
    this.recentFindings.unshift(...findings.map((finding) => ({ ...finding })));
    if (this.recentFindings.length > DEFAULT_WEBHOOK_STATUS_LIMIT) {
      this.recentFindings.splice(DEFAULT_WEBHOOK_STATUS_LIMIT);
    }
  }

  private enqueueWebhookFindings(
    ctx: HookContext<PreRequestData | PostUpstreamData | StreamEventData>,
    findings: GuardrailFinding[],
  ): void {
    if (!this.webhook.enabled || !this.webhook.configured) return;
    const selected = findings.filter((finding) =>
      this.webhook.includeActions.has(finding.action),
    );
    if (selected.length === 0) return;

    const dedupeKey = selected
      .map((finding) => `${finding.rule}:${finding.action}:${finding.direction}`)
      .sort()
      .join('|');
    const nowMs = Date.now();
    const previous = this.webhookDebounce.get(dedupeKey);
    if (previous !== undefined && nowMs - previous < this.webhook.debounceMs) {
      this.recordWebhookStatus({
        id: this.nextWebhookId('debounced'),
        status: 'debounced',
        attempts: 0,
        timestamp: new Date().toISOString(),
        finding_count: selected.length,
        rules: uniqueStrings(selected.map((finding) => finding.rule)),
        actions: uniqueStrings(selected.map((finding) => finding.action)),
        last_error: null,
        sent_at: null,
      });
      return;
    }
    this.webhookDebounce.set(dedupeKey, nowMs);

    if (this.webhookQueue.length >= this.webhook.maxQueue) {
      this.webhookDropped += 1;
      if (this.webhook.dropPolicy === 'drop_oldest') {
        const dropped = this.webhookQueue.shift();
        if (dropped) {
          this.updateWebhookStatus(dropped.id, {
            status: 'dropped',
            attempts: 0,
            last_error: 'Webhook queue is full; dropped oldest delivery',
            sent_at: null,
          });
        }
      } else {
        this.recordWebhookStatus({
          id: this.nextWebhookId('dropped'),
          status: 'dropped',
          attempts: 0,
          timestamp: new Date().toISOString(),
          finding_count: selected.length,
          rules: uniqueStrings(selected.map((finding) => finding.rule)),
          actions: uniqueStrings(selected.map((finding) => finding.action)),
          last_error: 'Webhook queue is full',
          sent_at: null,
        });
        return;
      }
    }

    const timestamp = new Date().toISOString();
    const id = this.nextWebhookId('delivery');
    const payload = this.buildWebhookPayload(ctx, selected, timestamp);
    this.webhookQueue.push({ id, payload, findings: selected, timestamp });
    this.recordWebhookStatus({
      id,
      status: 'queued',
      attempts: 0,
      timestamp,
      finding_count: selected.length,
      rules: uniqueStrings(selected.map((finding) => finding.rule)),
      actions: uniqueStrings(selected.map((finding) => finding.action)),
      last_error: null,
      sent_at: null,
    });
    this.scheduleWebhookDrain();
  }

  private buildWebhookPayload(
    ctx: HookContext<PreRequestData | PostUpstreamData | StreamEventData>,
    findings: GuardrailFinding[],
    timestamp: string,
  ): Record<string, unknown> {
    const request = ctx.data.request;
    return {
      version: 'siftgate.guardrails.findings.v1',
      timestamp,
      request_id: findings[0]?.request_id || null,
      source_format: request.metadata?.source_format || null,
      model: request.metadata?.original_model || null,
      findings: findings.map((finding) => sanitizeFinding(finding)),
      summary: {
        finding_count: findings.length,
        rules: uniqueStrings(findings.map((finding) => finding.rule)),
        actions: uniqueStrings(findings.map((finding) => finding.action)),
        kinds: uniqueStrings(findings.map((finding) => finding.kind)),
        severities: uniqueStrings(findings.map((finding) => finding.severity)),
      },
      privacy: {
        prompt: false,
        response: false,
        raw_headers: false,
        provider_keys: false,
        media_bytes: false,
      },
    };
  }

  private scheduleWebhookDrain(): void {
    if (this.webhookQueue.length === 0 || this.webhookProcessing || this.webhookDrainTimer) {
      return;
    }
    this.webhookDrainTimer = setTimeout(() => {
      this.webhookDrainTimer = undefined;
      void this.drainWebhookQueue();
    }, 0);
    this.webhookDrainTimer.unref?.();
  }

  private async drainWebhookQueue(): Promise<void> {
    if (this.webhookProcessing) return;
    this.webhookProcessing = true;
    try {
      while (this.webhookQueue.length > 0) {
        const item = this.webhookQueue.shift()!;
        await this.deliverWebhook(item);
      }
    } finally {
      this.webhookProcessing = false;
      if (this.webhookQueue.length > 0) this.scheduleWebhookDrain();
    }
  }

  private async deliverWebhook(item: PendingWebhookDelivery): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.webhook.attempts; attempt += 1) {
      try {
        await this.sendWebhook(item.payload);
        this.updateWebhookStatus(item.id, {
          status: 'sent',
          attempts: attempt,
          last_error: null,
          sent_at: new Date().toISOString(),
        });
        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt < this.webhook.attempts && this.webhook.backoffMs > 0) {
          await sleep(this.webhook.backoffMs);
        }
      }
    }
    this.updateWebhookStatus(item.id, {
      status: 'failed',
      attempts: this.webhook.attempts,
      last_error: lastError?.message || 'Webhook delivery failed',
      sent_at: null,
    });
  }

  private async sendWebhook(payload: Record<string, unknown>): Promise<void> {
    if (!this.webhook.url) throw new Error('Guardrails webhook URL is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.webhook.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(this.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.webhook.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`,
        );
      }
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        throw new Error(`Webhook timed out after ${this.webhook.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordWebhookStatus(status: GuardrailsWebhookStatus): void {
    this.webhookRecent.unshift(status);
    if (this.webhookRecent.length > DEFAULT_WEBHOOK_STATUS_LIMIT) {
      this.webhookRecent.splice(DEFAULT_WEBHOOK_STATUS_LIMIT);
    }
  }

  private updateWebhookStatus(
    id: string,
    patch: Partial<Pick<GuardrailsWebhookStatus, 'status' | 'attempts' | 'last_error' | 'sent_at'>>,
  ): void {
    const existing = this.webhookRecent.find((status) => status.id === id);
    if (!existing) return;
    Object.assign(existing, patch);
  }

  private nextWebhookId(prefix: string): string {
    this.webhookSequence += 1;
    return `${prefix}_${Date.now()}_${this.webhookSequence}`;
  }

  private countRulesByKind(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const rule of this.textRules) {
      counts[rule.kind] = (counts[rule.kind] || 0) + 1;
    }
    if (this.toolPolicy) counts.tool_call_policy = (counts.tool_call_policy || 0) + 1;
    return counts;
  }

  private countRulesByAction(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const rule of this.textRules) {
      counts[rule.action] = (counts[rule.action] || 0) + 1;
    }
    if (this.toolPolicy) {
      counts[this.toolPolicy.action] = (counts[this.toolPolicy.action] || 0) + 1;
    }
    return counts;
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
    validateMatch?: (match: string) => boolean;
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
        validateMatch: options.validateMatch,
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
  defaultAction: 'audit' | 'block' | 'webhook',
): SchemaRuleConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const cfg = value as SchemaRuleConfig;
  const schema =
    cfg.schema && typeof cfg.schema === 'object' && !Array.isArray(cfg.schema)
      ? cfg.schema
      : undefined;
  const strict = cfg.strict === true || parent?.strict === true;
  return {
    enabled: cfg.enabled === true || parent?.enabled === true,
    action: normalizeSchemaAction(cfg.action ?? parent?.action, defaultAction),
    trigger_fallback: cfg.trigger_fallback === true || parent?.trigger_fallback === true,
    schema: strict && schema ? applyStrictSchemaDefaults(schema) : schema,
    parse_json: cfg.parse_json !== false && parent?.parse_json !== false,
    strict,
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
  return value === 'audit' ||
    value === 'redact' ||
    value === 'block' ||
    value === 'allow' ||
    value === 'webhook'
    ? value
    : fallback;
}

function normalizeEnforcementAction(
  value: unknown,
  fallback: Exclude<GuardrailAction, 'allow'>,
): Exclude<GuardrailAction, 'allow'> {
  return value === 'audit' ||
    value === 'redact' ||
    value === 'block' ||
    value === 'webhook'
    ? value
    : fallback;
}

function normalizeSchemaAction(
  value: unknown,
  fallback: 'audit' | 'block' | 'webhook',
): 'audit' | 'block' | 'webhook' {
  return value === 'audit' || value === 'block' || value === 'webhook'
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
    value === 'api_key' ||
    value === 'ip_address' ||
    value === 'iban' ||
    value === 'passport'
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

function normalizeToolPolicy(
  cfg: ToolCallPolicyConfig | undefined,
  fallback: Exclude<GuardrailAction, 'allow'>,
):
  | (Required<Pick<ToolCallPolicyConfig, 'direction' | 'action' | 'severity'>> & {
      allowedTools: Set<string>;
      blockedTools: Set<string>;
      requireKnownTools: boolean;
    })
  | undefined {
  if (cfg?.enabled !== true) return undefined;
  const action =
    cfg.action === 'audit' || cfg.action === 'block' || cfg.action === 'webhook'
      ? cfg.action
      : fallback === 'redact'
        ? 'audit'
        : fallback;
  return {
    direction: normalizeDirection(cfg.direction),
    action,
    severity: normalizeSeverity(cfg.severity, 'high'),
    allowedTools: new Set((cfg.allowed_tools || []).map(normalizeToolName)),
    blockedTools: new Set((cfg.blocked_tools || []).map(normalizeToolName)),
    requireKnownTools: cfg.require_known_tools === true,
  };
}

function normalizeWebhookSink(value: WebhookSinkConfig | undefined): NormalizedWebhookSinkConfig {
  const url = typeof value?.url === 'string' && value.url.length > 0 ? value.url : undefined;
  const enabled = value?.enabled === true && Boolean(url);
  const includeActions = new Set<GuardrailAction>(
    Array.isArray(value?.include_actions) && value.include_actions.length > 0
      ? value.include_actions.filter(isGuardrailAction)
      : ['webhook'],
  );
  const maxQueue =
    typeof value?.max_queue === 'number' && Number.isFinite(value.max_queue)
      ? Math.max(1, Math.min(Math.floor(value.max_queue), 10_000))
      : 100;
  const attempts =
    typeof value?.retry?.attempts === 'number' && Number.isFinite(value.retry.attempts)
      ? Math.max(1, Math.min(Math.floor(value.retry.attempts), 10))
      : 3;
  const backoffMs =
    typeof value?.retry?.backoff_ms === 'number' && Number.isFinite(value.retry.backoff_ms)
      ? Math.max(0, Math.min(Math.floor(value.retry.backoff_ms), 60_000))
      : 1000;
  const timeoutMs =
    typeof value?.timeout_ms === 'number' && Number.isFinite(value.timeout_ms)
      ? Math.max(1, Math.min(Math.floor(value.timeout_ms), 60_000))
      : 5000;
  const debounceMs =
    typeof value?.debounce_seconds === 'number' && Number.isFinite(value.debounce_seconds)
      ? Math.max(0, Math.min(value.debounce_seconds, 3600)) * 1000
      : 300_000;
  return {
    enabled,
    configured: Boolean(url),
    url,
    headers: sanitizeWebhookHeaders(value?.headers),
    includeActions,
    debounceMs,
    attempts,
    backoffMs,
    timeoutMs,
    maxQueue,
    dropPolicy: value?.drop_policy === 'drop_oldest' ? 'drop_oldest' : 'drop_newest',
  };
}

function sanitizeWebhookHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string') headers[key] = child;
  }
  return headers;
}

function isGuardrailAction(value: unknown): value is GuardrailAction {
  return (
    value === 'audit' ||
    value === 'redact' ||
    value === 'block' ||
    value === 'allow' ||
    value === 'webhook'
  );
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase();
}

function safeToolName(value: string): string {
  return safeName(value, 'tool');
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map((item) => item.toLowerCase());
}

function isUnsafeUrl(
  value: string,
  options: {
    blockPrivateIps: boolean;
    allowedDomains: string[];
    blockedDomains: string[];
  },
): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (options.allowedDomains.length > 0 && !domainMatches(host, options.allowedDomains)) {
      return true;
    }
    if (domainMatches(host, options.blockedDomains)) return true;
    if (options.blockPrivateIps && isPrivateHost(host)) return true;
    return false;
  } catch {
    return true;
  }
}

function domainMatches(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
}

function isPrivateHost(host: string): boolean {
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function applyStrictSchemaDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...schema };
  if (
    copy.type === 'object' &&
    copy.additionalProperties === undefined &&
    copy.properties &&
    typeof copy.properties === 'object' &&
    !Array.isArray(copy.properties)
  ) {
    copy.additionalProperties = false;
  }
  if (copy.properties && typeof copy.properties === 'object' && !Array.isArray(copy.properties)) {
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties as Record<string, unknown>).map(([key, child]) => [
        key,
        child && typeof child === 'object' && !Array.isArray(child)
          ? applyStrictSchemaDefaults(child as Record<string, unknown>)
          : child,
      ]),
    );
  }
  if (copy.items && typeof copy.items === 'object' && !Array.isArray(copy.items)) {
    copy.items = applyStrictSchemaDefaults(copy.items as Record<string, unknown>);
  }
  return copy;
}

function sanitizeFinding(finding: GuardrailFinding): GuardrailFinding {
  return {
    request_id: finding.request_id,
    direction: finding.direction,
    kind: finding.kind,
    rule: finding.rule,
    action: finding.action,
    severity: finding.severity,
    path: finding.path,
    category: finding.category,
    match_count: finding.match_count,
    message: finding.message,
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
