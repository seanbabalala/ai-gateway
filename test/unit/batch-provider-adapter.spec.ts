import { GatewayTimeoutException } from '@nestjs/common';
import { BatchProviderAdapterService } from '../../src/batch/batch-provider-adapter.service';

const originalFetch = global.fetch;

function makeService() {
  const secrets = {
    resolveRecord: jest.fn(async () => ({})),
    resolveString: jest.fn(async () => 'sk-test'),
  };
  return {
    service: new BatchProviderAdapterService(secrets as any),
    secrets,
  };
}

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'openai',
    protocol: 'chat_completions',
    base_url: 'https://provider.example.test',
    api_key: 'sk-test',
    timeout_ms: 5,
    ...overrides,
  } as any;
}

function installAbortableFetch() {
  const fetchMock = jest.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (init?.signal?.aborted) {
        rejectAbort();
      } else {
        init?.signal?.addEventListener('abort', rejectAbort, { once: true });
      }
    }),
  );
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

describe('BatchProviderAdapterService', () => {
  it('times out batch upstream requests using the shared fetch helper', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const fetchMock = installAbortableFetch();

    const request = service.create(makeNode(), { input_file_id: 'file-1' }, 'req-1');
    const expectation = expect(request).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(5);

    await expectation;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example.test/v1/batches',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('keeps caller aborts wired into the batch upstream signal', async () => {
    const { service } = makeService();
    installAbortableFetch();
    const controller = new AbortController();

    const request = service.retrieve(
      makeNode(),
      'batch-1',
      'req-1',
      controller.signal,
    );
    controller.abort();

    await expect(request).rejects.toBeInstanceOf(GatewayTimeoutException);
  });
});
