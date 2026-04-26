import { ChatCompletionsNormalizer } from '../../src/canonical/normalizers/chat-completions.normalizer';
import { ResponsesNormalizer } from '../../src/canonical/normalizers/responses.normalizer';
import { MessagesNormalizer } from '../../src/canonical/normalizers/messages.normalizer';

const headers = { 'content-type': 'application/json' };

// ═══════════════════════════════════════════════════════════
// ChatCompletions Normalizer
// ═══════════════════════════════════════════════════════════
describe('ChatCompletionsNormalizer', () => {
  const normalizer = new ChatCompletionsNormalizer();

  it('should normalize a simple text request', () => {
    const body = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ],
      temperature: 0.7,
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello!' });
    expect(result.temperature).toBe(0.7);
    expect(result.stream).toBe(false);
    expect(result.metadata.source_format).toBe('chat_completions');
    expect(result.metadata.original_model).toBe('gpt-4');
  });

  it('should normalize tool definitions', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ],
      tool_choice: 'auto',
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('get_weather');
    expect(result.tools![0].parameters).toHaveProperty('properties');
    expect(result.tool_choice).toBe('auto');
  });

  it('should normalize assistant message with tool_calls', () => {
    const body = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Weather in Paris?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_123', content: '22°C sunny' },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    // Assistant message with tool_use
    const assistantMsg = result.messages[1];
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    const blocks = assistantMsg.content as any[];
    expect(blocks[0].type).toBe('tool_use');
    expect(blocks[0].id).toBe('call_123');
    expect(blocks[0].name).toBe('get_weather');
    expect(blocks[0].input).toEqual({ city: 'Paris' });

    // Tool result message
    const toolMsg = result.messages[2];
    expect(toolMsg.role).toBe('tool');
    expect(Array.isArray(toolMsg.content)).toBe(true);
    const toolBlocks = toolMsg.content as any[];
    expect(toolBlocks[0].type).toBe('tool_result');
    expect(toolBlocks[0].tool_use_id).toBe('call_123');
    expect(toolBlocks[0].content).toBe('22°C sunny');
  });

  it('should normalize multimodal content (image_url)', () => {
    const body = {
      model: 'gpt-4-vision',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
          ],
        },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    const blocks = result.messages[0].content as any[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'What is in this image?' });
    expect(blocks[1].type).toBe('image');
    expect(blocks[1].source.type).toBe('url');
    expect(blocks[1].source.data).toBe('https://example.com/cat.jpg');
  });

  it('should normalize base64 image', () => {
    const body = {
      model: 'gpt-4-vision',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
            },
          ],
        },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source.type).toBe('base64');
    expect(blocks[0].source.media_type).toBe('image/png');
    expect(blocks[0].source.data).toBe('iVBORw0KGgo=');
  });

  it('should handle developer role as system', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'developer', content: 'System prompt' }],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.messages[0].role).toBe('system');
  });

  it('should handle legacy function_call format', () => {
    const body = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
        },
      ],
      function_call: 'auto',
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('tool_use');
    expect(blocks[0].name).toBe('get_weather');
    expect(result.tool_choice).toBe('auto');
  });

  it('should handle max_completion_tokens', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      max_completion_tokens: 500,
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.max_tokens).toBe(500);
  });

  it('should extract session key from headers', () => {
    const result = normalizer.normalize(
      { model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], stream: false },
      { ...headers, 'x-session-id': 'sess_abc123' },
    );
    expect(result.metadata.session_key).toBe('sess_abc123');
  });
});

// ═══════════════════════════════════════════════════════════
// Responses Normalizer
// ═══════════════════════════════════════════════════════════
describe('ResponsesNormalizer', () => {
  const normalizer = new ResponsesNormalizer();

  it('should normalize a simple string input', () => {
    const body = {
      model: 'gpt-4.1',
      input: 'Hello!',
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello!' });
    expect(result.metadata.source_format).toBe('responses');
  });

  it('should normalize instructions as system message', () => {
    const body = {
      model: 'gpt-4.1',
      instructions: 'You are a helpful assistant.',
      input: 'Hi',
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('should normalize array input with message items', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What is 2+2?' }],
        },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const blocks = result.messages[0].content as any[];
    expect(blocks[0]).toEqual({ type: 'text', text: 'What is 2+2?' });
  });

  it('should normalize function tools', () => {
    const body = {
      model: 'gpt-4.1',
      input: 'Weather?',
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
        },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('get_weather');
  });

  it('should normalize function_call_output items', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        { type: 'function_call_output', call_id: 'call_1', output: '22°C' },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages[0].role).toBe('tool');
    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('tool_result');
    expect(blocks[0].tool_use_id).toBe('call_1');
    expect(blocks[0].content).toBe('22°C');
  });

  it('should handle max_output_tokens', () => {
    const body = {
      model: 'gpt-4.1',
      input: 'Hi',
      max_output_tokens: 1000,
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.max_tokens).toBe(1000);
  });

  it('should skip non-function tools', () => {
    const body = {
      model: 'gpt-4.1',
      input: 'Search for cats',
      tools: [
        { type: 'web_search' },
        { type: 'function', name: 'fn1', description: 'A func', parameters: {} },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('fn1');
  });

  it('should normalize simple role/content input items', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Follow up' },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'First message' });
    expect(result.messages[1]).toEqual({ role: 'assistant', content: 'Response' });
    expect(result.messages[2]).toEqual({ role: 'user', content: 'Follow up' });
  });
});

// ═══════════════════════════════════════════════════════════
// Messages Normalizer
// ═══════════════════════════════════════════════════════════
describe('MessagesNormalizer', () => {
  const normalizer = new MessagesNormalizer();

  it('should normalize a simple text request', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello!' });
    expect(result.max_tokens).toBe(1024);
    expect(result.metadata.source_format).toBe('messages');
  });

  it('should normalize system as array of text blocks', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: [
        { type: 'text', text: 'Part 1.' },
        { type: 'text', text: 'Part 2.' },
      ],
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Part 1.\nPart 2.',
    });
  });

  it('should normalize tool_use and tool_result content blocks', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'Weather in Paris?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'get_weather',
              input: { city: 'Paris' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: '22°C sunny',
            },
          ],
        },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    // Assistant with tool_use
    const assistantBlocks = result.messages[1].content as any[];
    expect(assistantBlocks[0].type).toBe('tool_use');
    expect(assistantBlocks[0].id).toBe('toolu_123');
    expect(assistantBlocks[0].name).toBe('get_weather');
    expect(assistantBlocks[0].input).toEqual({ city: 'Paris' });

    // User with tool_result
    const userBlocks = result.messages[2].content as any[];
    expect(userBlocks[0].type).toBe('tool_result');
    expect(userBlocks[0].tool_use_id).toBe('toolu_123');
    expect(userBlocks[0].content).toBe('22°C sunny');
  });

  it('should normalize image content blocks', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
            { type: 'text', text: 'What is this?' },
          ],
        },
      ],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    const blocks = result.messages[0].content as any[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source.type).toBe('base64');
    expect(blocks[0].source.media_type).toBe('image/png');
    expect(blocks[1]).toEqual({ type: 'text', text: 'What is this?' });
  });

  it('should normalize Anthropic tools (input_schema)', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
      tool_choice: { type: 'auto' },
      stream: false,
    };

    const result = normalizer.normalize(body, headers);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('get_weather');
    expect(result.tools![0].parameters).toHaveProperty('properties');
    expect(result.tool_choice).toBe('auto');
  });

  it('should map tool_choice { type: "any" } to "required"', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'any' },
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.tool_choice).toBe('required');
  });

  it('should normalize stop_sequences', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      stop_sequences: ['END', 'STOP'],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.stop).toEqual(['END', 'STOP']);
  });

  it('should default max_tokens to 4096 if not provided', () => {
    const body = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    };

    const result = normalizer.normalize(body, headers);
    expect(result.max_tokens).toBe(4096);
  });
});
