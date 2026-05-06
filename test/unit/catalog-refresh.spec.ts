import { refreshCatalogProvider } from '../../src/catalog/catalog-refresh';

function canonicalRegistry(models: any[]) {
  return {
    version: 1 as const,
    primary_source: 'openrouter',
    source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
    generated_at: '2026-05-06T00:00:00.000Z',
    model_count: models.length,
    models,
  };
}

function canonicalModel(input: {
  canonical_id: string;
  source_model_id?: string;
  source_provider_slug: string;
  display_name?: string;
  canonical_slug?: string;
  created?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  pricing_reference?: Record<string, unknown>;
}) {
  return {
    canonical_id: input.canonical_id,
    source_model_id: input.source_model_id || input.canonical_id,
    source_provider_slug: input.source_provider_slug,
    display_name: input.display_name || input.canonical_id,
    canonical_slug: input.canonical_slug || input.canonical_id,
    created: input.created,
    input_modalities: input.input_modalities || ['text'],
    output_modalities: input.output_modalities || ['text'],
    supported_parameters: input.supported_parameters || [],
    pricing_reference: input.pricing_reference,
    source_metadata: {
      source: 'openrouter-public-api',
      source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      synced_at: '2026-05-06T00:00:00.000Z',
      dataset_role: 'canonical_primary',
    },
  };
}

describe('catalog refresh adapters', () => {
  it('materializes OpenRouter payload into a canonical registry plus compatible openrouter provider models', async () => {
    const result = await refreshCatalogProvider({
      provider: 'openrouter',
      now: new Date('2026-05-06T00:00:00.000Z'),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'openai/gpt-chat-latest',
              canonical_slug: 'openai/gpt-chat-latest-20260505',
              name: 'OpenAI: GPT Chat Latest',
              description: 'Latest GPT chat model',
              created: 1778000212,
              context_length: 400000,
              architecture: {
                modality: 'text+image+file->text',
                input_modalities: ['text', 'image', 'file'],
                output_modalities: ['text'],
                tokenizer: 'GPT',
                instruct_type: null,
              },
              pricing: {
                prompt: '0.000005',
                completion: '0.00003',
                input_cache_read: '0.0000005',
                web_search: '0.01',
              },
              top_provider: {
                context_length: 400000,
                max_completion_tokens: 128000,
                is_moderated: true,
              },
              supported_parameters: ['tools', 'response_format', 'max_tokens'],
              default_parameters: {
                temperature: null,
                top_p: null,
              },
              links: {
                details: '/api/v1/models/openai/gpt-chat-latest-20260505/endpoints',
              },
            },
          ],
        }),
      })) as unknown as typeof fetch,
    });

    expect(result.provider).toBe('openrouter');
    expect(result.model_count).toBe(1);
    expect(result.priced_model_count).toBe(1);
    expect(result.canonical_model_count).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.override._siftgate_internal?.canonical_registry).toMatchObject({
      version: 1,
      primary_source: 'openrouter',
      source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      generated_at: '2026-05-06T00:00:00.000Z',
      model_count: 1,
      models: [
        {
          canonical_id: 'openai/gpt-chat-latest-20260505',
          source_model_id: 'openai/gpt-chat-latest',
          source_provider_slug: 'openai',
          display_name: 'OpenAI: GPT Chat Latest',
          aliases: ['openai/gpt-chat-latest'],
          canonical_slug: 'openai/gpt-chat-latest-20260505',
          context_length: 400000,
          architecture: {
            modality: 'text+image+file->text',
            input_modalities: ['text', 'image', 'file'],
            output_modalities: ['text'],
            tokenizer: 'GPT',
            instruct_type: null,
          },
          supported_parameters: ['tools', 'response_format', 'max_tokens'],
          pricing_reference: expect.objectContaining({
            input: 5,
            output: 30,
            cache_read_input: 0.5,
            source: 'openrouter-public-api',
            source_type: 'aggregator_api',
            manual_review_required: true,
            pricing_confidence: 'medium',
          }),
          top_provider: {
            context_length: 400000,
            max_completion_tokens: 128000,
            is_moderated: true,
          },
          created: '2026-05-05T16:56:52.000Z',
          source_metadata: {
            source: 'openrouter-public-api',
            source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
            synced_at: '2026-05-06T00:00:00.000Z',
            dataset_role: 'canonical_primary',
          },
          metadata: {
            additional_pricing: { web_search: '0.01' },
            links: {
              details: '/api/v1/models/openai/gpt-chat-latest-20260505/endpoints',
            },
          },
        },
      ],
    });
    expect(result.override.providers).toMatchObject({
      openrouter: {
        id: 'openrouter',
        models: [
          {
            id: 'openai/gpt-chat-latest',
            display_name: 'OpenAI: GPT Chat Latest',
            modalities: ['text', 'vision'],
            pricing: expect.objectContaining({
              input: 5,
              output: 30,
              cache_read_input: 0.5,
              source: 'openrouter-public-api',
              manual_review_required: false,
              pricing_confidence: 'high',
            }),
          },
        ],
      },
    });
  });

  it('enriches canonical models from ZeroEval and projects provider rows with OpenRouter-primary pricing plus ZeroEval secondary pricing', async () => {
    const result = await refreshCatalogProvider({
      provider: 'zeroeval',
      now: new Date('2026-05-06T00:00:00.000Z'),
      canonicalRegistry: canonicalRegistry([
        canonicalModel({
          canonical_id: 'openai/gpt-4o',
          source_provider_slug: 'openai',
          display_name: 'OpenAI: GPT-4o',
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
          supported_parameters: ['tools', 'response_format'],
          pricing_reference: {
            input: 5,
            output: 15,
            input_per_1m_tokens: 5,
            output_per_1m_tokens: 15,
            source: 'openrouter-public-api',
            source_type: 'aggregator_api',
            source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
            last_updated: '2026-05-06',
            last_sync: '2026-05-06T00:00:00.000Z',
            retrieved_at: '2026-05-06T00:00:00.000Z',
            last_verified_at: '2026-05-06T00:00:00.000Z',
            manual_review_required: true,
            stale_after_days: 7,
            pricing_confidence: 'medium',
            currency: 'USD',
          },
        }),
      ]),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ([
          {
            model_id: 'chatgpt-4o-latest',
            name: 'ChatGPT-4o Latest',
            organization: 'OpenAI',
            organization_id: 'openai',
            context: 128000,
            release_date: '2024-05-13',
            announcement_date: '2024-05-13',
            knowledge_cutoff: '2024-01-01',
            multimodal: true,
            input_price: 2.5,
            output_price: 10,
            throughput: 132,
            params: 200000000000,
            training_tokens: 3000000000000,
            is_moe: false,
            gpqa_score: 0.84,
          },
        ]),
      })) as unknown as typeof fetch,
    });

    expect(result.provider).toBe('zeroeval');
    expect(result.model_count).toBe(1);
    expect(result.priced_model_count).toBe(1);
    expect(result.canonical_model_count).toBe(1);
    expect(result.matched_model_count).toBe(1);
    expect(result.projected_model_count).toBe(1);
    expect(result.low_confidence_match_count).toBe(0);
    expect(result.unmatched_model_count).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.override.providers).toMatchObject({
      openai: {
        id: 'openai',
        models: [
          {
            id: 'gpt-4o',
            display_name: 'ChatGPT-4o Latest',
            limits: { max_context_tokens: 128000 },
            pricing: expect.objectContaining({
              input: 5,
              output: 15,
              source: 'openrouter-public-api',
              source_type: 'aggregator_api',
              manual_review_required: true,
              pricing_confidence: 'medium',
            }),
            enrichment: expect.objectContaining({
              source: 'zeroeval',
              enriched_from: 'zeroeval',
              match_strategy: 'explicit_alias',
              match_confidence: 'high',
              organization: 'OpenAI',
              organization_id: 'openai',
              canonical_model_id: 'openai/gpt-4o',
              release_date: '2024-05-13',
              announcement_date: '2024-05-13',
              multimodal: true,
              throughput: 132,
              lifecycle: expect.objectContaining({
                release_date: '2024-05-13',
                announcement_date: '2024-05-13',
                knowledge_cutoff: '2024-01-01',
              }),
              specs: expect.objectContaining({
                throughput: 132,
                multimodal: true,
                params: 200000000000,
                training_tokens: 3000000000000,
                is_moe: false,
              }),
              benchmarks: expect.objectContaining({
                gpqa_score: 0.84,
              }),
              secondary_pricing_reference: expect.objectContaining({
                input: 2.5,
                output: 10,
                source: 'zeroeval',
                source_type: 'aggregator_api',
                manual_review_required: true,
                pricing_confidence: 'medium',
              }),
            }),
          },
        ],
      },
    });
    expect(result.override._siftgate_internal?.canonical_registry?.models[0]).toMatchObject({
      canonical_id: 'openai/gpt-4o',
      enrichment: expect.objectContaining({
        source: 'zeroeval',
        match_strategy: 'explicit_alias',
        secondary_pricing_reference: expect.objectContaining({
          input: 2.5,
          output: 10,
          source: 'zeroeval',
        }),
      }),
    });
    expect(result.override._siftgate_internal?.diagnostics?.zeroeval_overlay).toMatchObject({
      matched_model_count: 1,
      projected_model_count: 1,
      high_confidence_match_count: 1,
      low_confidence_match_count: 0,
      unmatched_model_count: 0,
    });
  });

  it('keeps low-confidence duplicate-family matches out of projections and records diagnostics instead', async () => {
    const result = await refreshCatalogProvider({
      provider: 'zeroeval',
      now: new Date('2026-05-06T00:00:00.000Z'),
      canonicalRegistry: canonicalRegistry([
        canonicalModel({
          canonical_id: 'anthropic/claude-sonnet-4.6-a',
          source_model_id: 'anthropic/claude-sonnet-4.6',
          source_provider_slug: 'anthropic',
          display_name: 'Anthropic: Claude Sonnet 4.6 A',
        }),
        canonicalModel({
          canonical_id: 'anthropic/claude-sonnet-4.6-b',
          source_model_id: 'anthropic/claude-4.6-sonnet',
          source_provider_slug: 'anthropic',
          display_name: 'Anthropic: Claude Sonnet 4.6 B',
        }),
      ]),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ([
          {
            model_id: 'claude-sonnet-4-6',
            name: 'Claude Sonnet 4.6',
            organization: 'Anthropic',
            organization_id: 'anthropic',
            input_price: 3,
            output_price: 15,
          },
        ]),
      })) as unknown as typeof fetch,
    });

    expect(result.model_count).toBe(0);
    expect(result.priced_model_count).toBe(0);
    expect(result.matched_model_count).toBe(0);
    expect(result.low_confidence_match_count).toBe(1);
    expect(result.ambiguous_match_count).toBe(1);
    expect(result.override.providers).toEqual({});
    expect(result.override._siftgate_internal?.canonical_registry?.models).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          enrichment: expect.any(Object),
        }),
      ]),
    );
    expect(result.override._siftgate_internal?.diagnostics?.zeroeval_overlay).toMatchObject({
      low_confidence_match_count: 1,
      ambiguous_match_count: 1,
      low_confidence_matches: [
        expect.objectContaining({
          model_id: 'claude-sonnet-4-6',
          match_strategy: 'ambiguous_candidate',
          match_confidence: 'low',
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'catalog_refresh_empty' }),
        expect.objectContaining({
          code: 'catalog_refresh_zeroeval_low_confidence_matches',
        }),
      ]),
    );
  });

  it('fails clearly when ZeroEval refresh runs without a canonical registry', async () => {
    const result = await refreshCatalogProvider({
      provider: 'zeroeval',
      now: new Date('2026-05-06T00:00:00.000Z'),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ([]),
      })) as unknown as typeof fetch,
    });

    expect(result.model_count).toBe(0);
    expect(result.override.providers).toEqual({});
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'catalog_refresh_zeroeval_missing_canonical_registry',
          severity: 'error',
        }),
      ]),
    );
  });
});
