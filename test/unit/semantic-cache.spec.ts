import { PromptCacheService } from '../../src/cache/prompt-cache.service';
import { makeCanonicalResponse, makeRequest, mockConfigService } from '../helpers';

function makeService(overrides: Record<string, unknown> = {}): PromptCacheService {
  return new PromptCacheService(
    mockConfigService({
      semanticCache: {
        enabled: true,
        backend: 'memory',
        similarity_threshold: 0.75,
        ttl_seconds: 3600,
        max_entries: 100,
        vector_dimensions: 128,
        store_responses: false,
        max_response_bytes: 65_536,
        ...overrides,
      },
    }),
  );
}

describe('Semantic cache preview', () => {
  it('is disabled by default and stores no replayable response', () => {
    const service = new PromptCacheService(mockConfigService());
    const request = makeRequest('summarize our incident notes');

    expect(service.shouldSemanticCache(request)).toBe(false);
    expect(service.lookupSemantic(request)).toEqual(
      expect.objectContaining({
        hit: false,
        matched: false,
        reason: 'disabled',
      }),
    );
  });

  it('records metadata-only matches without returning prompt or response content', () => {
    const service = makeService();
    const request = makeRequest('summarize the deployment incident');
    const similar = makeRequest('summarize deployment incident');

    service.storeSemantic(
      request,
      makeCanonicalResponse({
        content: [{ type: 'text', text: 'redacted answer' }],
      }),
    );
    const result = service.lookupSemantic(similar);

    expect(result.matched).toBe(true);
    expect(result.hit).toBe(false);
    expect(result.metadataOnly).toBe(true);
    expect(result.response).toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it('returns a cloned response only when response storage is explicitly enabled', () => {
    const service = makeService({ store_responses: true });
    const request = makeRequest('what is the daily budget status');
    const response = makeCanonicalResponse({
      content: [{ type: 'text', text: 'budget ok' }],
    });

    service.storeSemantic(request, response);
    const result = service.lookupSemantic(makeRequest('what is daily budget status'));

    expect(result.hit).toBe(true);
    expect(result.reason).toBe('hit');
    expect(result.response).toEqual(response);
    expect(result.response).not.toBe(response);
  });

  it('isolates entries by API key and namespace metadata', () => {
    const service = makeService({ store_responses: true });
    const request = makeRequest('summarize team usage');
    request.metadata.api_key_id = 'key-a';
    request.metadata.namespace_id = 'team-a';
    service.storeSemantic(
      request,
      makeCanonicalResponse({
        content: [{ type: 'text', text: 'team a' }],
      }),
    );

    const next = makeRequest('summarize team usage');
    next.metadata.api_key_id = 'key-b';
    next.metadata.namespace_id = 'team-a';
    const result = service.lookupSemantic(next);

    expect(result.hit).toBe(false);
    expect(result.matched).toBe(false);
  });
});
