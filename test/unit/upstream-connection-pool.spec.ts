import { UpstreamConnectionPoolService, resolveNodeConnectionConfig } from '../../src/providers/upstream-connection-pool.service';
import type { NodeConfig } from '../../src/config/gateway.config';

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    api_key: 'sk-test',
    models: ['gpt-4o'],
    timeout_ms: 60000,
    ...overrides,
  };
}

describe('UpstreamConnectionPoolService', () => {
  it('keeps default fetch behavior when connection config is omitted or disabled', () => {
    expect(resolveNodeConnectionConfig(makeNode())).toBeUndefined();
    expect(resolveNodeConnectionConfig(makeNode({ connection: { enabled: false } }))).toBeUndefined();
    expect(resolveNodeConnectionConfig(makeNode({ connection: { keep_alive: false } }))).toBeUndefined();
  });

  it('resolves per-node pool settings with stable defaults', () => {
    expect(resolveNodeConnectionConfig(makeNode({
      connection: {
        pool_size: 25,
        keep_alive_ms: 120000,
        headers_timeout_ms: 5000,
        body_timeout_ms: 0,
        http2: true,
      },
    }))).toEqual({
      origin: 'https://api.openai.com',
      poolSize: 25,
      keepAliveMs: 120000,
      headersTimeoutMs: 5000,
      bodyTimeoutMs: 0,
      http2: true,
    });
  });

  it('reuses the dispatcher until the node connection signature changes', async () => {
    const service = new UpstreamConnectionPoolService();
    const first = service.getDispatcher(makeNode({ connection: { pool_size: 2 } }));
    const reused = service.getDispatcher(makeNode({ connection: { pool_size: 2 } }));
    const changed = service.getDispatcher(makeNode({ connection: { pool_size: 3 } }));

    expect(first).toBeDefined();
    expect(reused).toBe(first);
    expect(changed).toBeDefined();
    expect(changed).not.toBe(first);

    await service.onModuleDestroy();
  });
});
