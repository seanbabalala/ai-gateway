import * as fs from 'fs';
import * as path from 'path';

const root = process.cwd();
const examplesDir = path.join(root, 'examples', 'agents');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('agent framework examples', () => {
  const requiredFiles = [
    'examples/agents/.env.example',
    'examples/agents/README.md',
    'examples/agents/requirements.txt',
    'examples/agents/shared.py',
    'examples/agents/openai_sdk_base_url.py',
    'examples/agents/langchain_chat.py',
    'examples/agents/crewai_researcher.py',
    'examples/agents/openai_agents_sdk.py',
    'docs/AGENT_GATEWAY.md',
    'docs/AGENT_INTEGRATIONS.md',
  ];

  it('ships the expected example and documentation files', () => {
    for (const file of requiredFiles) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    }
  });

  it('covers the requested agent frameworks', () => {
    expect(read('examples/agents/openai_sdk_base_url.py')).toContain('from openai import OpenAI');
    expect(read('examples/agents/langchain_chat.py')).toContain('from langchain_openai import ChatOpenAI');
    expect(read('examples/agents/crewai_researcher.py')).toContain('from crewai import Agent, Crew, LLM, Process, Task');
    expect(read('examples/agents/openai_agents_sdk.py')).toContain('OpenAIChatCompletionsModel');
  });

  it('demonstrates SiftGate routing, namespace, session, trace, and structured-output signals', () => {
    const combined = requiredFiles
      .filter((file) => file.startsWith('examples/agents/'))
      .map((file) => read(file))
      .join('\n');

    for (const expected of [
      'SIFTGATE_API_KEY',
      'SIFTGATE_BASE_URL',
      'SIFTGATE_NAMESPACE',
      'SIFTGATE_SESSION_ID',
      'SIFTGATE_TRACE_ID',
      'x-siftgate-routing-hint',
      'x-session-id',
      'x-trace-id',
      'traceparent',
      'response_format',
      'json_schema',
      'output_pydantic',
      'output_type=AgentRunSummary',
    ]) {
      expect(combined).toContain(expected);
    }
  });

  it('documents how to observe cost, fallback, and route explanation through SiftGate', () => {
    const docs = `${read('examples/agents/README.md')}\n${read('docs/AGENT_INTEGRATIONS.md')}`;
    for (const expected of [
      'cost',
      'fallback',
      'Route Explanation',
      'session',
      'namespace',
      'Gateway API key',
    ]) {
      expect(docs).toContain(expected);
    }
  });

  it('documents v1.9 Agent Gateway Profiles and connector-safe policies', () => {
    const docs = [
      read('docs/AGENT_GATEWAY.md'),
      read('docs/AGENT_INTEGRATIONS.md'),
      read('examples/agents/README.md'),
    ].join('\n');

    for (const expected of [
      'Codex',
      'Claude Code',
      'Cherry Studio',
      'Hermes',
      'OpenClaw',
      'Generic OpenAI',
      'Generic Anthropic',
      'OPENAI_BASE_URL=http://localhost:2099/v1',
      'OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>',
      'ANTHROPIC_BASE_URL=http://localhost:2099',
      'ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>',
      'claude-siftgate-auto',
      'profile-scoped',
      'allow_auto',
      'allow_direct',
      'mcp:<serverId>:<toolName>',
      'Rendered configs do not expose stored secrets',
      'Provider API keys stay in Nodes',
    ]) {
      expect(docs).toContain(expected);
    }
  });

  it('does not include real-looking provider or gateway secrets', () => {
    const secretPatterns = [
      /\bsk-[A-Za-z0-9_-]{16,}\b/g,
      /\bgw_sk_live_[A-Za-z0-9_-]{8,}\b/g,
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    ];

    const files = fs
      .readdirSync(examplesDir)
      .filter((file) => !fs.statSync(path.join(examplesDir, file)).isDirectory());

    for (const file of files) {
      const content = fs.readFileSync(path.join(examplesDir, file), 'utf8');
      for (const pattern of secretPatterns) {
        expect(content.match(pattern)).toBeNull();
      }
    }
  });
});
