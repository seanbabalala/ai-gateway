import type {
  CanonicalResponseFormat,
  CanonicalStructuredOutput,
  SourceFormat,
  StructuredOutputFormatType,
  StructuredOutputSource,
  StructuredOutputStrategy,
} from './canonical.types';
import type { NodeProtocol } from '../config/gateway.config';

export interface StructuredOutputFields {
  response_format?: CanonicalResponseFormat;
  structured_output?: CanonicalStructuredOutput;
}

export interface StructuredOutputForwarding {
  requested: boolean;
  type: StructuredOutputFormatType | null;
  strategy: StructuredOutputStrategy | null;
  supported: boolean | null;
  schema_name: string | null;
  reason: string | null;
}

export function normalizeStructuredOutputFromBody(
  sourceFormat: SourceFormat,
  body: Record<string, unknown>,
): StructuredOutputFields {
  const responseFormat = extractResponseFormat(sourceFormat, body);
  if (!responseFormat) return {};

  const structuredOutput =
    responseFormat.type === 'json_object' || responseFormat.type === 'json_schema'
      ? {
          requested: true,
          type: responseFormat.type,
          source: responseFormat.source,
          name: responseFormat.json_schema?.name,
          schema: responseFormat.json_schema?.schema,
          strict: responseFormat.json_schema?.strict,
        }
      : undefined;

  return {
    response_format: responseFormat,
    structured_output: structuredOutput,
  };
}

export function toOpenAiChatResponseFormat(
  format?: CanonicalResponseFormat,
): unknown {
  if (!format) return undefined;
  if (format.source === 'chat_completions.response_format') {
    return clone(format.raw);
  }
  if (format.type === 'json_object') {
    return { type: 'json_object' };
  }
  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: compactObject({
        name: format.json_schema?.name || 'response',
        description: format.json_schema?.description,
        schema: format.json_schema?.schema || {},
        strict: format.json_schema?.strict,
      }),
    };
  }
  if (format.type === 'text') {
    return { type: 'text' };
  }
  return undefined;
}

export function toOpenAiResponsesTextFormat(
  format?: CanonicalResponseFormat,
): unknown {
  if (!format) return undefined;
  if (format.source === 'responses.text.format') {
    return clone(format.raw);
  }
  if (format.type === 'json_object') {
    return { type: 'json_object' };
  }
  if (format.type === 'json_schema') {
    return compactObject({
      type: 'json_schema',
      name: format.json_schema?.name || 'response',
      description: format.json_schema?.description,
      schema: format.json_schema?.schema || {},
      strict: format.json_schema?.strict,
    });
  }
  if (format.type === 'text') {
    return { type: 'text' };
  }
  return undefined;
}

export function toAnthropicMessagesOutputFormat(
  format?: CanonicalResponseFormat,
): Record<string, unknown> | undefined {
  if (!format) return undefined;
  if (
    format.source === 'messages.output_config.format' ||
    format.source === 'messages.output_format'
  ) {
    return clone(format.raw) as Record<string, unknown>;
  }
  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      schema: format.json_schema?.schema || {},
    };
  }
  if (format.type === 'json_object') {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    };
  }
  return undefined;
}

export function resolveStructuredOutputForwarding(
  format: CanonicalResponseFormat | undefined,
  sourceFormat: SourceFormat,
  targetProtocol: NodeProtocol | undefined,
  declaredSupport: boolean | null | undefined,
): StructuredOutputForwarding {
  if (!format || (format.type !== 'json_object' && format.type !== 'json_schema')) {
    return {
      requested: false,
      type: null,
      strategy: null,
      supported: null,
      schema_name: null,
      reason: null,
    };
  }

  if (!targetProtocol) {
    return {
      requested: true,
      type: format.type,
      strategy: 'none',
      supported: null,
      schema_name: format.json_schema?.name || null,
      reason: 'target protocol is unavailable',
    };
  }

  const passthrough =
    (sourceFormat === 'chat_completions' && targetProtocol === 'chat_completions') ||
    (sourceFormat === 'responses' && targetProtocol === 'responses') ||
    (
      sourceFormat === 'messages' &&
      targetProtocol === 'messages' &&
      (format.source === 'messages.output_config.format' ||
        format.source === 'messages.output_format')
    );

  const mappable =
    targetProtocol === 'chat_completions' ||
    targetProtocol === 'responses' ||
    targetProtocol === 'messages';

  if (!mappable) {
    return {
      requested: true,
      type: format.type,
      strategy: 'downgraded',
      supported: false,
      schema_name: format.json_schema?.name || null,
      reason: `target protocol ${targetProtocol} has no structured-output mapping`,
    };
  }

  return {
    requested: true,
    type: format.type,
    strategy: passthrough ? 'passthrough' : 'native',
    supported: declaredSupport === false ? false : true,
    schema_name: format.json_schema?.name || null,
    reason:
      declaredSupport === false
        ? 'target declares structured_output=false'
        : null,
  };
}

export function structuredOutputSchema(
  format?: CanonicalResponseFormat,
): Record<string, unknown> | undefined {
  return format?.type === 'json_schema' ? format.json_schema?.schema : undefined;
}

function extractResponseFormat(
  sourceFormat: SourceFormat,
  body: Record<string, unknown>,
): CanonicalResponseFormat | undefined {
  if (sourceFormat === 'chat_completions') {
    return normalizeOpenAiChatFormat(
      body.response_format,
      'chat_completions.response_format',
    );
  }

  if (sourceFormat === 'responses') {
    const text = asRecord(body.text);
    return (
      normalizeOpenAiResponsesFormat(text?.format, 'responses.text.format') ||
      normalizeOpenAiChatFormat(body.response_format, 'chat_completions.response_format')
    );
  }

  if (sourceFormat === 'messages') {
    const outputConfig = asRecord(body.output_config);
    return (
      normalizeAnthropicMessagesFormat(
        outputConfig?.format,
        'messages.output_config.format',
      ) ||
      normalizeAnthropicMessagesFormat(
        body.output_format,
        'messages.output_format',
      ) ||
      normalizeOpenAiChatFormat(body.response_format, 'chat_completions.response_format')
    );
  }

  return undefined;
}

function normalizeOpenAiChatFormat(
  value: unknown,
  source: StructuredOutputSource,
): CanonicalResponseFormat | undefined {
  const format = asRecord(value);
  if (!format) return undefined;
  const type = normalizeFormatType(format.type);
  if (type === 'json_schema') {
    const jsonSchema = asRecord(format.json_schema) || {};
    return {
      type,
      source,
      raw: clone(format),
      json_schema: compactObject({
        name: stringOrUndefined(jsonSchema.name),
        description: stringOrUndefined(jsonSchema.description),
        schema: asRecord(jsonSchema.schema),
        strict: booleanOrUndefined(jsonSchema.strict),
      }),
    };
  }
  return {
    type,
    source,
    raw: clone(format),
  };
}

function normalizeOpenAiResponsesFormat(
  value: unknown,
  source: StructuredOutputSource,
): CanonicalResponseFormat | undefined {
  const format = asRecord(value);
  if (!format) return undefined;
  const type = normalizeFormatType(format.type);
  if (type === 'json_schema') {
    return {
      type,
      source,
      raw: clone(format),
      json_schema: compactObject({
        name: stringOrUndefined(format.name),
        description: stringOrUndefined(format.description),
        schema: asRecord(format.schema),
        strict: booleanOrUndefined(format.strict),
      }),
    };
  }
  return {
    type,
    source,
    raw: clone(format),
  };
}

function normalizeAnthropicMessagesFormat(
  value: unknown,
  source: StructuredOutputSource,
): CanonicalResponseFormat | undefined {
  const format = asRecord(value);
  if (!format) return undefined;
  const type = normalizeFormatType(format.type);
  if (type === 'json_schema') {
    return {
      type,
      source,
      raw: clone(format),
      json_schema: compactObject({
        name: stringOrUndefined(format.name),
        description: stringOrUndefined(format.description),
        schema: asRecord(format.schema),
        strict: booleanOrUndefined(format.strict),
      }),
    };
  }
  return {
    type,
    source,
    raw: clone(format),
  };
}

function normalizeFormatType(value: unknown): StructuredOutputFormatType {
  if (value === 'text') return 'text';
  if (value === 'json_object') return 'json_object';
  if (value === 'json_schema') return 'json_schema';
  return 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function clone(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
