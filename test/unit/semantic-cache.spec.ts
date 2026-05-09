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
        isolation: 'workspace_api_key_model',
        response_storage_requires_header: true,
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

  it('keeps response replay disabled until the per-request opt-in header is present', () => {
    const service = makeService({ store_responses: true });
    const request = makeRequest('what is the daily budget status');
    const response = makeCanonicalResponse({
      content: [{ type: 'text', text: 'budget ok' }],
    });

    service.storeSemantic(request, response);
    const result = service.lookupSemantic(makeRequest('what is daily budget status'));

    expect(result.matched).toBe(true);
    expect(result.hit).toBe(false);
    expect(result.metadataOnly).toBe(true);
    expect(result.response).toBeNull();
  });

  it('returns a cloned response only when response storage is explicitly enabled and opted in', () => {
    const service = makeService({ store_responses: true });
    const request = makeRequest('what is the daily budget status');
    request.metadata.raw_headers['x-siftgate-semantic-store-response'] = 'true';
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

  it('honors workspace, model, and API key isolation modes', () => {
    const request = makeRequest('summarize team usage', { originalModel: 'gpt-4o' });
    request.metadata.workspace_id = 'workspace-a';
    request.metadata.api_key_id = 'key-a';
    request.metadata.raw_headers['x-siftgate-semantic-store-response'] = 'true';

    const byKey = makeService({ store_responses: true });
    byKey.storeSemantic(
      request,
      makeCanonicalResponse({ content: [{ type: 'text', text: 'workspace key a' }] }),
    );

    const differentKey = makeRequest('summarize team usage', { originalModel: 'gpt-4o' });
    differentKey.metadata.workspace_id = 'workspace-a';
    differentKey.metadata.api_key_id = 'key-b';
    expect(byKey.lookupSemantic(differentKey).hit).toBe(false);

    const byModel = makeService({ isolation: 'workspace_model', store_responses: true });
    byModel.storeSemantic(
      request,
      makeCanonicalResponse({ content: [{ type: 'text', text: 'workspace model' }] }),
    );
    const sameWorkspaceDifferentKey = makeRequest('summarize team usage', { originalModel: 'gpt-4o' });
    sameWorkspaceDifferentKey.metadata.workspace_id = 'workspace-a';
    sameWorkspaceDifferentKey.metadata.api_key_id = 'key-b';
    expect(byModel.lookupSemantic(sameWorkspaceDifferentKey).hit).toBe(true);

    const differentModel = makeRequest('summarize team usage', { originalModel: 'claude-sonnet' });
    differentModel.metadata.workspace_id = 'workspace-a';
    differentModel.metadata.api_key_id = 'key-a';
    expect(byModel.lookupSemantic(differentModel).hit).toBe(false);

    const byWorkspace = makeService({ isolation: 'workspace', store_responses: true });
    byWorkspace.storeSemantic(
      request,
      makeCanonicalResponse({ content: [{ type: 'text', text: 'workspace' }] }),
    );
    expect(byWorkspace.lookupSemantic(differentModel).hit).toBe(true);
  });

  it('invalidates only the selected workspace and treats legacy null as default workspace', () => {
    const service = makeService({ store_responses: true, response_storage_requires_header: false });
    const legacyDefault = makeRequest('default workspace report');
    legacyDefault.metadata.workspace_id = null;
    const otherWorkspace = makeRequest('other workspace report');
    otherWorkspace.metadata.workspace_id = 'workspace-b';

    service.storeSemantic(legacyDefault, makeCanonicalResponse());
    service.storeSemantic(otherWorkspace, makeCanonicalResponse());

    expect(service.getSemanticStats().entries).toBe(2);
    expect(service.clearSemantic('default-workspace')).toBe(1);
    expect(service.getSemanticStats().entries).toBe(1);
    expect(service.lookupSemantic(otherWorkspace).matched).toBe(true);
  });
});
