import type {
  CanonicalContentBlock,
  CanonicalMessage,
} from '../../src/canonical/canonical.types';

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'bearer',
  'content',
  'headers',
  'messages',
  'password',
  'prompt',
  'providerapikey',
  'providerkey',
  'rawheaders',
  'requestbody',
  'response',
  'responsebody',
  'secret',
  'token',
];

export const SAFE_ANALYTICS_FIELDS = [
  'request_id',
  'timestamp',
  'source_format',
  'tier',
  'score',
  'node_id',
  'model',
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'cost_usd',
  'latency_ms',
  'status_code',
  'is_fallback',
  'fallback_reason',
  'session_key',
  'error',
  'api_key_name',
  'api_key_id',
  'retry_count',
  'experiment_group',
];

export function sanitizeForExternal(
  value: unknown,
  options: {
    allowedFields?: string[];
    includePromptResponse?: boolean;
    maxDepth?: number;
  } = {},
): unknown {
  const allowedFields = options.allowedFields
    ? new Set(options.allowedFields)
    : undefined;
  return sanitizeValue(value, {
    allowedFields,
    includePromptResponse: options.includePromptResponse === true,
    maxDepth: options.maxDepth ?? 8,
  });
}

function sanitizeValue(
  value: unknown,
  options: {
    allowedFields?: Set<string>;
    includePromptResponse: boolean;
    maxDepth: number;
  },
  key = '',
  depth = 0,
): unknown {
  if (isSensitiveKey(key) && !options.includePromptResponse) {
    return undefined;
  }
  if (depth > options.maxDepth) return '[truncated]';
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, options, key, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (depth === 0 && options.allowedFields && !options.allowedFields.has(childKey)) {
      continue;
    }
    const sanitized = sanitizeValue(childValue, options, childKey, depth + 1);
    if (sanitized !== undefined) {
      output[childKey] = sanitized;
    }
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return false;
  if (
    [
      'inputtokens',
      'outputtokens',
      'cachecreationinputtokens',
      'cachereadinputtokens',
      'totaltokens',
    ].includes(normalized)
  ) {
    return false;
  }
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) {
      output[key] = sortValue(child);
    }
  }
  return output;
}

export function canonicalMessageText(message: CanonicalMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n');
}

export function mapCanonicalMessageText(
  message: CanonicalMessage,
  mapper: (text: string) => string,
): CanonicalMessage {
  if (typeof message.content === 'string') {
    return { ...message, content: mapper(message.content) };
  }

  return {
    ...message,
    content: message.content.map((block): CanonicalContentBlock => {
      if (block.type !== 'text') return block;
      return { ...block, text: mapper(block.text) };
    }),
  };
}
