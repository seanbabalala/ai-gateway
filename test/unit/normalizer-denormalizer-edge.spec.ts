/**
 * Normalizer + Denormalizer edge case tests.
 *
 * Extends the existing coverage with edge cases:
 * - Messages denormalizer: consecutive user merging, tool_choice, tool_result with array content
 * - Responses denormalizer: assistant with mixed text+tool_use, image denormalization
 * - Chat completions denormalizer: base64 image, tool-only assistant (no text), system blocks-to-text
 * - Normalizer edge cases: null content, function role, tool_result with mixed blocks, tool_choice objects
 */

import { ChatCompletionsNormalizer } from '../../src/canonical/normalizers/chat-completions.normalizer';
import { ResponsesNormalizer } from '../../src/canonical/normalizers/responses.normalizer';
import { MessagesNormalizer } from '../../src/canonical/normalizers/messages.normalizer';
import { ChatCompletionsDenormalizer } from '../../src/canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../../src/canonical/denormalizers/responses.denormalizer';
import { MessagesDenormalizer } from '../../src/canonical/denormalizers/messages.denormalizer';
import { CanonicalRequest, CanonicalResponse, Tier } from '../../src/canonical/canonical.types';

const headers = { 'content-type': 'application/json' };

function makeCanonicalRequest(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: false,
    metadata: { source_format: 'chat_completions', original_model: 'gpt-4', raw_headers: {} },
    ...overrides,
  };
}

function makeCanonicalResponse(overrides: Partial<CanonicalResponse> = {}): CanonicalResponse {
  return {
    id: 'test_id', content: [{ type: 'text', text: 'Hello!' }],
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
    model: 'gpt-4',
    routing: { tier: 'simple' as Tier, node: 'test', latency_ms: 100, score: 0.1, is_fallback: false },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// ChatCompletions Normalizer — edge cases
// ═══════════════════════════════════════════════════════════

describe('ChatCompletionsNormalizer — edge cases', () => {
  const normalizer = new ChatCompletionsNormalizer();

  it('should handle null content as empty string', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: null }],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.messages[0].content).toBe('');
  });

  it('should handle undefined content as empty string', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user' }],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.messages[0].content).toBe('');
  });

  it('should normalize function role as tool', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'function', name: 'get_weather', content: '22°C' }],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.messages[0].role).toBe('tool');
    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('tool_result');
    // function role goes through tool handler which uses tool_call_id (not name)
    expect(blocks[0].content).toBe('22°C');
  });

  it('should handle tool_choice as object {type:"function", function:{name:"..."}}', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Weather?' }],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.tool_choice).toEqual({ name: 'get_weather' });
  });

  it('should handle stop as string', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      stop: 'END',
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.stop).toEqual(['END']);
  });

  it('should handle stop as array', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      stop: ['END', 'STOP'],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.stop).toEqual(['END', 'STOP']);
  });
});

// ═══════════════════════════════════════════════════════════
// Responses Normalizer — edge cases
// ═══════════════════════════════════════════════════════════

describe('ResponsesNormalizer — edge cases', () => {
  const normalizer = new ResponsesNormalizer();

  it('should skip item_reference type silently', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        { type: 'item_reference', id: 'ref_123' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
      ],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should normalize input_image with data URI', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        { type: 'input_image', image_url: 'data:image/png;base64,abc123' },
      ],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source.type).toBe('base64');
    expect(blocks[0].source.data).toBe('abc123');
  });

  it('should normalize input_image with URL string', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        { type: 'input_image', image_url: 'https://example.com/img.jpg' },
      ],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source.type).toBe('url');
  });

  it('should normalize function_call in content array', () => {
    const body = {
      model: 'gpt-4.1',
      input: [
        {
          type: 'message', role: 'assistant',
          content: [
            { type: 'output_text', text: 'Let me check.' },
            { type: 'function_call', call_id: 'call_1', name: 'search', arguments: '{"q":"test"}' },
          ],
        },
      ],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    const blocks = result.messages[0].content as any[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('tool_use');
    expect(blocks[1].name).toBe('search');
  });

  it('should handle tool_choice string', () => {
    const body = {
      model: 'gpt-4.1',
      input: 'Hi',
      tool_choice: 'required',
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.tool_choice).toBe('required');
  });
});

// ═══════════════════════════════════════════════════════════
// Messages Normalizer — edge cases
// ═══════════════════════════════════════════════════════════

describe('MessagesNormalizer — edge cases', () => {
  const normalizer = new MessagesNormalizer();

  it('should normalize tool_result with array of mixed text+image blocks', () => {
    const body = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [
            { type: 'text', text: 'Screenshot captured' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        }],
      }],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('tool_result');
    const inner = blocks[0].content as any[];
    expect(inner).toHaveLength(2);
    expect(inner[0].type).toBe('text');
    expect(inner[1].type).toBe('image');
  });

  it('should handle tool_choice { type: "none" }', () => {
    const body = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'none' },
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.tool_choice).toBe('none');
  });

  it('should handle tool_choice { type: "tool", name: "..." }', () => {
    const body = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'tool', name: 'get_weather' },
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.tool_choice).toEqual({ name: 'get_weather' });
  });

  it('should handle non-array content as string coercion', () => {
    const body = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 12345 }],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    expect(result.messages[0].content).toBe('12345');
  });

  it('should handle unknown content block types as JSON text', () => {
    const body = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [{ type: 'unknown_type', data: 'test' }] }],
      stream: false,
    };
    const result = normalizer.normalize(body, headers);
    const blocks = result.messages[0].content as any[];
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toContain('unknown_type');
  });
});

// ═══════════════════════════════════════════════════════════
// Messages Denormalizer — edge cases
// ═══════════════════════════════════════════════════════════

describe('MessagesDenormalizer — edge cases', () => {
  const denorm = new MessagesDenormalizer();

  it('should merge consecutive user string messages', () => {
    const canonical = makeCanonicalRequest({
      messages: [
        { role: 'user', content: 'First' },
        { role: 'user', content: 'Second' },
      ],
    });
    const result = denorm.denormalize(canonical, 'claude-3-opus');
    const msgs = result.messages as any[];
    // Should be merged into one user message
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    // Merged as array of text blocks
    expect(Array.isArray(msgs[0].content)).toBe(true);
    expect(msgs[0].content).toHaveLength(2);
  });

  it('should merge consecutive user array messages', () => {
    const canonical = makeCanonicalRequest({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Part 1' }] },
        { role: 'user', content: [{ type: 'text', text: 'Part 2' }] },
      ],
    });
    const result = denorm.denormalize(canonical, 'claude-3-opus');
    const msgs = result.messages as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toHaveLength(2);
  });

  it('should merge tool_result into preceding user message', () => {
    const canonical = makeCanonicalRequest({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'User msg' }] },
        { role: 'tool', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Result' }] },
      ],
    });
    const result = denorm.denormalize(canonical, 'claude-3-opus');
    const msgs = result.messages as any[];
    // tool_result should merge into the user message
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content.length).toBe(2);
  });

  it('should denormalize tool_choice "none" as auto (Anthropic fallback)', () => {
    const canonical = makeCanonicalRequest({ tool_choice: 'none' });
    const result = denorm.denormalize(canonical, 'claude-3-opus');
    expect(result.tool_choice).toEqual({ type: 'auto' });
  });

  it('should denormalize assistant with string content as text block array', () => {
    const canonical = makeCanonicalRequest({
      messages: [{ role: 'assistant', content: 'I am helpful.' }],
    });
    const result = denorm.denormalize(canonical, 'claude-3-opus');
    const msgs = result.messages as any[];
    expect(msgs[0].content).toEqual([{ type: 'text', text: 'I am helpful.' }]);
  });

  it('should denormalize response with tool_use stop reason', () => {
    const canonical = makeCanonicalResponse({
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'test' } },
      ],
      stop_reason: 'tool_use',
    });
    const result = denorm.denormalizeResponse(canonical);
    expect(result.stop_reason).toBe('tool_use');
    expect((result.content as any[])[0].type).toBe('tool_use');
  });

  it('should map unknown stop_reason to end_turn', () => {
    const canonical = makeCanonicalResponse({ stop_reason: 'unknown_reason' as any });
    const result = denorm.denormalizeResponse(canonical);
    expect(result.stop_reason).toBe('end_turn');
  });
});

// ═══════════════════════════════════════════════════════════
// Responses Denormalizer — edge cases
// ═══════════════════════════════════════════════════════════

describe('ResponsesDenormalizer — edge cases', () => {
  const denorm = new ResponsesDenormalizer();

  it('should denormalize assistant message with mixed text+tool_use as separate output items', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search...' },
          { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'test' } },
        ],
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4.1');
    const input = result.input as any[];
    // Text part as message item
    const messageItem = input.find((i: any) => i.type === 'message' && i.role === 'assistant');
    expect(messageItem).toBeDefined();
    expect(messageItem.content[0].type).toBe('output_text');
    // Tool call as separate function_call item
    const fcItem = input.find((i: any) => i.type === 'function_call');
    expect(fcItem).toBeDefined();
    expect(fcItem.name).toBe('search');
  });

  it('should denormalize base64 image as data URI', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
        }],
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4.1');
    const input = result.input as any[];
    const content = input[0].content as any[];
    expect(content[0].type).toBe('input_image');
    expect(content[0].image_url).toBe('data:image/png;base64,abc123');
  });

  it('should denormalize URL image', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'url', media_type: 'image/jpeg', data: 'https://example.com/img.jpg' },
        }],
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4.1');
    const input = result.input as any[];
    const content = input[0].content as any[];
    expect(content[0].image_url).toBe('https://example.com/img.jpg');
  });

  it('should handle tool_choice as object', () => {
    const canonical = makeCanonicalRequest({ tool_choice: { name: 'search' } });
    const result = denorm.denormalize(canonical, 'gpt-4.1');
    expect(result.tool_choice).toEqual({ type: 'function', name: 'search' });
  });

  it('should denormalize response with only tool_use (no text)', () => {
    const canonical = makeCanonicalResponse({
      content: [
        { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'test' } },
      ],
    });
    const result = denorm.denormalizeResponse(canonical);
    const output = result.output as any[];
    // No message item (no text), just function_call
    expect(output).toHaveLength(1);
    expect(output[0].type).toBe('function_call');
  });
});

// ═══════════════════════════════════════════════════════════
// ChatCompletions Denormalizer — edge cases
// ═══════════════════════════════════════════════════════════

describe('ChatCompletionsDenormalizer — edge cases', () => {
  const denorm = new ChatCompletionsDenormalizer();

  it('should denormalize base64 image as data URI', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
        }],
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4');
    const content = (result.messages as any[])[0].content;
    expect(content[0].type).toBe('image_url');
    expect(content[0].image_url.url).toBe('data:image/png;base64,abc123');
  });

  it('should denormalize assistant tool_use only (no text) with null content', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'test' } },
        ],
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4');
    const msg = (result.messages as any[])[0];
    expect(msg.content).toBeNull();
    expect(msg.tool_calls).toHaveLength(1);
  });

  it('should denormalize system message with content blocks as text', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'system',
        content: [
          { type: 'text', text: 'You are' },
          { type: 'text', text: ' helpful.' },
        ],
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4');
    const msg = (result.messages as any[])[0];
    expect(msg.role).toBe('system');
    expect(msg.content).toBe('You are helpful.');
  });

  it('should denormalize tool result with no tool_result block gracefully', () => {
    const canonical = makeCanonicalRequest({
      messages: [{
        role: 'tool',
        content: 'Plain text result',
      }],
    });
    const result = denorm.denormalize(canonical, 'gpt-4');
    const msg = (result.messages as any[])[0];
    expect(msg.role).toBe('tool');
  });

  it('should map stop_sequence to stop in response', () => {
    const canonical = makeCanonicalResponse({ stop_reason: 'stop_sequence' });
    const result = denorm.denormalizeResponse(canonical);
    expect((result.choices as any[])[0].finish_reason).toBe('stop');
  });
});
