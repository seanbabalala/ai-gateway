import { ChatCompletionsDenormalizer } from '../../src/canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../../src/canonical/denormalizers/responses.denormalizer';
import { MessagesDenormalizer } from '../../src/canonical/denormalizers/messages.denormalizer';
import { CanonicalRequest, CanonicalResponse, Tier } from '../../src/canonical/canonical.types';

// ── Helpers ──────────────────────────────────────────────

function makeCanonicalRequest(
  overrides: Partial<CanonicalRequest> = {},
): CanonicalRequest {
  return {
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' },
    ],
    stream: false,
    metadata: {
      source_format: 'chat_completions',
      original_model: 'gpt-4',
      raw_headers: {},
    },
    ...overrides,
  };
}

function makeCanonicalResponse(
  overrides: Partial<CanonicalResponse> = {},
): CanonicalResponse {
  return {
    id: 'test_id_123',
    content: [{ type: 'text', text: 'Hello there!' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'gpt-4',
    routing: {
      tier: 'simple' as Tier,
      node: 'google',
      latency_ms: 150,
      score: -0.2,
      is_fallback: false,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// ChatCompletions Denormalizer
// ═══════════════════════════════════════════════════════════
describe('ChatCompletionsDenormalizer', () => {
  const denorm = new ChatCompletionsDenormalizer();

  describe('Request denormalization', () => {
    it('should denormalize a simple request', () => {
      const canonical = makeCanonicalRequest();
      const result = denorm.denormalize(canonical, 'gemini-2.0-flash');

      expect(result.model).toBe('gemini-2.0-flash');
      expect(result.stream).toBe(false);
      expect((result.messages as any[])[0]).toEqual({
        role: 'system',
        content: 'You are helpful.',
      });
      expect((result.messages as any[])[1]).toEqual({
        role: 'user',
        content: 'Hello!',
      });
    });

    it('should denormalize tools', () => {
      const canonical = makeCanonicalRequest({
        tools: [
          { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
        ],
        tool_choice: 'auto',
      });

      const result = denorm.denormalize(canonical, 'gpt-4');

      expect(result.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object' },
          },
        },
      ]);
      expect(result.tool_choice).toBe('auto');
    });

    it('should denormalize assistant message with tool_use blocks', () => {
      const canonical = makeCanonicalRequest({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check.' },
              { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Paris' } },
            ],
          },
        ],
      });

      const result = denorm.denormalize(canonical, 'gpt-4');
      const msg = (result.messages as any[])[0];

      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('Let me check.');
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls[0].id).toBe('call_1');
      expect(msg.tool_calls[0].function.name).toBe('get_weather');
    });

    it('should denormalize tool result message', () => {
      const canonical = makeCanonicalRequest({
        messages: [
          {
            role: 'tool',
            content: [
              { type: 'tool_result', tool_use_id: 'call_1', content: '22°C' },
            ],
          },
        ],
      });

      const result = denorm.denormalize(canonical, 'gpt-4');
      const msg = (result.messages as any[])[0];

      expect(msg.role).toBe('tool');
      expect(msg.tool_call_id).toBe('call_1');
      expect(msg.content).toBe('22°C');
    });

    it('should denormalize image blocks as image_url', () => {
      const canonical = makeCanonicalRequest({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Look at this' },
              { type: 'image', source: { type: 'url', media_type: 'image/jpeg', data: 'https://example.com/img.jpg' } },
            ],
          },
        ],
      });

      const result = denorm.denormalize(canonical, 'gpt-4');
      const parts = (result.messages as any[])[0].content;

      expect(parts[0]).toEqual({ type: 'text', text: 'Look at this' });
      expect(parts[1].type).toBe('image_url');
      expect(parts[1].image_url.url).toBe('https://example.com/img.jpg');
    });

    it('should map Responses text.format json_schema to OpenAI Chat response_format', () => {
      const schema = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      };
      const canonical = makeCanonicalRequest({
        metadata: {
          source_format: 'responses',
          original_model: 'auto',
          raw_headers: {},
        },
        response_format: {
          type: 'json_schema',
          source: 'responses.text.format',
          raw: { type: 'json_schema', name: 'Answer', schema, strict: true },
          json_schema: { name: 'Answer', schema, strict: true },
        },
        structured_output: {
          requested: true,
          type: 'json_schema',
          source: 'responses.text.format',
          name: 'Answer',
          schema,
          strict: true,
        },
      });

      const result = denorm.denormalize(canonical, 'gpt-4o');

      expect(result.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'Answer',
          schema,
          strict: true,
        },
      });
    });

    it('should map canonical reasoning effort to Chat reasoning_effort', () => {
      const canonical = makeCanonicalRequest({
        reasoning_effort: 'high',
        reasoning: {
          requested: true,
          source: 'responses.reasoning',
          effort: 'high',
          raw: { effort: 'high' },
        },
      });

      const result = denorm.denormalize(canonical, 'gpt-5');

      expect(result.reasoning_effort).toBe('high');
    });

    it('should preserve Gemini thinking_config for compatible chat forwarding', () => {
      const raw = { thinking_budget: 1024, include_thoughts: false };
      const canonical = makeCanonicalRequest({
        reasoning: {
          requested: true,
          source: 'gemini.thinking_config',
          budget_tokens: 1024,
          thinking: {
            source: 'gemini.thinking_config',
            raw,
            budget_tokens: 1024,
            include_thoughts: false,
          },
          raw,
        },
      });

      const result = denorm.denormalize(canonical, 'gemini-2.5-pro');

      expect(result.thinking_config).toEqual(raw);
    });
  });

  describe('Response denormalization', () => {
    it('should denormalize a simple text response', () => {
      const canonical = makeCanonicalResponse();
      const result = denorm.denormalizeResponse(canonical);

      expect(result.object).toBe('chat.completion');
      expect(result.model).toBe('gpt-4');
      expect((result.choices as any[])[0].message.content).toBe('Hello there!');
      expect((result.choices as any[])[0].finish_reason).toBe('stop');
      expect((result.usage as any).prompt_tokens).toBe(10);
      expect((result.usage as any).completion_tokens).toBe(5);
      expect((result.usage as any).total_tokens).toBe(15);
    });

    it('should denormalize tool_use response as tool_calls', () => {
      const canonical = makeCanonicalResponse({
        content: [
          { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Paris' } },
        ],
        stop_reason: 'tool_use',
      });

      const result = denorm.denormalizeResponse(canonical);
      const msg = (result.choices as any[])[0].message;

      expect(msg.content).toBeNull();
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls[0].function.name).toBe('get_weather');
      expect((result.choices as any[])[0].finish_reason).toBe('tool_calls');
    });

    it('should map max_tokens stop reason to length', () => {
      const canonical = makeCanonicalResponse({ stop_reason: 'max_tokens' });
      const result = denorm.denormalizeResponse(canonical);
      expect((result.choices as any[])[0].finish_reason).toBe('length');
    });

    it('should include cached token details in chat response usage', () => {
      const canonical = makeCanonicalResponse({
        usage: {
          input_tokens: 800,
          output_tokens: 100,
          cache_read_input_tokens: 512,
        },
      });

      const result = denorm.denormalizeResponse(canonical);

      expect(result.usage).toEqual(
        expect.objectContaining({
          prompt_tokens: 800,
          completion_tokens: 100,
          total_tokens: 900,
          prompt_tokens_details: { cached_tokens: 512 },
        }),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Responses Denormalizer
// ═══════════════════════════════════════════════════════════
describe('ResponsesDenormalizer', () => {
  const denorm = new ResponsesDenormalizer();

  describe('Request denormalization', () => {
    it('should extract system message as instructions', () => {
      const canonical = makeCanonicalRequest();
      const result = denorm.denormalize(canonical, 'gpt-4.1');

      expect(result.instructions).toBe('You are helpful.');
      expect(result.model).toBe('gpt-4.1');
    });

    it('should convert messages to input items', () => {
      const canonical = makeCanonicalRequest({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      });

      const result = denorm.denormalize(canonical, 'gpt-4.1');
      const input = result.input as any[];

      expect(input).toHaveLength(2);
      expect(input[0].type).toBe('message');
      expect(input[0].role).toBe('user');
      expect(input[1].type).toBe('message');
      expect(input[1].role).toBe('assistant');
    });

    it('should convert tool results to function_call_output', () => {
      const canonical = makeCanonicalRequest({
        messages: [
          {
            role: 'tool',
            content: [
              { type: 'tool_result', tool_use_id: 'call_1', content: '22°C' },
            ],
          },
        ],
      });

      const result = denorm.denormalize(canonical, 'gpt-4.1');
      const input = result.input as any[];

      expect(input[0].type).toBe('function_call_output');
      expect(input[0].call_id).toBe('call_1');
      expect(input[0].output).toBe('22°C');
    });

    it('should preserve previous_response_id for Responses upstream requests', () => {
      const canonical = makeCanonicalRequest({
        metadata: {
          source_format: 'responses',
          original_model: 'gpt-4.1',
          previous_response_id: 'resp_previous',
          raw_headers: {},
        },
      });

      const result = denorm.denormalize(canonical, 'gpt-4.1');

      expect(result.previous_response_id).toBe('resp_previous');
    });

    it('should map Chat response_format json_schema to Responses text.format', () => {
      const schema = {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      };
      const canonical = makeCanonicalRequest({
        response_format: {
          type: 'json_schema',
          source: 'chat_completions.response_format',
          raw: {
            type: 'json_schema',
            json_schema: { name: 'Answer', schema, strict: true },
          },
          json_schema: { name: 'Answer', schema, strict: true },
        },
        structured_output: {
          requested: true,
          type: 'json_schema',
          source: 'chat_completions.response_format',
          name: 'Answer',
          schema,
          strict: true,
        },
      });

      const result = denorm.denormalize(canonical, 'gpt-4.1');

      expect(result.text).toEqual({
        format: {
          type: 'json_schema',
          name: 'Answer',
          schema,
          strict: true,
        },
      });
    });

    it('should map canonical reasoning effort to Responses reasoning object', () => {
      const canonical = makeCanonicalRequest({
        reasoning_effort: 'medium',
        reasoning: {
          requested: true,
          source: 'chat_completions.reasoning_effort',
          effort: 'medium',
          raw: 'medium',
        },
      });

      const result = denorm.denormalize(canonical, 'gpt-5');

      expect(result.reasoning).toEqual({ effort: 'medium' });
    });

    it('should convert tools to function type', () => {
      const canonical = makeCanonicalRequest({
        tools: [{ name: 'fn1', description: 'A func', parameters: {} }],
      });

      const result = denorm.denormalize(canonical, 'gpt-4.1');
      expect((result.tools as any[])[0].type).toBe('function');
      expect((result.tools as any[])[0].name).toBe('fn1');
    });

    it('should use max_output_tokens', () => {
      const canonical = makeCanonicalRequest({ max_tokens: 500 });
      const result = denorm.denormalize(canonical, 'gpt-4.1');
      expect(result.max_output_tokens).toBe(500);
    });
  });

  describe('Response denormalization', () => {
    it('should denormalize a text response', () => {
      const canonical = makeCanonicalResponse();
      const result = denorm.denormalizeResponse(canonical);

      expect(result.object).toBe('response');
      expect(result.status).toBe('completed');
      expect((result.output as any[])[0].type).toBe('message');
      expect((result.output as any[])[0].content[0].type).toBe('output_text');
      expect((result.output as any[])[0].content[0].text).toBe('Hello there!');
    });

    it('should denormalize tool_use as function_call output', () => {
      const canonical = makeCanonicalResponse({
        content: [
          { type: 'text', text: 'Checking...' },
          { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Paris' } },
        ],
      });

      const result = denorm.denormalizeResponse(canonical);
      const output = result.output as any[];

      expect(output[0].type).toBe('message'); // text part
      expect(output[1].type).toBe('function_call'); // tool call
      expect(output[1].name).toBe('get_weather');
      expect(output[1].call_id).toBe('call_1');
    });

    it('should include modern and legacy cached token fields in response usage', () => {
      const canonical = makeCanonicalResponse({
        usage: {
          input_tokens: 800,
          output_tokens: 100,
          cache_read_input_tokens: 512,
        },
      });

      const result = denorm.denormalizeResponse(canonical);
      expect(result.usage).toEqual(
        expect.objectContaining({
          input_tokens: 800,
          output_tokens: 100,
          total_tokens: 900,
          input_tokens_details: { cached_tokens: 512 },
          prompt_tokens_details: { cached_tokens: 512 },
          input_token_details: { cached_tokens: 512 },
        }),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Messages Denormalizer
// ═══════════════════════════════════════════════════════════
describe('MessagesDenormalizer', () => {
  const denorm = new MessagesDenormalizer();

  describe('Request denormalization', () => {
    it('should extract system messages as top-level system field', () => {
      const canonical = makeCanonicalRequest();
      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');

      expect(result.system).toBe('You are helpful.');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      // max_tokens defaults to 4096 when not set in canonical (Anthropic requires it)
      expect(result.max_tokens).toBe(4096);
    });

    it('should set default max_tokens', () => {
      const canonical = makeCanonicalRequest({ max_tokens: undefined });
      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');
      expect(result.max_tokens).toBe(4096);
    });

  it('should convert tool_result to user message with tool_result block', () => {
      const canonical = makeCanonicalRequest({
        messages: [
          {
            role: 'tool',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: '22°C' },
            ],
          },
        ],
      });

      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');
      const msgs = result.messages as any[];

      // Should be wrapped in a user message (Anthropic format)
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content[0].type).toBe('tool_result');
      expect(msgs[0].content[0].tool_use_id).toBe('toolu_1');
    });

    it('should convert tools to Anthropic format with input_schema', () => {
      const canonical = makeCanonicalRequest({
        tools: [
          { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
        ],
      });

      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');
      expect((result.tools as any[])[0].input_schema).toEqual({ type: 'object' });
    });

    it('should convert tool_choice "required" to { type: "any" }', () => {
      const canonical = makeCanonicalRequest({ tool_choice: 'required' });
      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');
      expect(result.tool_choice).toEqual({ type: 'any' });
    });

    it('should convert tool_choice { name } to { type: "tool", name }', () => {
      const canonical = makeCanonicalRequest({
        tool_choice: { name: 'get_weather' },
      });
      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');
      expect(result.tool_choice).toEqual({ type: 'tool', name: 'get_weather' });
    });

    it('should convert stop to stop_sequences', () => {
      const canonical = makeCanonicalRequest({ stop: ['END', 'STOP'] });
      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');
      expect(result.stop_sequences).toEqual(['END', 'STOP']);
    });

    it('should map OpenAI structured output to Anthropic output_config.format', () => {
      const schema = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      };
      const canonical = makeCanonicalRequest({
        response_format: {
          type: 'json_schema',
          source: 'chat_completions.response_format',
          raw: {
            type: 'json_schema',
            json_schema: { name: 'Answer', schema, strict: true },
          },
          json_schema: { name: 'Answer', schema, strict: true },
        },
        structured_output: {
          requested: true,
          type: 'json_schema',
          source: 'chat_completions.response_format',
          name: 'Answer',
          schema,
          strict: true,
        },
      });

      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');

      expect(result.output_config).toEqual({
        format: {
          type: 'json_schema',
          schema,
        },
      });
    });

    it('should map canonical reasoning effort to Anthropic thinking budget', () => {
      const canonical = makeCanonicalRequest({
        max_tokens: 4096,
        reasoning_effort: 'medium',
        reasoning: {
          requested: true,
          source: 'chat_completions.reasoning_effort',
          effort: 'medium',
          raw: 'medium',
        },
      });

      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');

      expect(result.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 2048,
      });
    });

    it('should preserve native Anthropic thinking blocks', () => {
      const raw = { type: 'enabled', budget_tokens: 1024 };
      const canonical = makeCanonicalRequest({
        metadata: {
          source_format: 'messages',
          original_model: 'claude-sonnet-4-20250514',
          raw_headers: {},
        },
        thinking: {
          source: 'messages.thinking',
          raw,
          type: 'enabled',
          budget_tokens: 1024,
        },
        budget_tokens: 1024,
        reasoning: {
          requested: true,
          source: 'messages.thinking',
          effort: 'unknown',
          budget_tokens: 1024,
          thinking: {
            source: 'messages.thinking',
            raw,
            type: 'enabled',
            budget_tokens: 1024,
          },
          raw,
        },
      });

      const result = denorm.denormalize(canonical, 'claude-sonnet-4-20250514');

      expect(result.thinking).toEqual(raw);
    });
  });

  describe('Response denormalization', () => {
    it('should denormalize a text response', () => {
      const canonical = makeCanonicalResponse();
      const result = denorm.denormalizeResponse(canonical);

      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect((result.content as any[])[0]).toEqual({ type: 'text', text: 'Hello there!' });
      expect(result.stop_reason).toBe('end_turn');
      expect((result.usage as any).input_tokens).toBe(10);
      expect((result.usage as any).output_tokens).toBe(5);
    });

    it('should denormalize tool_use response', () => {
      const canonical = makeCanonicalResponse({
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } },
        ],
        stop_reason: 'tool_use',
      });

      const result = denorm.denormalizeResponse(canonical);

      expect((result.content as any[])[0].type).toBe('tool_use');
      expect((result.content as any[])[0].id).toBe('toolu_1');
      expect(result.stop_reason).toBe('tool_use');
    });
  });

  it('should forward cache_control for Anthropic system, message blocks, and tools', () => {
    const result = denorm.denormalize(
      {
        messages: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text: 'long system prompt',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'hello',
                cache_control: { type: 'ephemeral', ttl: '1h' },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'lookup',
            description: '',
            parameters: { type: 'object' },
            cache_control: { type: 'ephemeral' },
          },
        ],
        stream: false,
        metadata: {
          source_format: 'messages',
          raw_headers: {},
        },
      } as any,
      'claude-opus-4-7',
    );

    expect(result.system).toEqual([
      {
        type: 'text',
        text: 'long system prompt',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect((result.messages as any[])[0].content[0].cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
    expect((result.tools as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
