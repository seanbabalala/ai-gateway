import type { TokenUsage } from '../canonical/canonical.types';

export type UsageSchemaPath = string | string[];

export interface UsageSchema {
  input_tokens?: UsageSchemaPath;
  input_tokens_parts?: string[];
  output_tokens?: UsageSchemaPath;
  output_tokens_parts?: string[];
  total_tokens?: UsageSchemaPath;
  cache_read_input_tokens?: UsageSchemaPath;
  cache_creation_input_tokens?: UsageSchemaPath;
}

function resolvePathValue(
  source: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function resolveFirstValue(
  source: Record<string, unknown>,
  path: UsageSchemaPath | undefined,
): unknown {
  if (!path) return undefined;
  if (Array.isArray(path)) {
    for (const candidate of path) {
      const value = resolvePathValue(source, candidate);
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  }
  return resolvePathValue(source, path);
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function resolveNumber(
  source: Record<string, unknown>,
  path: UsageSchemaPath | undefined,
): number {
  return toFiniteNumber(resolveFirstValue(source, path));
}

function resolveNumberSum(
  source: Record<string, unknown>,
  paths: string[] | undefined,
): number {
  if (!paths || paths.length === 0) return 0;
  return paths.reduce((sum, path) => sum + resolveNumber(source, path), 0);
}

export function extractUsageBySchema(
  responseBody: Record<string, unknown>,
  schema: UsageSchema,
): TokenUsage {
  const cacheReadInputTokens = resolveNumber(
    responseBody,
    schema.cache_read_input_tokens,
  );
  const cacheCreationInputTokens = resolveNumber(
    responseBody,
    schema.cache_creation_input_tokens,
  );

  let inputTokens = resolveNumber(responseBody, schema.input_tokens);
  if (inputTokens <= 0) {
    inputTokens = resolveNumberSum(responseBody, schema.input_tokens_parts);
  }

  let outputTokens = resolveNumber(responseBody, schema.output_tokens);
  if (outputTokens <= 0) {
    outputTokens = resolveNumberSum(responseBody, schema.output_tokens_parts);
  }

  const totalTokens = resolveNumber(responseBody, schema.total_tokens);
  if (inputTokens <= 0 && totalTokens > 0 && outputTokens >= 0) {
    inputTokens = Math.max(0, totalTokens - outputTokens);
  }
  if (outputTokens <= 0 && totalTokens > 0 && inputTokens >= 0) {
    outputTokens = Math.max(0, totalTokens - inputTokens);
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
  };
}
