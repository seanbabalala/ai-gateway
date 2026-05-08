import type { CanonicalRequestMetadata } from '../canonical.types';

export function normalizeRequestIdentityHeaders(
  headers: Record<string, string>,
): Pick<
  CanonicalRequestMetadata,
  | 'session_id'
  | 'session_key'
  | 'trace_id'
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

  return {
    session_id: sessionId,
    session_key: sessionId,
    trace_id: traceId,
    agent_session_id: agentSessionId,
    agent_turn_id: agentTurnId,
    agent_repo: agentRepo,
    agent_project: agentProject,
    agent_connector: agentConnector,
  };
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
