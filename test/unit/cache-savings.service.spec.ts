import { CacheSavingsService } from '../../src/dashboard/cache-savings.service';

describe('CacheSavingsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-06T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeService(rows: any[]) {
    const callLogRepo = {
      find: jest.fn().mockResolvedValue(rows),
    };
    const config = {
      getModelPricing: jest.fn().mockImplementation((model: string) => {
        if (model === 'gpt-4o') {
          return {
            input: 2,
            output: 10,
            cache_read_input: 1,
            cache_creation_input: 2.5,
          };
        }
        if (model === 'deepseek-chat') {
          return {
            input: 2,
            output: 10,
            cache_read_input: 1,
            cache_creation_input: 2.5,
          };
        }
        return undefined;
      }),
    };

    return {
      service: new CacheSavingsService(
        callLogRepo as any,
        config as any,
        { currentWorkspaceId: jest.fn(() => 'default-workspace') } as any,
      ),
      callLogRepo,
    };
  }

  it('aggregates provider cache hits, savings, and daily trend while excluding local cache rows from provider costs', async () => {
    const rows = [
      {
        request_id: 'req_provider_hit',
        timestamp: new Date('2026-05-06T01:00:00Z'),
        node_id: 'openai',
        model: 'gpt-4o',
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 100,
        cost_usd: 0.00365,
        cost_without_cache_usd: 0.004,
        api_key_id: 'key_1',
        api_key_name: 'default',
        namespace_id: 'team-a',
        team_id: 'ops',
      },
      {
        request_id: 'req_provider_miss',
        timestamp: new Date('2026-05-05T02:00:00Z'),
        node_id: 'deepseek',
        model: 'deepseek-chat',
        input_tokens: 500,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: 0.002,
        cost_without_cache_usd: 0.002,
        api_key_id: 'key_1',
        api_key_name: 'default',
        namespace_id: 'team-a',
        team_id: 'ops',
      },
      {
        request_id: 'req_local_cache',
        timestamp: new Date('2026-05-05T03:00:00Z'),
        node_id: 'cache',
        model: 'gpt-4o',
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: 0,
        cost_without_cache_usd: 0.004,
        api_key_id: 'key_1',
        api_key_name: 'default',
        namespace_id: 'team-a',
        team_id: 'ops',
      },
    ];
    const { service, callLogRepo } = makeService(rows);

    const result = await service.getSummary('7d', 'node', {
      api_key_id: 'key_1',
      namespace: 'team-a',
    });

    expect(callLogRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { timestamp: 'ASC' },
        where: expect.objectContaining({
          api_key_id: 'key_1',
          namespace_id: 'team-a',
        }),
      }),
    );
    expect(result.summary).toMatchObject({
      total_requests: 3,
      provider_routed_requests: 2,
      requests_with_provider_cache_hit: 1,
      cache_hit_rate: 50,
      total_input_tokens: 1500,
      total_output_tokens: 300,
      total_cache_read_tokens: 400,
      total_cache_creation_tokens: 100,
      total_normal_input_tokens: 1000,
      actual_cost_usd: 0.00565,
      hypothetical_no_cache_cost_usd: 0.006,
      savings_usd: 0.00035,
      savings_percentage: 5.83,
      normal_input_cost_usd: 0.002,
      cache_read_cost_usd: 0.0004,
      cache_creation_cost_usd: 0.00025,
      output_cost_usd: 0.003,
    });
    expect(result.groups).toEqual([
      expect.objectContaining({
        group_value: 'openai',
        total_requests: 1,
        requests_with_provider_cache_hit: 1,
        savings_usd: 0.00035,
      }),
      expect.objectContaining({
        group_value: 'deepseek',
        total_requests: 1,
        requests_with_provider_cache_hit: 0,
        savings_usd: 0,
      }),
    ]);
    expect(result.daily_trend).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-05-05',
          total_requests: 2,
          provider_routed_requests: 1,
          requests_with_provider_cache_hit: 0,
          actual_cost_usd: 0.002,
        }),
        expect.objectContaining({
          date: '2026-05-06',
          total_requests: 1,
          provider_routed_requests: 1,
          requests_with_provider_cache_hit: 1,
          savings_usd: 0.00035,
        }),
      ]),
    );
  });

  it('falls back to current pricing when old rows do not have cost_without_cache_usd yet', async () => {
    const rows = [
      {
        request_id: 'req_legacy',
        timestamp: new Date('2026-05-06T01:00:00Z'),
        node_id: 'openai',
        model: 'gpt-4o',
        input_tokens: 800,
        output_tokens: 100,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 0,
        cost_usd: 0,
        cost_without_cache_usd: null,
      },
    ];
    const { service } = makeService(rows);

    const result = await service.getSummary('1d', 'model');

    expect(result.summary).toMatchObject({
      total_requests: 1,
      provider_routed_requests: 1,
      requests_with_provider_cache_hit: 1,
      actual_cost_usd: 0.0023,
      hypothetical_no_cache_cost_usd: 0.0026,
      savings_usd: 0.0003,
    });
  });

  it('supports api_key grouping and returns zeroed trends when there is no data', async () => {
    const { service } = makeService([]);

    const result = await service.getSummary('7d', 'api_key');

    expect(result.groups).toEqual([]);
    expect(result.summary).toMatchObject({
      total_requests: 0,
      provider_routed_requests: 0,
      requests_with_provider_cache_hit: 0,
      savings_usd: 0,
    });
    expect(result.daily_trend).toHaveLength(7);
    expect(result.daily_trend[0]).toMatchObject({
      total_requests: 0,
      provider_routed_requests: 0,
      requests_with_provider_cache_hit: 0,
      actual_cost_usd: 0,
    });
  });
});
