import type { CanonicalRequestMetadata } from '../canonical.types';

export function normalizeRequestIdentityHeaders(
  headers: Record<string, string>,
): Pick<
  CanonicalRequestMetadata,
  | 'session_id'
  | 'session_key'
  | 'trace_id'
  | 'client_source'
  | 'agent_session_id'
  | 'agent_turn_id'
  | 'agent_repo'
  | 'agent_project'
  | 'agent_connector'
> {
  const sessionId = firstHeader(headers, [
    'x-siftgate-agent-session-id',
    'x-agent-session-id',
    'x-session-id',
    'x-session-key',
    'x-siftgate-session-id',
    'session-id',
  ]);
  const traceId =
    firstHeader(headers, ['x-trace-id', 'x-siftgate-trace-id']) ||
    traceIdFromTraceparent(firstHeader(headers, ['traceparent'])) ||
    firstHeader(headers, ['x-request-id', 'request-id']);

  const agentSessionId = safeHeaderTag(
    firstHeader(headers, [
      'x-siftgate-agent-session-id',
      'x-agent-session-id',
      'x-coding-agent-session-id',
    ]),
  );
  const agentTurnId = safeHeaderTag(
    firstHeader(headers, [
      'x-siftgate-agent-turn-id',
      'x-agent-turn-id',
      'x-coding-agent-turn-id',
    ]),
  );
  const agentRepo = safeHeaderTag(
    firstHeader(headers, [
      'x-siftgate-repo',
      'x-siftgate-agent-repo',
      'x-agent-repo',
      'x-repository',
    ]),
  );
  const agentProject = safeHeaderTag(
    firstHeader(headers, [
      'x-siftgate-project',
      'x-siftgate-agent-project',
      'x-agent-project',
      'x-project',
    ]),
  );
  const agentConnector = safeHeaderTag(
    firstHeader(headers, [
      'x-siftgate-agent-connector',
      'x-agent-connector',
      'x-coding-agent-connector',
    ]),
    48,
  );
  const clientSource =
    normalizeKnownClientSource(agentConnector) ||
    normalizeClientSourceFromHeaders(headers);

  return {
    session_id: sessionId,
    session_key: sessionId,
    trace_id: traceId,
    client_source: clientSource,
    agent_session_id: agentSessionId,
    agent_turn_id: agentTurnId,
    agent_repo: agentRepo,
    agent_project: agentProject,
    agent_connector: agentConnector,
  };
}

export function normalizeClientSourceFromHeaders(
  headers: Record<string, string>,
): string | undefined {
  const explicit = normalizeKnownClientSource(
    firstHeader(headers, [
      'x-siftgate-client-source',
      'x-siftgate-client',
      'x-client-source',
      'x-client-name',
      'x-agent-client',
    ]),
  );
  if (explicit) return explicit;

  const userAgent = firstHeader(headers, ['user-agent']);
  const anthropicBeta = firstHeader(headers, ['anthropic-beta']);
  return classifyUserAgent(userAgent, anthropicBeta);
}

function firstHeader(
  headers: Record<string, string>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = headers[name] || headers[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function traceIdFromTraceparent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.trim().split('-');
  const traceId = parts[1];
  if (traceId && /^[a-f0-9]{32}$/i.test(traceId)) {
    return traceId.toLowerCase();
  }
  return undefined;
}

function normalizeKnownClientSource(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[\s.-]+/g, '_').trim();
  if (!normalized) return undefined;
  if (normalized.includes('claude_code') || normalized.includes('claudecode')) {
    return 'claude_code';
  }
  if (normalized.includes('codex')) return 'codex';
  if (normalized.includes('cherry')) return 'cherry_studio';
  if (normalized.includes('hermes')) return 'hermes';
  if (normalized.includes('openclaw')) return 'openclaw';
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('cline')) return 'cline';
  if (normalized.includes('curl')) return 'curl';
  if (normalized.includes('postman')) return 'postman';
  if (normalized.includes('insomnia')) return 'insomnia';
  if (normalized.includes('openai')) return 'openai_sdk';
  if (normalized.includes('anthropic')) return 'anthropic_sdk';
  if (normalized.includes('browser')) return 'browser';
  return undefined;
}

function classifyUserAgent(
  userAgent: string | undefined,
  anthropicBeta: string | undefined,
): string | undefined {
  const ua = (userAgent || '').toLowerCase();
  const beta = (anthropicBeta || '').toLowerCase();
  if (!ua && !beta) return undefined;

  if (beta.includes('claude-code') || ua.includes('claude-code')) {
    return 'claude_code';
  }
  if (ua.includes('claude') && ua.includes('code')) return 'claude_code';
  if (ua.includes('codex')) return 'codex';
  if (ua.includes('cherry')) return 'cherry_studio';
  if (ua.includes('hermes')) return 'hermes';
  if (ua.includes('openclaw')) return 'openclaw';
  if (ua.includes('cursor')) return 'cursor';
  if (ua.includes('cline')) return 'cline';
  if (ua.startsWith('curl/') || ua.includes(' curl/')) return 'curl';
  if (ua.includes('postmanruntime')) return 'postman';
  if (ua.includes('insomnia')) return 'insomnia';
  if (ua.includes('openai')) return 'openai_sdk';
  if (ua.includes('anthropic')) return 'anthropic_sdk';
  if (ua.includes('python-requests') || ua.includes('httpx') || ua.includes('aiohttp')) {
    return 'python_http';
  }
  if (ua.includes('node-fetch') || ua.includes('undici') || ua.includes('axios')) {
    return 'node_http';
  }
  if (ua.includes('mozilla/') || ua.includes('chrome/') || ua.includes('safari/')) {
    return 'browser';
  }
  return 'http_client';
}

function safeHeaderTag(
  value: string | undefined,
  maxLength = 120,
): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}
