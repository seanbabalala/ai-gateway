import { SecretReferenceResolverService } from '../../src/config/secret-reference-resolver.service';
import { maskSecretForDisplay, scanSecretReferences } from '../../src/config/secret-references';

function makeResolver(overrides: Record<string, unknown> = {}) {
  const secretManager = {
    cache_ttl_seconds: 300,
    failure_policy: 'fail_closed',
    backends: {
      env: { enabled: true },
      vault: {
        enabled: false,
        address: '',
        token: '',
        mount: 'secret',
        kv_version: 2,
        timeout_ms: 5000,
      },
      aws_sm: {
        enabled: false,
        region: '',
        endpoint: '',
        access_key_id: '',
        secret_access_key: '',
        session_token: '',
        timeout_ms: 5000,
      },
      gcp_sm: {
        enabled: false,
        project_id: '',
        endpoint: '',
        access_token: '',
        use_metadata: true,
        timeout_ms: 5000,
      },
    },
    ...overrides,
  };
  return new SecretReferenceResolverService({ secretManager } as any);
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.SIFTGATE_TEST_SECRET;
  delete process.env.SIFTGATE_TEST_CHANGED;
});

describe('secret reference parser', () => {
  it('parses legacy env, typed env, and external secret references', () => {
    const scan = scanSecretReferences(
      '${OPENAI_API_KEY} ${env:ANTHROPIC_API_KEY:-fallback} ${vault:secret/openai#api_key}',
    );

    expect(scan.invalid).toHaveLength(0);
    expect(scan.references).toEqual([
      expect.objectContaining({ backend: 'env', target: 'OPENAI_API_KEY' }),
      expect.objectContaining({
        backend: 'env',
        target: 'ANTHROPIC_API_KEY',
        defaultValue: 'fallback',
      }),
      expect.objectContaining({
        backend: 'vault',
        target: 'secret/openai',
        field: 'api_key',
      }),
    ]);
  });

  it('marks literal secrets as redacted while preserving references for Dashboard display', () => {
    expect(maskSecretForDisplay('sk-live-secret')).toBe('sk-live-...');
    expect(maskSecretForDisplay('${env:OPENAI_API_KEY}')).toBe('${env:OPENAI_API_KEY}');
  });
});

describe('SecretReferenceResolverService', () => {
  it('resolves typed env references and keeps a local TTL cache', async () => {
    process.env.SIFTGATE_TEST_SECRET = 'first-value';
    const resolver = makeResolver();

    await expect(resolver.resolveString('${env:SIFTGATE_TEST_SECRET}')).resolves.toBe(
      'first-value',
    );

    process.env.SIFTGATE_TEST_SECRET = 'second-value';
    await expect(resolver.resolveString('${env:SIFTGATE_TEST_SECRET}')).resolves.toBe(
      'first-value',
    );

    resolver.clearCache();
    await expect(resolver.resolveString('${env:SIFTGATE_TEST_SECRET}')).resolves.toBe(
      'second-value',
    );
  });

  it('rejects disabled external backends by default', async () => {
    const resolver = makeResolver();

    await expect(resolver.resolveString('${vault:secret/openai#api_key}'))
      .rejects.toThrow('backend "vault" is not enabled');
  });

  it('omits optional values when fail_open_for_optional is configured', async () => {
    const resolver = makeResolver({ failure_policy: 'fail_open_for_optional' });

    await expect(
      resolver.resolveRecord({
        Authorization: 'Bearer ${vault:secret/openai#api_key}',
      }),
    ).resolves.toEqual({});
  });

  it('resolves Vault KV v2 secrets through the SDK-less HTTP adapter', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({ data: { data: { api_key: 'vault-key' } } }),
      ),
    });
    global.fetch = fetchMock as any;
    const resolver = makeResolver({
      backends: {
        env: { enabled: true },
        vault: {
          enabled: true,
          address: 'https://vault.example.com',
          token: 'vault-token',
          mount: 'secret',
          kv_version: 2,
          timeout_ms: 5000,
        },
        aws_sm: { enabled: false, timeout_ms: 5000 },
        gcp_sm: { enabled: false, timeout_ms: 5000, use_metadata: true },
      },
    });

    await expect(resolver.resolveString('${vault:secret/openai#api_key}'))
      .resolves.toBe('vault-key');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vault.example.com/v1/secret/data/openai',
      expect.objectContaining({
        headers: { 'X-Vault-Token': 'vault-token' },
      }),
    );
  });

  it('resolves AWS Secrets Manager values through a signed HTTP request', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({ SecretString: JSON.stringify({ api_key: 'aws-key' }) }),
      ),
    });
    global.fetch = fetchMock as any;
    const resolver = makeResolver({
      backends: {
        env: { enabled: true },
        vault: { enabled: false, timeout_ms: 5000, kv_version: 2 },
        aws_sm: {
          enabled: true,
          region: 'us-east-1',
          endpoint: 'https://secretsmanager.example.test',
          access_key_id: 'AKIATEST0000000000',
          secret_access_key: 'aws-secret',
          session_token: '',
          timeout_ms: 5000,
        },
        gcp_sm: { enabled: false, timeout_ms: 5000, use_metadata: true },
      },
    });

    await expect(resolver.resolveString('${aws-sm:openai/prod#api_key}'))
      .resolves.toBe('aws-key');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect(((init as RequestInit).headers as Record<string, string>)['x-amz-target'])
      .toBe('secretsmanager.GetSecretValue');
    expect((init as RequestInit).body).toBe(JSON.stringify({ SecretId: 'openai/prod' }));
  });

  it('resolves GCP Secret Manager payloads through the SDK-less HTTP adapter', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          payload: {
            data: Buffer.from(JSON.stringify({ api_key: 'gcp-key' })).toString('base64'),
          },
        }),
      ),
    });
    global.fetch = fetchMock as any;
    const resolver = makeResolver({
      backends: {
        env: { enabled: true },
        vault: { enabled: false, timeout_ms: 5000, kv_version: 2 },
        aws_sm: { enabled: false, timeout_ms: 5000 },
        gcp_sm: {
          enabled: true,
          project_id: 'siftgate-prod',
          endpoint: 'https://secretmanager.example.test',
          access_token: 'gcp-token',
          use_metadata: false,
          timeout_ms: 5000,
        },
      },
    });

    await expect(resolver.resolveString('${gcp-sm:openai-prod#api_key}'))
      .resolves.toBe('gcp-key');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://secretmanager.example.test/v1/projects/siftgate-prod/secrets/openai-prod/versions/latest:access',
      expect.objectContaining({
        headers: { Authorization: 'Bearer gcp-token' },
      }),
    );
  });
});
