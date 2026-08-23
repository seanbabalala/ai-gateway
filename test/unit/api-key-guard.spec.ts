import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from '../../src/auth/api-key.guard';

function makeContext(headers: Record<string, string | string[]> = {}): any {
  const request: any = {
    headers,
    ip: '127.0.0.1',
    apiKeyName: undefined,
    apiKeyId: undefined,
    gatewayApiKey: undefined,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    _request: request,
  };
}

function makeApiKeyService(match: any = null): any {
  return {
    findContextByPlainKey: jest.fn().mockResolvedValue(match),
  };
}

describe('ApiKeyGuard', () => {
  it('should throw UnauthorizedException when header is missing', async () => {
    const service = makeApiKeyService();
    const guard = new ApiKeyGuard(service);
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(service.findContextByPlainKey).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException for invalid or disabled key', async () => {
    const service = makeApiKeyService(null);
    const guard = new ApiKeyGuard(service);
    const ctx = makeContext({ authorization: 'Bearer gw_sk_live_wrong' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(service.findContextByPlainKey).toHaveBeenCalledWith(
      'gw_sk_live_wrong',
      '127.0.0.1',
    );
  });

  it('should accept a valid key from the native Anthropic x-api-key header', async () => {
    const keyContext = {
      id: 'key_123',
      name: 'anthropic-client',
      workspace_id: 'workspace_123',
    };
    const service = makeApiKeyService(keyContext);
    const guard = new ApiKeyGuard(service);
    const ctx = makeContext({ 'x-api-key': 'gw_sk_live_valid' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.findContextByPlainKey).toHaveBeenCalledWith(
      'gw_sk_live_valid',
      '127.0.0.1',
    );
    expect(ctx._request.apiKeyName).toBe('anthropic-client');
    expect(ctx._request.workspaceId).toBe('workspace_123');
  });

  it('should trim an x-api-key header before validation', async () => {
    const service = makeApiKeyService({
      id: 'key_123',
      name: 'anthropic-client',
    });
    const guard = new ApiKeyGuard(service);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': '  gw_sk_live_valid  ' })),
    ).resolves.toBe(true);
    expect(service.findContextByPlainKey).toHaveBeenCalledWith(
      'gw_sk_live_valid',
      '127.0.0.1',
    );
  });

  it('should reject an empty x-api-key header without querying the key store', async () => {
    const service = makeApiKeyService();
    const guard = new ApiKeyGuard(service);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': '   ' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.findContextByPlainKey).not.toHaveBeenCalled();
  });

  it('should accept the case-insensitive Bearer authentication scheme', async () => {
    const service = makeApiKeyService({ id: 'key_123', name: 'openai-client' });
    const guard = new ApiKeyGuard(service);

    await expect(
      guard.canActivate(
        makeContext({ authorization: 'bearer gw_sk_live_valid' }),
      ),
    ).resolves.toBe(true);
    expect(service.findContextByPlainKey).toHaveBeenCalledWith(
      'gw_sk_live_valid',
      '127.0.0.1',
    );
  });

  it('should prefer Authorization Bearer when both client authentication headers are present', async () => {
    const service = makeApiKeyService({
      id: 'key_123',
      name: 'preferred-bearer',
    });
    const guard = new ApiKeyGuard(service);
    const ctx = makeContext({
      authorization: 'Bearer gw_sk_live_bearer',
      'x-api-key': 'gw_sk_live_anthropic',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.findContextByPlainKey).toHaveBeenCalledWith(
      'gw_sk_live_bearer',
      '127.0.0.1',
    );
  });

  it('should pass and attach generated key context for a valid key', async () => {
    const keyContext = {
      id: 'key_123',
      name: 'production-app',
      status: 'active',
      allow_auto: true,
      allow_direct: false,
      allowed_nodes: ['openai'],
      allowed_models: ['gpt-4o-mini'],
      allowed_endpoints: [],
      allowed_modalities: [],
      rate_limit_per_minute: 60,
    };
    const service = makeApiKeyService(keyContext);
    const guard = new ApiKeyGuard(service);
    const ctx = makeContext({ authorization: 'Bearer gw_sk_live_valid' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._request.apiKeyName).toBe('production-app');
    expect(ctx._request.apiKeyId).toBe('key_123');
    expect(ctx._request.gatewayApiKey).toEqual(keyContext);
  });
});
