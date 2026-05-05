import { BadGatewayException, ForbiddenException, GatewayTimeoutException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ConfigService } from '../config/config.service'
import { SecretReferenceResolverService } from '../config/secret-reference-resolver.service'
import type { McpServerConfig, McpToolConfig } from '../config/gateway.config'
import type { GatewayApiKeyContext } from '../auth/gateway-api-key.service'
import {
  GATEWAY_REQUEST_ID_HEADER,
  LEGACY_REQUEST_ID_HEADER,
  MCP_REQUEST_ID_HEADER,
} from '../http/public-contract'

export interface McpGatewayAuditEntry {
  id: string
  timestamp: string
  server_id: string
  server_name: string
  method: string
  tool_name: string | null
  batch_size: number
  api_key_id: string | null
  api_key_name: string | null
  namespace_id: string | null
  status_code: number
  success: boolean
  latency_ms: number
  error_type: string | null
  request_bytes: number
}

export interface McpGatewayServerSummary {
  id: string
  name: string
  description: string | null
  enabled: boolean
  transport: string
  endpoint: string
  allowed_namespaces: string[]
  tools: Array<{
    name: string
    description: string | null
    has_input_schema: boolean
  }>
  tags: string[]
  recent_calls: number
  recent_errors: number
  last_called_at: string | null
}

export interface McpGatewayDashboardSummary {
  enabled: boolean
  path: string
  metadata_only: boolean
  servers: McpGatewayServerSummary[]
  recent_calls: McpGatewayAuditEntry[]
  error_summary: Array<{
    server_id: string
    error_type: string
    count: number
    last_seen_at: string
  }>
  totals: {
    servers: number
    enabled_servers: number
    tools: number
    recent_calls: number
    recent_errors: number
  }
}

export interface McpProxyInput {
  serverId: string
  body: unknown
  apiKey?: GatewayApiKeyContext
}

export interface McpProxyResult {
  requestId: string
  statusCode: number
  contentType: string
  bodyText: string
  headers: Record<string, string>
}

interface McpRequestMetadata {
  methods: string[]
  toolName: string | null
  toolNames: string[]
  allRequestsAreNamedToolCalls: boolean
  batchSize: number
  requestBytes: number
}

@Injectable()
export class McpGatewayService {
  private readonly auditEntries: McpGatewayAuditEntry[] = []

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretReferenceResolverService,
  ) {}

  getDashboardSummary(): McpGatewayDashboardSummary {
    const mcp = this.config.mcpGateway
    const servers = mcp.servers.map((server) => this.serverSummary(server))
    const recentCalls = [...this.auditEntries].reverse()
    const recentErrors = recentCalls.filter((entry) => !entry.success)

    return {
      enabled: mcp.enabled,
      path: mcp.path,
      metadata_only: true,
      servers,
      recent_calls: recentCalls.slice(0, mcp.max_recent_calls),
      error_summary: this.buildErrorSummary(recentErrors),
      totals: {
        servers: servers.length,
        enabled_servers: servers.filter((server) => server.enabled).length,
        tools: servers.reduce((sum, server) => sum + server.tools.length, 0),
        recent_calls: this.auditEntries.length,
        recent_errors: recentErrors.length,
      },
    }
  }

  async proxy(input: McpProxyInput): Promise<McpProxyResult> {
    const mcp = this.config.mcpGateway
    if (!mcp.enabled) {
      throw new NotFoundException('MCP Gateway preview is disabled.')
    }

    const server = mcp.servers.find((item) => item.id === input.serverId)
    if (!server || server.enabled === false) {
      throw new NotFoundException(`Unknown or disabled MCP server: ${input.serverId}`)
    }

    const requestId = randomUUID()
    const started = Date.now()
    const metadata = this.extractMetadata(input.body)

    try {
      this.assertRequestSize(server, metadata.requestBytes)
      this.assertAccess(server, input.apiKey, metadata)
      const headers = await this.buildUpstreamHeaders(server, requestId)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), Math.max(1, server.timeout_ms ?? 30_000))
      let upstream: Response
      try {
        upstream = await fetch(server.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(input.body ?? null),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      const bodyText = await upstream.text()
      const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8'
      const responseHeaders = this.safeResponseHeaders(upstream.headers)
      responseHeaders[GATEWAY_REQUEST_ID_HEADER] = requestId
      responseHeaders[LEGACY_REQUEST_ID_HEADER] = requestId
      responseHeaders[MCP_REQUEST_ID_HEADER] = requestId

      this.recordAudit({
        requestId,
        server,
        metadata,
        apiKey: input.apiKey,
        statusCode: upstream.status,
        success: upstream.ok,
        latencyMs: Date.now() - started,
        errorType: upstream.ok ? null : `upstream_${upstream.status}`,
      })

      return {
        requestId,
        statusCode: upstream.status,
        contentType,
        bodyText,
        headers: responseHeaders,
      }
    } catch (error) {
      const errorType = this.errorType(error)
      this.recordAudit({
        requestId,
        server,
        metadata,
        apiKey: input.apiKey,
        statusCode: this.statusCodeForError(errorType),
        success: false,
        latencyMs: Date.now() - started,
        errorType,
      })
      if (error instanceof PayloadTooLargeException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('MCP upstream timed out.')
      }
      throw new BadGatewayException('MCP upstream request failed.')
    }
  }

  private serverSummary(server: McpServerConfig): McpGatewayServerSummary {
    const entries = this.auditEntries.filter((entry) => entry.server_id === server.id)
    const errors = entries.filter((entry) => !entry.success)
    const last = entries.at(-1)
    return {
      id: server.id,
      name: server.name || server.id,
      description: server.description || null,
      enabled: server.enabled !== false,
      transport: server.transport || 'http_json_rpc',
      endpoint: safeEndpoint(server.url),
      allowed_namespaces: server.allowed_namespaces || [],
      tools: (server.tools || []).map((tool) => this.toolSummary(tool)),
      tags: server.tags || [],
      recent_calls: entries.length,
      recent_errors: errors.length,
      last_called_at: last?.timestamp || null,
    }
  }

  private toolSummary(tool: McpToolConfig) {
    return {
      name: tool.name,
      description: tool.description || null,
      has_input_schema: Boolean(tool.input_schema),
    }
  }

  private buildErrorSummary(entries: McpGatewayAuditEntry[]) {
    const groups = new Map<
      string,
      {
        server_id: string
        error_type: string
        count: number
        last_seen_at: string
      }
    >()
    for (const entry of entries) {
      const errorType = entry.error_type || 'unknown'
      const key = `${entry.server_id}:${errorType}`
      const current = groups.get(key)
      if (!current) {
        groups.set(key, {
          server_id: entry.server_id,
          error_type: errorType,
          count: 1,
          last_seen_at: entry.timestamp,
        })
      } else {
        current.count += 1
        current.last_seen_at = entry.timestamp
      }
    }
    return [...groups.values()].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
  }

  private extractMetadata(body: unknown): McpRequestMetadata {
    const requests = Array.isArray(body) ? body : [body]
    const methods = requests
      .map((item) => (isRecord(item) && typeof item.method === 'string' ? item.method : 'unknown'))
      .filter((method, index, all) => all.indexOf(method) === index)
    const toolNames = requests
      .map((item) => (isRecord(item) && item.method === 'tools/call' && isRecord(item.params) && typeof item.params.name === 'string' ? item.params.name : null))
      .filter((name): name is string => Boolean(name))
      .filter((name, index, all) => all.indexOf(name) === index)
    const allRequestsAreNamedToolCalls =
      requests.length > 0 &&
      requests.every((item) => isRecord(item) && item.method === 'tools/call' && isRecord(item.params) && typeof item.params.name === 'string')
    const requestBytes = Buffer.byteLength(JSON.stringify(body ?? null), 'utf8')

    return {
      methods: methods.length ? methods : ['unknown'],
      toolName: toolNames.length === 1 ? toolNames[0] : toolNames.length > 1 ? 'multiple' : null,
      toolNames,
      allRequestsAreNamedToolCalls,
      batchSize: requests.length,
      requestBytes,
    }
  }

  private assertRequestSize(server: McpServerConfig, requestBytes: number): void {
    const max = server.max_request_bytes ?? 1_000_000
    if (requestBytes > max) {
      throw new PayloadTooLargeException(`MCP request exceeds max_request_bytes for server ${server.id}.`)
    }
  }

  private assertAccess(server: McpServerConfig, apiKey: GatewayApiKeyContext | undefined, metadata: McpRequestMetadata): void {
    const allowedEndpoints = apiKey?.allowed_endpoints || []
    if (allowedEndpoints.length > 0) {
      const hasServerAccess = allowedEndpoints.includes('mcp') || allowedEndpoints.includes(`mcp:${server.id}`)
      const hasToolAccess =
        metadata.allRequestsAreNamedToolCalls &&
        metadata.toolNames.length > 0 &&
        metadata.toolNames.every((toolName) => allowedEndpoints.includes(`mcp:${server.id}:${toolName}`))
      if (!hasServerAccess && !hasToolAccess) {
        throw new ForbiddenException(`This API key is not allowed to use MCP server ${server.id}.`)
      }
    }

    const namespaceId = apiKey?.namespace_id || null
    const allowedNamespaces = server.allowed_namespaces || []
    if (allowedNamespaces.length > 0 && !namespaceId) {
      throw new ForbiddenException(`MCP server ${server.id} requires an allowed namespace.`)
    }
    if (namespaceId && allowedNamespaces.length > 0 && !allowedNamespaces.includes(namespaceId)) {
      throw new ForbiddenException(`Namespace ${namespaceId} is not allowed to use MCP server ${server.id}.`)
    }
  }

  private async buildUpstreamHeaders(server: McpServerConfig, requestId: string): Promise<Record<string, string>> {
    const configured = await this.secrets.resolveRecord(server.headers, {
      optional: true,
      location: `mcp.servers.${server.id}.headers`,
    })
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      [GATEWAY_REQUEST_ID_HEADER]: requestId,
      [LEGACY_REQUEST_ID_HEADER]: requestId,
      [MCP_REQUEST_ID_HEADER]: requestId,
      ...configured,
    }
  }

  private safeResponseHeaders(headers: Headers): Record<string, string> {
    const allowed = new Set(['cache-control', 'content-language', 'content-type', 'mcp-session-id'])
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (allowed.has(lower)) {
        result[lower] = value
      }
    })
    return result
  }

  private recordAudit(input: {
    requestId: string
    server: McpServerConfig
    metadata: McpRequestMetadata
    apiKey?: GatewayApiKeyContext
    statusCode: number
    success: boolean
    latencyMs: number
    errorType: string | null
  }): void {
    const method = input.metadata.methods.length === 1 ? input.metadata.methods[0] : 'batch'
    this.auditEntries.push({
      id: input.requestId,
      timestamp: new Date().toISOString(),
      server_id: input.server.id,
      server_name: input.server.name || input.server.id,
      method,
      tool_name: input.metadata.toolName,
      batch_size: input.metadata.batchSize,
      api_key_id: input.apiKey?.id || null,
      api_key_name: input.apiKey?.name || null,
      namespace_id: input.apiKey?.namespace_id || null,
      status_code: input.statusCode,
      success: input.success,
      latency_ms: Math.max(0, input.latencyMs),
      error_type: input.errorType,
      request_bytes: input.metadata.requestBytes,
    })

    const max = Math.max(1, this.config.mcpGateway.max_recent_calls)
    while (this.auditEntries.length > max) {
      this.auditEntries.shift()
    }
  }

  private errorType(error: unknown): string {
    if (error instanceof PayloadTooLargeException) return 'request_too_large'
    if (error instanceof ForbiddenException) return 'forbidden'
    if (error instanceof NotFoundException) return 'not_found'
    if (error instanceof Error && error.name === 'AbortError') return 'upstream_timeout'
    return 'upstream_error'
  }

  private statusCodeForError(errorType: string): number {
    if (errorType === 'request_too_large') return 413
    if (errorType === 'forbidden') return 403
    if (errorType === 'not_found') return 404
    if (errorType === 'upstream_timeout') return 504
    return 502
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeEndpoint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.origin}${url.pathname}`
  } catch {
    return rawUrl.split('?')[0] || rawUrl
  }
}
