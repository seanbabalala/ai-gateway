import {
  FetchTimeoutError,
  fetchWithTimeout,
  redactedFetchErrorMessage,
} from '../../src/http/fetch-with-timeout';

describe('fetchWithTimeout', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('aborts stalled fetches and reports the normalized timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    ) as typeof fetch;

    const request = fetchWithTimeout('https://upstream.example.test', {}, {
      timeoutMs: 5.8,
      timeoutMessage: (timeoutMs) => `upstream timed out after ${timeoutMs}ms`,
    });
    const expectation = expect(request).rejects.toMatchObject({
      name: 'FetchTimeoutError',
      timeoutMs: 5,
      message: 'upstream timed out after 5ms',
    } satisfies Partial<FetchTimeoutError>);
    await jest.advanceTimersByTimeAsync(5);

    await expectation;
  });

  it('forwards an upstream abort without translating it into a helper timeout', async () => {
    const external = new AbortController();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => {
          const error = new Error('caller aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (init?.signal?.aborted) {
          rejectAbort();
        } else {
          init?.signal?.addEventListener('abort', rejectAbort, { once: true });
        }
      }),
    ) as typeof fetch;

    const request = fetchWithTimeout(
      'https://upstream.example.test',
      { signal: external.signal },
      { timeoutMs: 1000 },
    );
    external.abort();

    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      message: 'caller aborted',
    });
  });

  it('redacts secrets from fetch error messages and causes', () => {
    const error = new Error(
      'request failed Bearer gw_sk_live_gateway_secret api_key=sk-live-secret gsk-provider-secret',
    );
    (error as Error & { cause?: unknown }).cause = {
      code: 'ECONNRESET',
      message: 'cause leaked sk-cause-secret',
    };

    const message = redactedFetchErrorMessage(error);

    expect(message).toContain('Bearer [redacted]');
    expect(message).toContain('api_key=[redacted]');
    expect(message).toContain('[redacted-provider-key]');
    expect(message).toContain('sk-[redacted]');
    expect(message).not.toContain('gw_sk_live_gateway_secret');
    expect(message).not.toContain('sk-live-secret');
    expect(message).not.toContain('gsk-provider-secret');
    expect(message).not.toContain('sk-cause-secret');
  });
});
