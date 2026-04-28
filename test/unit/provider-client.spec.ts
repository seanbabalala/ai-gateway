import { ProviderClientService, ProviderError } from '../../src/providers/provider-client.service';
import { Tier } from '../../src/canonical/canonical.types';

const routingMeta = { tier: 'standard' as Tier, score: 0.1, is_fallback: false };

function makeService(): ProviderClientService {
  return new ProviderClientService({} as any);
}

describe('ProviderClientService', () => {
  // ── Response Normalization ──────────────────────────────

  describe('normalizeResponse — chat_completions', () => {
    it('should normalize a simple text response', () => {
      const svc = makeService();
      const body = {
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          { message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'openai', 'gpt-4o', 150);
      expect(result.id).toBe('chatcmpl-1');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
      expect(result.model).toBe('gpt-4o');
      expect(result.routing.node).toBe('openai');
      expect(result.routing.latency_ms).toBe(150);
    });

    it('should normalize tool_calls', () => {
      const svc = makeService();
      const body = {
        id: 'chatcmpl-2',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'openai', 'gpt-4o', 200);
      expect(result.stop_reason).toBe('tool_use');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('search');
        expect(result.content[0].input).toEqual({ q: 'test' });
      }
    });

    it('should map finish_reason "length" to "max_tokens"', () => {
      const svc = makeService();
      const body = {
        id: 'x', model: 'gpt-4o',
        choices: [{ message: { content: 'partial...' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'n', 'm', 100);
      expect(result.stop_reason).toBe('max_tokens');
    });
  });

  describe('normalizeResponse — messages', () => {
    it('should normalize Anthropic Messages response', () => {
      const svc = makeService();
      const body = {
        id: 'msg_1',
        model: 'claude-3-opus',
        content: [
          { type: 'text', text: 'Hello from Claude' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      const result = svc.normalizeResponse(body, 'messages', routingMeta, 'claude', 'claude-3-opus', 300);
      expect(result.id).toBe('msg_1');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello from Claude' });
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    });

    it('should handle tool_use blocks', () => {
      const svc = makeService();
      const body = {
        id: 'msg_2', model: 'claude-3-opus',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'search', input: { query: 'test' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 30 },
      };
      const result = svc.normalizeResponse(body, 'messages', routingMeta, 'claude', 'claude-3-opus', 200);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('search');
        expect(result.content[0].input).toEqual({ query: 'test' });
      }
    });
  });

  describe('normalizeResponse — responses', () => {
    it('should normalize OpenAI Responses API response', () => {
      const svc = makeService();
      const body = {
        id: 'resp_1',
        model: 'gpt-5.4',
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'Answer here' }] },
        ],
        usage: { input_tokens: 30, output_tokens: 20 },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-5.4', 250);
      expect(result.id).toBe('resp_1');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Answer here' });
      expect(result.stop_reason).toBe('end_turn');
    });

    it('should handle function_call outputs', () => {
      const svc = makeService();
      const body = {
        id: 'resp_2', model: 'gpt-5.4', status: 'completed',
        output: [
          { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"NYC"}' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-5.4', 100);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('get_weather');
        expect(result.content[0].input).toEqual({ city: 'NYC' });
      }
    });

    it('should map incomplete status to max_tokens', () => {
      const svc = makeService();
      const body = {
        id: 'resp_3', model: 'gpt-5.4', status: 'incomplete',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '...' }] }],
        usage: { input_tokens: 10, output_tokens: 4096 },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-5.4', 100);
      expect(result.stop_reason).toBe('max_tokens');
    });
  });

  // ── ProviderError ───────────────────────────────────────

  describe('ProviderError', () => {
    it('should have statusCode and nodeId', () => {
      const err = new ProviderError('test error', 429, 'openai');
      expect(err.message).toBe('test error');
      expect(err.statusCode).toBe(429);
      expect(err.nodeId).toBe('openai');
      expect(err.name).toBe('ProviderError');
      expect(err instanceof Error).toBe(true);
    });
  });

  // ── Native Messages Passthrough (via private methods accessed indirectly) ──

  describe('denormalizeRequest — native messages passthrough', () => {
    it('should passthrough raw_body for messages → messages', () => {
      const svc = makeService();
      const canonical = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          original_model: 'claude-3-opus',
          raw_headers: {},
          raw_body: {
            model: 'claude-3-opus',
            stream: false,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 100,
          },
        },
      };
      // Access private method via any cast (matching existing test patterns)
      const body = (svc as any).denormalizeRequest(canonical, 'messages', 'claude-3-opus-20240229');
      expect(body.model).toBe('claude-3-opus-20240229'); // remapped to target model
      expect(body.stream).toBe(false);
      expect(body.messages).toBeDefined();
      expect(body.max_tokens).toBe(100);
    });

    it('should sanitize empty text blocks in native passthrough', () => {
      const svc = makeService();
      const canonical = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
        stream: true,
        metadata: {
          source_format: 'messages' as const,
          original_model: 'claude-3-opus',
          raw_headers: {},
          raw_body: {
            model: 'claude-3-opus',
            stream: true,
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: '' },
                  { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { cmd: 'ls' } },
                ],
              },
            ],
          },
        },
      };
      const body = (svc as any).denormalizeRequest(canonical, 'messages', 'claude-3-opus');
      // Empty text block should be removed
      expect(body.messages[0].content).toHaveLength(1);
      expect(body.messages[0].content[0].type).toBe('tool_use');
    });
  });

  // ── Header extraction ──────────────────────────────────

  describe('extractNativeMessageHeaders', () => {
    it('should forward anthropic-version header', () => {
      const svc = makeService();
      const canonical = {
        messages: [],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          raw_headers: { 'anthropic-version': '2023-06-01' },
        },
      };
      const headers = (svc as any).extractNativeMessageHeaders(canonical);
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should filter anthropic-beta to allowed values only', () => {
      const svc = makeService();
      const canonical = {
        messages: [],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          raw_headers: {
            'anthropic-beta': 'claude-code-20250219,some-unknown-beta,context-management-2025-06-27',
          },
        },
      };
      const headers = (svc as any).extractNativeMessageHeaders(canonical);
      expect(headers['anthropic-beta']).toBe('claude-code-20250219,context-management-2025-06-27');
    });

    it('should not set anthropic-beta if all betas are filtered out', () => {
      const svc = makeService();
      const canonical = {
        messages: [],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          raw_headers: { 'anthropic-beta': 'unknown-beta-1,unknown-beta-2' },
        },
      };
      const headers = (svc as any).extractNativeMessageHeaders(canonical);
      expect(headers['anthropic-beta']).toBeUndefined();
    });
  });
});
