import { ForbiddenException } from '@nestjs/common'
import { McpGatewayService } from '../../src/mcp/mcp-gateway.service'
import type { GatewayApiKeyContext } from '../../src/auth/gateway-api-key.service'

const apiKey: GatewayApiKeyContext = {
  id: 'gak_1',
  name: 'agent-key',
  status: 'active',
  allow_auto: true,
  allow_direct: true,
  allowed_nodes: [],
  allowed_models: [],
  allowed_endpoints: ['mcp'],
  allowed_modalities: [],
  namespace_id: 'team-a',
  namespace_name: 'Team A',
  rate_limit_per_minute: null,
}

function makeService(overrides: Record<string, unknown> = {}) {
  const config = {
    get mcpGateway() {
      return {
        enabled: true,
        path: '/mcp',
        max_recent_calls: 20,
        servers: [
          {
            id: 'local-tools',
            name: 'Local Tools',
            url: 'http://mcp.local/rpc?token=secret',
            allowed_namespaces: ['team-a'],
            headers: {
              authorization: '${env:MCP_TOKEN}',
            },
            tools: [
              {
                name: 'search_docs',
                description: 'Search local docs',
                input_schema: { type: 'object' },
              },
            ],
          },
        ],
        ...overrides,
      }
    },
  }
  const secrets = {
    resolveRecord: jest.fn().mockResolvedValue({ authorization: 'Bearer resolved' }),
  }
  return {
    service: new McpGatewayService(config as any, secrets as any),
    secrets,
  }
}

describe('McpGatewayService', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('returns dashboard metadata without URL query secrets', () => {
    const { service } = makeService()
    const summary = service.getDashboardSummary()

    expect(summary.enabled).toBe(true)
    expect(summary.metadata_only).toBe(true)
    expect(summary.servers[0]).toMatchObject({
      id: 'local-tools',
      endpoint: 'http://mcp.local/rpc',
      allowed_namespaces: ['team-a'],
      tools: [
        {
          name: 'search_docs',
          has_input_schema: true,
        },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain('token=secret')
  })

  it('proxies JSON-RPC requests and records metadata-only audit', async () => {
    const { service, secrets } = makeService()
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await service.proxy({
      serverId: 'local-tools',
      apiKey,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: { query: 'do not store this input' },
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(result.requestId).toEqual(expect.any(String))
    expect(result.headers['x-siftgate-request-id']).toBe(result.requestId)
    expect(result.headers['x-request-id']).toBe(result.requestId)
    expect(result.headers['x-siftgate-mcp-request-id']).toBe(result.requestId)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://mcp.local/rpc?token=secret',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer resolved',
          'x-siftgate-request-id': result.requestId,
          'x-request-id': result.requestId,
          'x-siftgate-mcp-request-id': result.requestId,
        }),
      }),
    )
    expect(secrets.resolveRecord).toHaveBeenCalled()

    const summary = service.getDashboardSummary()
    expect(summary.recent_calls).toHaveLength(1)
    expect(summary.recent_calls[0]).toMatchObject({
      server_id: 'local-tools',
      method: 'tools/call',
      tool_name: 'search_docs',
      api_key_id: 'gak_1',
      namespace_id: 'team-a',
      success: true,
    })
    expect(JSON.stringify(summary)).not.toContain('do not store this input')
    expect(JSON.stringify(summary)).not.toContain('Bearer resolved')
  })

  it('enforces API key endpoint permissions before upstream forwarding', async () => {
    const { service } = makeService()
    global.fetch = jest.fn()

    await expect(
      service.proxy({
        serverId: 'local-tools',
        apiKey: {
          ...apiKey,
          allowed_endpoints: ['chat_completions'],
        },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(service.getDashboardSummary().recent_calls[0]).toMatchObject({
      success: false,
      error_type: 'forbidden',
      status_code: 403,
    })
  })

  it('requires every tool in a JSON-RPC batch to be allowed by tool-level permissions', async () => {
    const { service } = makeService()
    global.fetch = jest.fn()

    await expect(
      service.proxy({
        serverId: 'local-tools',
        apiKey: {
          ...apiKey,
          allowed_endpoints: ['mcp:local-tools:search_docs'],
        },
        body: [
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'search_docs', arguments: { query: 'allowed input' } },
          },
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'delete_docs', arguments: { id: 'blocked input' } },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(global.fetch).not.toHaveBeenCalled()
    const summary = service.getDashboardSummary()
    expect(summary.recent_calls[0]).toMatchObject({
      method: 'tools/call',
      tool_name: 'multiple',
      success: false,
      error_type: 'forbidden',
    })
    expect(JSON.stringify(summary)).not.toContain('allowed input')
    expect(JSON.stringify(summary)).not.toContain('blocked input')
  })

  it('enforces namespace allow-lists before upstream forwarding', async () => {
    const { service } = makeService()
    global.fetch = jest.fn()

    await expect(
      service.proxy({
        serverId: 'local-tools',
        apiKey: {
          ...apiKey,
          namespace_id: 'team-b',
          namespace_name: 'Team B',
        },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(service.getDashboardSummary().recent_calls[0]).toMatchObject({
      namespace_id: 'team-b',
      error_type: 'forbidden',
    })
  })
})
