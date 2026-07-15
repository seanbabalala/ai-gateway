import {
  EmbeddingBatchingService,
  normalizeEmbeddingInput,
} from '../../src/pipeline/embedding-batching.service';
import { mockConfigService } from '../helpers';

function makeService(configOverrides: Record<string, unknown> = {}) {
  return new EmbeddingBatchingService(
    mockConfigService({
      embeddingBatching: {
        enabled: true,
        window_ms: 5,
        max_batch_size: 8,
        max_input_items: 4,
        max_queue: 100,
        timeout_ms: 100,
        ...configOverrides,
      },
    }),
  );
}

function makeRequest(input: unknown, overrides: Record<string, unknown> = {}) {
  return {
    model: 'auto',
    input,
    metadata: {
      source_format: 'embeddings',
      original_model: 'auto',
      raw_headers: {},
      api_key_id: 'key_a',
    },
    ...overrides,
  } as any;
}

const routingMeta = {
  tier: 'standard' as const,
  score: 0,
  is_fallback: false,
  fallback_reason: null,
};

describe('EmbeddingBatchingService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes supported embedding input shapes', () => {
    expect(normalizeEmbeddingInput('hello')).toEqual({
      kind: 'text',
      items: ['hello'],
    });
    expect(normalizeEmbeddingInput(['a', 'b'])).toEqual({
      kind: 'text',
      items: ['a', 'b'],
    });
    expect(normalizeEmbeddingInput([1, 2, 3])).toEqual({
      kind: 'tokens',
      items: [[1, 2, 3]],
    });
    expect(normalizeEmbeddingInput([[1], [2]])).toEqual({
      kind: 'tokens',
      items: [[1], [2]],
    });
  });

  it('bypasses batching when disabled', async () => {
    const service = makeService({ enabled: false });
    const dispatch = jest.fn().mockResolvedValue({
      id: 'emb-one',
      object: 'list',
      data: [{ index: 0, embedding: [0.1] }],
      usage: { input_tokens: 1, output_tokens: 0 },
      model: 'text-embedding-3-small',
      routing: { ...routingMeta, node: 'openai', latency_ms: 7 },
    });

    await service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'hello' }),
      'openai',
      'text-embedding-3-small',
      routingMeta,
    );
  });

  it('merges small same-target embedding requests and splits responses', async () => {
    const service = makeService();
    const dispatch = jest.fn().mockResolvedValue({
      id: 'emb-batch',
      object: 'list',
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
      usage: { input_tokens: 20, output_tokens: 0 },
      model: 'text-embedding-3-small',
      routing: { ...routingMeta, node: 'openai', latency_ms: 11 },
    });

    const p1 = service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );
    const p2 = service.enqueue(
      makeRequest('world'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );

    await jest.advanceTimersByTimeAsync(5);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].input).toEqual(['hello', 'world']);
    expect(r1.data).toEqual([{ index: 0, embedding: [0.1] }]);
    expect(r2.data).toEqual([{ index: 0, embedding: [0.2] }]);
    expect(r1.usage.input_tokens + r2.usage.input_tokens).toBe(20);
  });

  it('starts a new batch instead of exceeding max_batch_size', async () => {
    const service = makeService({ max_batch_size: 3 });
    const dispatch = jest.fn().mockImplementation(async (request) => ({
      id: 'emb-batch',
      object: 'list',
      data: (request.input as string[]).map((_, index) => ({
        index,
        embedding: [index + 0.1],
      })),
      usage: {
        input_tokens: (request.input as string[]).length,
        output_tokens: 0,
      },
      model: 'text-embedding-3-small',
      routing: { ...routingMeta, node: 'openai', latency_ms: 11 },
    }));

    const p1 = service.enqueue(
      makeRequest(['a', 'b']),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );
    const p2 = service.enqueue(
      makeRequest(['c', 'd']),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );

    await jest.advanceTimersByTimeAsync(5);
    await Promise.all([p1, p2]);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0].input).toEqual(['a', 'b']);
    expect(dispatch.mock.calls[1][0].input).toEqual(['c', 'd']);
  });

  it('rejects canceled queued requests without dispatching them', async () => {
    const service = makeService();
    const dispatch = jest.fn();
    const controller = new AbortController();

    const pending = service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow('canceled');
    await jest.advanceTimersByTimeAsync(5);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an in-flight batch entry when its request is canceled', async () => {
    const service = makeService();
    const controller = new AbortController();
    let resolveDispatch!: (value: any) => void;
    const dispatch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDispatch = resolve;
        }),
    );

    const pending = service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
      { signal: controller.signal },
    );
    const pendingResult = pending.then(
      (value) => value,
      (error) => error as Error,
    );

    await jest.advanceTimersByTimeAsync(5);
    expect(dispatch).toHaveBeenCalledTimes(1);

    controller.abort();
    const error = await pendingResult;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('canceled');

    resolveDispatch({
      id: 'emb-late',
      object: 'list',
      data: [{ index: 0, embedding: [0.1] }],
      usage: { input_tokens: 1, output_tokens: 0 },
      model: 'text-embedding-3-small',
      routing: { ...routingMeta, node: 'openai', latency_ms: 9 },
    });
    await Promise.resolve();
  });

  it('rejects an in-flight batch entry when its timeout expires', async () => {
    const service = makeService({ timeout_ms: 10 });
    let resolveDispatch!: (value: any) => void;
    const dispatch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDispatch = resolve;
        }),
    );

    const pending = service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );
    const pendingResult = pending.then(
      (value) => value,
      (error) => error as Error,
    );

    await jest.advanceTimersByTimeAsync(5);
    expect(dispatch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5);
    const error = await pendingResult;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('timed out');

    resolveDispatch({
      id: 'emb-late',
      object: 'list',
      data: [{ index: 0, embedding: [0.1] }],
      usage: { input_tokens: 1, output_tokens: 0 },
      model: 'text-embedding-3-small',
      routing: { ...routingMeta, node: 'openai', latency_ms: 9 },
    });
    await Promise.resolve();
  });

  it('rejects only entries whose slice is missing from a partial batch response', async () => {
    const service = makeService();
    const dispatch = jest.fn().mockResolvedValue({
      id: 'emb-partial',
      object: 'list',
      data: [{ index: 0, embedding: [0.1] }],
      usage: { input_tokens: 10, output_tokens: 0 },
      model: 'text-embedding-3-small',
      routing: { ...routingMeta, node: 'openai', latency_ms: 9 },
    });

    const p1 = service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );
    const p2 = service.enqueue(
      makeRequest('world'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    );
    const p2Result = p2.then(
      (value) => value,
      (error) => error as Error,
    );

    await jest.advanceTimersByTimeAsync(5);

    await expect(p1).resolves.toMatchObject({
      data: [{ index: 0, embedding: [0.1] }],
    });
    const error = await p2Result;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('missing item index 1');
  });

  it('clears queued batch timers and rejects pending entries on module destroy', async () => {
    const service = makeService({ window_ms: 50, timeout_ms: 1000 });
    const dispatch = jest.fn();

    const pending: Promise<Error> = service.enqueue(
      makeRequest('hello'),
      'openai',
      'text-embedding-3-small',
      routingMeta,
      dispatch,
    ).then(
      () => {
        throw new Error('Expected embedding batch request to reject.');
      },
      (error) => error as Error,
    );

    service.onModuleDestroy();

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('shutting down');

    await jest.advanceTimersByTimeAsync(1_000);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
