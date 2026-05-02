import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalRole,
} from '../../src/canonical/canonical.types';
import type {
  GatewayPlugin,
  HookContext,
  HookResult,
  PreRequestData,
} from '../../src/plugins/types';
import { mapCanonicalMessageText } from '../_shared/safety';

interface RequestTransformConfig {
  enabled?: boolean;
  rules?: TransformRule[];
}

interface TransformRule {
  name?: string;
  when?: {
    source_format?: string;
    api_key_name?: string;
    model?: string;
    stream?: boolean;
    has_tools?: boolean;
  };
  set?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    stop?: string[];
  };
  prepend_system?: string;
  append_system?: string;
  prepend_user?: string;
  append_user?: string;
  replacements?: ReplacementRule[];
}

interface ReplacementRule {
  pattern: string;
  with?: string;
  flags?: string;
  roles?: CanonicalRole[];
}

export default class RequestTransformPlugin implements GatewayPlugin {
  meta = {
    name: 'request-transform',
    version: '0.4.0',
    priority: 40,
  };

  private enabled = false;
  private rules: TransformRule[] = [];

  onLoad(config: Readonly<Record<string, unknown>>): void {
    const cfg = config as RequestTransformConfig;
    this.enabled = cfg.enabled === true;
    this.rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  }

  hooks = {
    preRequest: (
      ctx: HookContext<PreRequestData>,
    ): HookResult<PreRequestData> => {
      if (!this.enabled || this.rules.length === 0) return { unchanged: true };

      let request = cloneRequest(ctx.data.request);
      let changed = false;
      for (const rule of this.rules) {
        if (!matchesRule(request, rule)) continue;
        const next = applyRule(request, rule);
        changed = changed || next !== request;
        request = next;
      }

      return changed ? { request } : { unchanged: true };
    },
  };
}

function matchesRule(request: CanonicalRequest, rule: TransformRule): boolean {
  const when = rule.when;
  if (!when) return true;
  if (
    when.source_format &&
    when.source_format !== request.metadata.source_format
  ) {
    return false;
  }
  if (
    when.api_key_name &&
    when.api_key_name !== request.metadata.api_key_name
  ) {
    return false;
  }
  if (when.model && when.model !== (request.metadata.original_model || 'auto')) {
    return false;
  }
  if (typeof when.stream === 'boolean' && when.stream !== request.stream) {
    return false;
  }
  if (
    typeof when.has_tools === 'boolean' &&
    when.has_tools !== Boolean(request.tools?.length)
  ) {
    return false;
  }
  return true;
}

function applyRule(
  request: CanonicalRequest,
  rule: TransformRule,
): CanonicalRequest {
  let next = request;

  if (rule.set) {
    next = {
      ...next,
      temperature: numberOrExisting(rule.set.temperature, next.temperature),
      top_p: numberOrExisting(rule.set.top_p, next.top_p),
      max_tokens: integerOrExisting(rule.set.max_tokens, next.max_tokens),
      stop: Array.isArray(rule.set.stop)
        ? rule.set.stop.filter((item): item is string => typeof item === 'string')
        : next.stop,
    };
  }

  if (rule.prepend_system || rule.append_system) {
    next = {
      ...next,
      messages: transformSystemMessage(
        next.messages,
        rule.prepend_system,
        rule.append_system,
      ),
    };
  }

  if (rule.prepend_user || rule.append_user) {
    next = {
      ...next,
      messages: next.messages.map((message) =>
        message.role === 'user'
          ? wrapText(message, rule.prepend_user, rule.append_user)
          : message,
      ),
    };
  }

  if (Array.isArray(rule.replacements) && rule.replacements.length > 0) {
    next = {
      ...next,
      messages: next.messages.map((message) =>
        applyReplacements(message, rule.replacements || []),
      ),
    };
  }

  return next;
}

function transformSystemMessage(
  messages: CanonicalMessage[],
  prefix?: string,
  suffix?: string,
): CanonicalMessage[] {
  const index = messages.findIndex((message) => message.role === 'system');
  if (index === -1) {
    return [
      {
        role: 'system',
        content: [prefix, suffix].filter(Boolean).join('\n'),
      },
      ...messages,
    ];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index ? wrapText(message, prefix, suffix) : message,
  );
}

function wrapText(
  message: CanonicalMessage,
  prefix?: string,
  suffix?: string,
): CanonicalMessage {
  return mapCanonicalMessageText(message, (text) =>
    [prefix, text, suffix].filter(Boolean).join('\n'),
  );
}

function applyReplacements(
  message: CanonicalMessage,
  replacements: ReplacementRule[],
): CanonicalMessage {
  const active = replacements.filter((rule) =>
    !rule.roles || rule.roles.includes(message.role),
  );
  if (active.length === 0) return message;

  return mapCanonicalMessageText(message, (text) => {
    let output = text;
    for (const rule of active) {
      if (!rule.pattern) continue;
      const flags = rule.flags || 'g';
      try {
        output = output.replace(new RegExp(rule.pattern, flags), rule.with || '');
      } catch {
        continue;
      }
    }
    return output;
  });
}

function cloneRequest(request: CanonicalRequest): CanonicalRequest {
  return {
    ...request,
    metadata: {
      ...request.metadata,
      raw_headers: { ...request.metadata.raw_headers },
    },
    messages: request.messages.map((message) => ({ ...message })),
    tools: request.tools?.map((tool) => ({ ...tool })),
    stop: request.stop ? [...request.stop] : undefined,
  };
}

function numberOrExisting(
  value: unknown,
  existing: number | undefined,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : existing;
}

function integerOrExisting(
  value: unknown,
  existing: number | undefined,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : existing;
}
