import { refreshCatalogProvider } from '../../src/catalog/catalog-refresh';

describe('catalog refresh adapters', () => {
  it('maps ZeroEval model metadata into built-in provider/model enrichments', async () => {
    const result = await refreshCatalogProvider({
      provider: 'zeroeval',
      now: new Date('2026-05-06T00:00:00.000Z'),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ([
          {
            model_id: 'gpt-4o',
            name: 'ChatGPT-4o Latest',
            organization: 'OpenAI',
            organization_id: 'openai',
            context: 128000,
            release_date: '2024-05-13',
            announcement_date: '2024-05-13',
            multimodal: true,
            input_price: 2.5,
            output_price: 10,
            throughput: 132,
            canonical_model_id: 'chatgpt-4o-latest',
            gpqa_score: 0.84,
          },
        ]),
      })) as unknown as typeof fetch,
    });

    expect(result.provider).toBe('zeroeval');
    expect(result.model_count).toBe(1);
    expect(result.priced_model_count).toBe(1);
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
              input: 2.5,
              output: 10,
              source: 'zeroeval',
              source_type: 'aggregator_api',
              source_url:
                'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
              manual_review_required: true,
              pricing_confidence: 'medium',
            }),
            enrichment: expect.objectContaining({
              source: 'zeroeval',
              enriched_from: 'zeroeval',
              organization: 'OpenAI',
              organization_id: 'openai',
              canonical_model_id: 'chatgpt-4o-latest',
              release_date: '2024-05-13',
              announcement_date: '2024-05-13',
              multimodal: true,
              throughput: 132,
              lifecycle: expect.objectContaining({
                release_date: '2024-05-13',
                announcement_date: '2024-05-13',
              }),
              specs: expect.objectContaining({
                throughput: 132,
                multimodal: true,
              }),
              benchmarks: expect.objectContaining({
                gpqa_score: 0.84,
              }),
            }),
          },
        ],
      },
    });
  });

  it('skips unmapped organizations and unknown built-in models when refreshing ZeroEval', async () => {
    const result = await refreshCatalogProvider({
      provider: 'zeroeval',
      now: new Date('2026-05-06T00:00:00.000Z'),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ([
          {
            model_id: 'totally-unknown',
            name: 'Unknown',
            organization: 'OpenAI',
            organization_id: 'openai',
          },
          {
            model_id: 'mystery-1',
            name: 'Mystery 1',
            organization: 'Mystery Labs',
            organization_id: 'mystery',
          },
        ]),
      })) as unknown as typeof fetch,
    });

    expect(result.model_count).toBe(0);
    expect(result.override.providers).toEqual({});
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'catalog_refresh_empty',
        }),
        expect.objectContaining({
          code: 'catalog_refresh_zeroeval_unmapped_organizations',
        }),
        expect.objectContaining({
          code: 'catalog_refresh_zeroeval_unknown_models',
        }),
      ]),
    );
  });
});
