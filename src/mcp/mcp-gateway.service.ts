import { BadGatewayException, ForbiddenException, GatewayTimeoutException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { ConfigService } from '../config/config.service'
import { SecretReferenceResolverService } from '../config/secret-reference-resolver.service'
import type { McpServerConfig, McpServerTransport, McpToolConfig } from '../config/gateway.config'
import type { GatewayApiKeyContext } from '../auth/gateway-api-key.service'
import { WorkspaceContextService } from '../workspaces/workspace-context.service'
import { normalizeWorkspaceId } from '../workspaces/workspace-scope'

export interface McpGatewayAuditEntry {
  id: string
  timestamp: string
  server_id: string
  server_name: string
  method: string
  tool_name: string | null
  batch_size: number
  workspace_id: string
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

interface McpUpstreamResult {
  statusCode: number
  contentType: string
  bodyText: string
  headers: Record<string, string>
  ok: boolean
}

@Injectable()
export class McpGatewayService {
  private readonly auditEntries: McpGatewayAuditEntry[] = []

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretReferenceResolverService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  getDashboardSummary(): McpGatewayDashboardSummary {
    const mcp = this.config.mcpGateway
    const workspaceId = normalizeWorkspaceId(this.workspaceContext.currentWorkspaceId())
    const entries = this.auditEntries.filter((entry) => entry.workspace_id === workspaceId)
    const servers = mcp.servers.map((server) => this.serverSummary(server, entries))
    const recentCalls = [...entries].reverse()
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
        recent_calls: entries.length,
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
      const upstream =
        this.resolveTransport(server) === 'stdio'
          ? await this.forwardStdio(server, input.body, requestId)
          : await this.forwardHttp(server, input.body, requestId)

      this.recordAudit({
        requestId,
        server,
        metadata,
        apiKey: input.apiKey,
        statusCode: upstream.statusCode,
        success: upstream.ok,
        latencyMs: Date.now() - started,
        errorType: upstream.ok ? null : `upstream_${upstream.statusCode}`,
      })

      return {
        requestId,
        statusCode: upstream.statusCode,
        contentType: upstream.contentType,
        bodyText: upstream.bodyText,
        headers: upstream.headers,
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

  private serverSummary(server: McpServerConfig, auditEntries = this.auditEntries): McpGatewayServerSummary {
    const entries = auditEntries.filter((entry) => entry.server_id === server.id)
    const errors = entries.filter((entry) => !entry.success)
    const last = entries.at(-1)
    return {
      id: server.id,
      name: server.name || server.id,
      description: server.description || null,
      enabled: server.enabled !== false,
      transport: server.transport || 'http_json_rpc',
      endpoint: safeEndpoint(server),
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
      'x-siftgate-mcp-request-id': requestId,
      ...configured,
    }
  }

  private resolveTransport(server: McpServerConfig): McpServerTransport {
    return server.transport || 'http_json_rpc'
  }

  private async forwardHttp(server: McpServerConfig, body: unknown, requestId: string): Promise<McpUpstreamResult> {
    if (!server.url) {
      throw new Error(`MCP server ${server.id} is missing url.`)
    }
    const headers = await this.buildUpstreamHeaders(server, requestId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(1, server.timeout_ms ?? 30_000))
    let response: Response
    try {
      response = await fetch(server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? null),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const responseHeaders = this.safeResponseHeaders(response.headers)
    responseHeaders['x-siftgate-mcp-request-id'] = requestId
    return {
      statusCode: response.status,
      contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
      bodyText: await response.text(),
      headers: responseHeaders,
      ok: response.ok,
    }
  }

  private async forwardStdio(server: McpServerConfig, body: unknown, requestId: string): Promise<McpUpstreamResult> {
    if (!server.command) {
      throw new Error(`MCP stdio server ${server.id} is missing command.`)
    }

    const timeoutMs = Math.max(1, server.timeout_ms ?? 30_000)
    const command = await this.secrets.resolveString(server.command, {
      location: `mcp.servers.${server.id}.command`,
    })
    const args = await Promise.all(
      (server.args || []).map((arg, index) =>
        this.secrets.resolveString(arg, {
          optional: true,
          location: `mcp.servers.${server.id}.args[${index}]`,
        }),
      ),
    )
    const configuredEnv = await this.secrets.resolveRecord(server.env, {
      optional: true,
      location: `mcp.servers.${server.id}.env`,
    })
    const cwd = server.cwd
      ? await this.secrets.resolveString(server.cwd, {
          optional: true,
          location: `mcp.servers.${server.id}.cwd`,
        })
      : undefined

    return new Promise<McpUpstreamResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          ...configuredEnv,
          SIFTGATE_MCP_REQUEST_ID: requestId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const expectedIds = requestIds(body)
      const initId = `siftgate-init-${requestId}`
      const shouldInitialize = shouldAutoInitializeStdio(body)
      const responses: unknown[] = []
      let stdoutBuffer = ''
      let stderrBuffer = ''
      let settled = false
      let sentBody = false

      const finish = (result: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.kill()
        resolve({
          statusCode: 200,
          contentType: 'application/json; charset=utf-8',
          bodyText: JSON.stringify(result),
          headers: {
            'x-siftgate-mcp-request-id': requestId,
          },
          ok: true,
        })
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.kill()
        reject(error)
      }

      const send = (message: unknown) => {
        child.stdin.write(`${JSON.stringify(message)}\n`)
      }

      const sendBody = () => {
        if (sentBody) return
        sentBody = true
        send(body ?? null)
        if (expectedIds.size === 0) {
          finish({ jsonrpc: '2.0', result: null })
        }
      }

      const timeout = setTimeout(() => {
        fail(new Error('MCP stdio upstream timed out.'))
      }, timeoutMs)

      child.once('error', (error) => fail(error))
      child.once('exit', (code, signal) => {
        if (settled) return
        const suffix = stderrBuffer.trim() ? `: ${sanitizeStdioError(stderrBuffer)}` : ''
        fail(new Error(`MCP stdio upstream exited before returning a response (${signal || code || 'unknown'})${suffix}`))
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer = limitBuffer(`${stderrBuffer}${chunk.toString('utf8')}`)
      })

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8')
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() || ''
        for (const line of lines) {
          const parsed = parseJsonLine(line)
          if (parsed === undefined) continue
          const messages = Array.isArray(parsed) ? parsed : [parsed]
          for (const message of messages) {
            const responseId = jsonRpcId(message)
            if (responseId === initId) {
              send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
              sendBody()
              continue
            }
            if (responseId !== null && expectedIds.has(responseId)) {
              responses.push(message)
            }
          }
          if (responses.length > 0 && responses.length >= expectedIds.size) {
            finish(Array.isArray(body) ? responses : responses[0])
          }
        }
      })

      if (shouldInitialize) {
        send({
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'siftgate-mcp-gateway',
              version: '1.0.0',
            },
          },
        })
      } else {
        sendBody()
      }
    })
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
      workspace_id: normalizeWorkspaceId(
        input.apiKey?.workspace_id || this.workspaceContext.currentWorkspaceId(),
      ),
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

function safeEndpoint(server: McpServerConfig): string {
  if ((server.transport || 'http_json_rpc') === 'stdio') {
    return `stdio:${server.command || server.id}`
  }
  const rawUrl = server.url || ''
  try {
    const url = new URL(rawUrl)
    return `${url.origin}${url.pathname}`
  } catch {
    return rawUrl.split('?')[0] || rawUrl
  }
}

function requestIds(body: unknown): Set<string> {
  const ids = new Set<string>()
  const requests = Array.isArray(body) ? body : [body]
  for (const item of requests) {
    if (!isRecord(item) || !('id' in item)) continue
    const id = item.id
    if (typeof id === 'string' || typeof id === 'number') {
      ids.add(String(id))
    }
  }
  return ids
}

function jsonRpcId(message: unknown): string | null {
  if (!isRecord(message)) return null
  const id = message.id
  if (typeof id === 'string' || typeof id === 'number') return String(id)
  return null
}

function shouldAutoInitializeStdio(body: unknown): boolean {
  const requests = Array.isArray(body) ? body : [body]
  return !requests.some((item) => isRecord(item) && item.method === 'initialize')
}

function parseJsonLine(line: string): unknown | undefined {
  const trimmed = line.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function limitBuffer(value: string): string {
  const max = 4000
  return value.length > max ? value.slice(value.length - max) : value
}

function sanitizeStdioError(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 300)
}
