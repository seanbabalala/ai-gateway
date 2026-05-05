import { BUILTIN_PROVIDER_CATALOG } from '../../src/catalog/built-in-catalog';
import {
  getCompatibilityProfile,
  resolveNodeUsageSchema,
} from '../../src/catalog/compatibility-profiles';
import { extractUsageBySchema } from '../../src/providers/usage-schema-resolver';

describe('usage schema registry', () => {
  it('extracts Gemini OpenAI-compatible cache fields from the registry-selected schema', () => {
    const schema = resolveNodeUsageSchema(
      {
        id: 'google',
        protocol: 'chat_completions',
        base_url: 'https://generativelanguage.googleapis.com',
      } as any,
      'chat_completions',
      {
        version: 1,
        generated_at: '2026-05-05',
        providers: BUILTIN_PROVIDER_CATALOG,
      },
    );

    expect(schema?.cache_read_input_tokens).toBe(
      'usage.prompt_tokens_details.cached_tokens',
    );

    const usage = extractUsageBySchema(
      {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 12,
          total_tokens: 112,
          prompt_tokens_details: { cached_tokens: 60 },
        },
      },
      schema!,
    );

    expect(usage).toEqual({
      input_tokens: 100,
      output_tokens: 12,
      cache_read_input_tokens: 60,
      cache_creation_input_tokens: 0,
    });
  });

  it('extracts OpenAI Responses cache fields with prompt_tokens_details and legacy fallback paths', () => {
    const schema =
      getCompatibilityProfile('openai_responses_compatible')?.usage_schema
        ?.responses;

    const modern = extractUsageBySchema(
      {
        usage: {
          input_tokens: 44,
          output_tokens: 8,
          prompt_tokens_details: { cached_tokens: 20 },
        },
      },
      schema!,
    );
    expect(modern.cache_read_input_tokens).toBe(20);

    const legacy = extractUsageBySchema(
      {
        usage: {
          input_tokens: 44,
          output_tokens: 8,
          input_token_details: { cached_tokens: 11 },
        },
      },
      schema!,
    );
    expect(legacy.cache_read_input_tokens).toBe(11);
  });

  it('sums Anthropic-compatible cache creation and cache read tokens into canonical input_tokens', () => {
    const schema =
      getCompatibilityProfile('anthropic_messages_compatible')?.usage_schema
        ?.messages;

    const usage = extractUsageBySchema(
      {
        usage: {
          input_tokens: 21,
          output_tokens: 393,
          cache_creation_input_tokens: 188086,
          cache_read_input_tokens: 0,
        },
      },
      schema!,
    );

    expect(usage).toEqual({
      input_tokens: 188107,
      output_tokens: 393,
      cache_creation_input_tokens: 188086,
      cache_read_input_tokens: 0,
    });
  });

  it('extracts Gemini native usageMetadata cache counters', () => {
    const schema =
      getCompatibilityProfile('google_gemini_compatible')?.usage_schema
        ?.gemini_generate_content;

    const usage = extractUsageBySchema(
      {
        usageMetadata: {
          promptTokenCount: 1500,
          cachedContentTokenCount: 1200,
          candidatesTokenCount: 40,
          totalTokenCount: 1540,
        },
      },
      schema!,
    );

    expect(usage).toEqual({
      input_tokens: 1500,
      output_tokens: 40,
      cache_read_input_tokens: 1200,
      cache_creation_input_tokens: 0,
    });
  });

  it('extracts DeepSeek cache hit/miss counters when prompt_tokens is absent', () => {
    const schema =
      getCompatibilityProfile('deepseek_compatible')?.usage_schema
        ?.chat_completions;

    const usage = extractUsageBySchema(
      {
        usage: {
          completion_tokens: 50,
          total_tokens: 5050,
          prompt_cache_hit_tokens: 4000,
          prompt_cache_miss_tokens: 1000,
        },
      },
      schema!,
    );

    expect(usage).toEqual({
      input_tokens: 5000,
      output_tokens: 50,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 0,
    });
  });

  it('extracts Cohere usage from billed_units, tokens, and cached_tokens', () => {
    const schema =
      getCompatibilityProfile('cohere_compatible')?.usage_schema
        ?.chat_completions;

    const usage = extractUsageBySchema(
      {
        usage: {
          billed_units: { input_tokens: 6772, output_tokens: 248 },
          tokens: { input_tokens: 7596, output_tokens: 645 },
          cached_tokens: 512,
        },
      },
      schema!,
    );

    expect(usage).toEqual({
      input_tokens: 6772,
      output_tokens: 248,
      cache_read_input_tokens: 512,
      cache_creation_input_tokens: 0,
    });
  });

  it('falls back to zero when the declared fields are missing', () => {
    const schema =
      getCompatibilityProfile('openai_compatible')?.usage_schema
        ?.chat_completions;

    expect(extractUsageBySchema({}, schema!)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});
