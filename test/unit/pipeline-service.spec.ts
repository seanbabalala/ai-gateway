/**
 * PipelineService unit tests.
 *
 * Tests resolveSmartRoute (via process), budget enforcement,
 * cache integration, retry logic, and error formatting.
 *
 * Uses heavy mocking since PipelineService has 10 dependencies.
 */

import { PipelineService } from '../../src/pipeline/pipeline.service';
import { ProviderError } from '../../src/providers/provider-client.service';
import { BudgetExceededError } from '../../src/budget/budget.service';
import { makeRequest, makeCanonicalResponse, mockConfigService } from '../helpers';

function makePipeline(overrides: Record<string, any> = {}): {
  pipeline: PipelineService;
  mocks: Record<string, any>;
} {
  const config = mockConfigService({
    nodes: [
      {
        id: 'openai', name: 'OpenAI', protocol: 'chat_completions',
        models: ['gpt-4o', 'gpt-4o-mini'], model_aliases: {},
      },
      {
        id: 'claude', name: 'Claude', protocol: 'messages',
        models: ['claude-3-opus', 'claude-3-sonnet'], model_aliases: {},
      },
    ],
    retry: { max_retries: 2, backoff_base_ms: 10, backoff_max_ms: 100, retryable_status: [429, 502, 503] },
    resolveModel: jest.fn().mockImplementation((model: string) => {
      if (model === 'gpt-4o') return { nodeId: 'openai', model: 'gpt-4o' };
      if (model === 'claude-3-opus') return { nodeId: 'claude', model: 'claude-3-opus' };
      if (model.startsWith('openai/')) return { nodeId: 'openai', model: model.replace('openai/', '') };
      return null;
    }),
    getModelPricing: jest.fn().mockReturnValue({ input: 5, output: 15 }),
    ...overrides.config,
  });

  const capabilityService = {
    resolveModelModalities: jest.fn().mockReturnValue(['text']),
    resolveNodeModalities: jest.fn().mockReturnValue(['text']),
    ...overrides.capabilityService,
  };

  const providerClient = {
    forward: jest.fn().mockResolvedValue(
      makeCanonicalResponse({ model: 'gpt-4o' }),
    ),
    forwardStream: jest.fn(),
    ...overrides.providerClient,
  };

  const scoringService = {
    score: jest.fn().mockReturnValue({
      tier: 'standard',
      score: 0.45,
      domainHint: undefined,
      modalityHints: undefined,
      fastPath: undefined,
    }),
    onModuleInit: jest.fn(),
    ...overrides.scoringService,
  };

  const routingService = {
    resolve: jest.fn().mockReturnValue({
      primary: { node: 'openai', model: 'gpt-4o' },
      fallbacks: [{ node: 'claude', model: 'claude-3-opus' }],
      tier: 'standard',
      momentumAdjusted: false,
    }),
    ...overrides.routingService,
  };

  const circuitBreaker = {
    isAvailable: jest.fn().mockReturnValue(true),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    ...overrides.circuitBreaker,
  };

  const budgetService = {
    check: jest.fn().mockResolvedValue(undefined),
    record: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockResolvedValue([]),
    ...overrides.budgetService,
  };

  const cacheService = {
    shouldCache: jest.fn().mockReturnValue(false),
    lookup: jest.fn().mockReturnValue(null),
    store: jest.fn(),
    ...overrides.cacheService,
  };

  const logEventBus = {
    emit: jest.fn(),
    ...overrides.logEventBus,
  };

  const callLogRepo = {
    create: jest.fn().mockImplementation((data: any) => data),
    save: jest.fn().mockImplementation((data: any) => Promise.resolve({ id: 1, ...data })),
    ...overrides.callLogRepo,
  };

  const pipeline = new PipelineService(
    config,
    capabilityService as any,
    providerClient as any,
    scoringService as any,
    routingService as any,
    circuitBreaker as any,
    budgetService as any,
    cacheService as any,
    logEventBus as any,
    callLogRepo as any,
  );

  return {
    pipeline,
    mocks: {
      config, capabilityService, providerClient, scoringService,
      routingService, circuitBreaker, budgetService, cacheService,
      logEventBus, callLogRepo,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// Direct Model Routing
// ═══════════════════════════════════════════════════════════

describe('PipelineService — direct routing', () => {
  it('should route directly when model matches a known model', async () => {
    const { pipeline, mocks } = makePipeline();
    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });

    const result = await pipeline.process(request);

    expect(result.statusCode).toBe(200);
    expect(mocks.providerClient.forward).toHaveBeenCalledWith(
      request, 'openai', 'gpt-4o',
      expect.objectContaining({ tier: 'direct', is_fallback: false }),
    );
    // Scoring engine should NOT be called for direct routing
    expect(mocks.scoringService.score).not.toHaveBeenCalled();
  });

  it('should fall through to auto routing for unknown models', async () => {
    const { pipeline, mocks } = makePipeline();
    const request = makeRequest('Hello', { originalModel: 'unknown-model-xyz' });

    await pipeline.process(request);

    // Should have called scoring engine (auto routing)
    expect(mocks.scoringService.score).toHaveBeenCalled();
    expect(mocks.routingService.resolve).toHaveBeenCalled();
  });

  it('should use auto routing when model is "auto"', async () => {
    const { pipeline, mocks } = makePipeline();
    const request = makeRequest('Hello', { originalModel: 'auto' });

    await pipeline.process(request);

    expect(mocks.scoringService.score).toHaveBeenCalled();
    expect(mocks.routingService.resolve).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// Budget Enforcement
// ═══════════════════════════════════════════════════════════

describe('PipelineService — budget enforcement', () => {
  it('should return 429 when budget is exceeded', async () => {
    const { pipeline } = makePipeline({
      budgetService: {
        check: jest.fn().mockRejectedValue(new BudgetExceededError('tokens', 1_500_000, 1_000_000)),
        record: jest.fn(),
        getStatus: jest.fn(),
      },
    });

    const request = makeRequest('Hello');
    const result = await pipeline.process(request);

    expect(result.statusCode).toBe(429);
    expect(result.body).toHaveProperty('error');
  });

  it('should record usage after successful response', async () => {
    const { pipeline, mocks } = makePipeline();
    const response = makeCanonicalResponse({
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mocks.providerClient.forward.mockResolvedValue(response);

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    await pipeline.process(request);

    expect(mocks.budgetService.record).toHaveBeenCalledWith(
      150, // total tokens
      expect.any(Number), // cost
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Cache Integration
// ═══════════════════════════════════════════════════════════

describe('PipelineService — caching', () => {
  it('should return cached response without calling provider', async () => {
    const cachedResponse = makeCanonicalResponse({ model: 'gpt-4o' });
    const { pipeline, mocks } = makePipeline({
      cacheService: {
        shouldCache: jest.fn().mockReturnValue(true),
        lookup: jest.fn().mockReturnValue(cachedResponse),
        store: jest.fn(),
      },
    });

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    const result = await pipeline.process(request);

    expect(result.statusCode).toBe(200);
    expect(mocks.providerClient.forward).not.toHaveBeenCalled();
  });

  it('should store response in cache after successful call', async () => {
    const { pipeline, mocks } = makePipeline({
      cacheService: {
        shouldCache: jest.fn().mockReturnValue(true),
        lookup: jest.fn().mockReturnValue(null),
        store: jest.fn(),
      },
    });

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    await pipeline.process(request);

    expect(mocks.cacheService.store).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ model: 'gpt-4o' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Retry + Fallback
// ═══════════════════════════════════════════════════════════

describe('PipelineService — retry and fallback', () => {
  it('should retry on retryable status codes', async () => {
    const { pipeline, mocks } = makePipeline();
    mocks.providerClient.forward
      .mockRejectedValueOnce(new ProviderError('Rate limited', 429, 'openai'))
      .mockRejectedValueOnce(new ProviderError('Rate limited', 429, 'openai'))
      .mockResolvedValueOnce(makeCanonicalResponse());

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    const result = await pipeline.process(request);

    expect(result.statusCode).toBe(200);
    expect(mocks.providerClient.forward).toHaveBeenCalledTimes(3);
  });

  it('should not retry on non-retryable status codes', async () => {
    const { pipeline, mocks } = makePipeline();
    mocks.providerClient.forward.mockRejectedValue(
      new ProviderError('Bad Request', 400, 'openai'),
    );

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    const result = await pipeline.process(request);

    // 400 is not retryable, so only 1 attempt on primary, then fallback(s)
    expect(result.statusCode).toBe(502); // all failed
  });

  it('should try fallback nodes after primary exhausts retries', async () => {
    const fallbackResponse = makeCanonicalResponse({ model: 'claude-3-opus' });
    const { pipeline, mocks } = makePipeline();
    mocks.providerClient.forward
      // Primary fails all retries
      .mockRejectedValueOnce(new ProviderError('Rate limited', 429, 'openai'))
      .mockRejectedValueOnce(new ProviderError('Rate limited', 429, 'openai'))
      .mockRejectedValueOnce(new ProviderError('Rate limited', 429, 'openai'))
      // Fallback succeeds
      .mockResolvedValueOnce(fallbackResponse);

    const request = makeRequest('Hello', { originalModel: 'auto' });
    const result = await pipeline.process(request);

    expect(result.statusCode).toBe(200);
  });

  it('should return 502 when all nodes fail', async () => {
    const { pipeline, mocks } = makePipeline();
    mocks.providerClient.forward.mockRejectedValue(
      new ProviderError('Server Error', 502, 'openai'),
    );

    const request = makeRequest('Hello', { originalModel: 'auto' });
    const result = await pipeline.process(request);

    expect(result.statusCode).toBe(502);
    expect(result.body).toHaveProperty('error');
  });

  it('should record circuit breaker success on successful call', async () => {
    const { pipeline, mocks } = makePipeline();
    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });

    await pipeline.process(request);

    expect(mocks.circuitBreaker.recordSuccess).toHaveBeenCalled();
  });

  it('should record circuit breaker failure when node fails', async () => {
    const { pipeline, mocks } = makePipeline();
    mocks.providerClient.forward.mockRejectedValue(
      new ProviderError('Bad Request', 400, 'openai'),
    );

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    await pipeline.process(request);

    expect(mocks.circuitBreaker.recordFailure).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// Error Formatting
// ═══════════════════════════════════════════════════════════

describe('PipelineService — error formatting', () => {
  it('should format chat_completions errors correctly', async () => {
    const { pipeline } = makePipeline({
      budgetService: {
        check: jest.fn().mockRejectedValue(new BudgetExceededError('tokens', 1_500_000, 1_000_000)),
        record: jest.fn(),
        getStatus: jest.fn(),
      },
    });

    const request = makeRequest('Hello');
    // Default source_format is 'chat_completions'
    const result = await pipeline.process(request);

    expect(result.body).toEqual({
      error: {
        message: expect.stringContaining('Budget exceeded'),
        type: 'server_error',
        code: '429',
      },
    });
  });

  it('should format messages errors in Anthropic style', async () => {
    const { pipeline } = makePipeline({
      budgetService: {
        check: jest.fn().mockRejectedValue(new BudgetExceededError('tokens', 1_500_000, 1_000_000)),
        record: jest.fn(),
        getStatus: jest.fn(),
      },
    });

    const request = makeRequest('Hello');
    request.metadata.source_format = 'messages';
    const result = await pipeline.process(request);

    expect(result.body).toEqual({
      type: 'error',
      error: { type: 'api_error', message: expect.stringContaining('Budget exceeded') },
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Call Logging
// ═══════════════════════════════════════════════════════════

describe('PipelineService — call logging', () => {
  it('should log successful calls', async () => {
    const { pipeline, mocks } = makePipeline();
    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });

    await pipeline.process(request);

    expect(mocks.callLogRepo.save).toHaveBeenCalled();
    expect(mocks.logEventBus.emit).toHaveBeenCalled();
  });

  it('should log failed calls', async () => {
    const { pipeline, mocks } = makePipeline();
    mocks.providerClient.forward.mockRejectedValue(
      new ProviderError('Server Error', 400, 'openai'),
    );

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    await pipeline.process(request);

    expect(mocks.callLogRepo.save).toHaveBeenCalled();
    const savedLog = mocks.callLogRepo.create.mock.calls[0][0];
    expect(savedLog.error).toBeTruthy();
    expect(savedLog.status_code).not.toBe(200);
  });

  it('should not throw if logging fails', async () => {
    const { pipeline, mocks } = makePipeline({
      callLogRepo: {
        create: jest.fn().mockImplementation((data: any) => data),
        save: jest.fn().mockRejectedValue(new Error('DB write failed')),
      },
    });

    const request = makeRequest('Hello', { originalModel: 'gpt-4o' });
    // Should not throw
    const result = await pipeline.process(request);
    expect(result.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// Native Messages Pinning
// ═══════════════════════════════════════════════════════════

describe('PipelineService — messages pinning', () => {
  it('should pin messages-format requests with Claude user-agent to claude node', async () => {
    const { pipeline, mocks } = makePipeline({
      config: {
        getNode: jest.fn().mockImplementation((id: string) => {
          if (id === 'claude') return {
            id: 'claude', name: 'Claude', protocol: 'messages',
            models: ['claude-3-opus'], model_aliases: {},
          };
          return undefined;
        }),
      },
    });

    const request = makeRequest('Hello', { originalModel: 'auto' });
    request.metadata.source_format = 'messages';
    request.metadata.raw_headers = { 'user-agent': 'Claude-Code/1.0' };

    await pipeline.process(request);

    expect(mocks.providerClient.forward).toHaveBeenCalledWith(
      request, 'claude', 'claude-3-opus',
      expect.objectContaining({ tier: 'direct' }),
    );
  });
});
