import {
  ChatCompletionsStreamSerializer,
  ResponsesStreamSerializer,
  MessagesStreamSerializer,
} from '../../src/providers/stream/stream-serializers';
import { CanonicalStreamEvent } from '../../src/canonical/canonical.types';

const startEvent: CanonicalStreamEvent = {
  type: 'start',
  id: 'test-id-123',
  model: 'gpt-4o',
};

const textDelta: CanonicalStreamEvent = {
  type: 'delta',
  content: { type: 'text', text: 'Hello ' },
};

const toolUseDelta: CanonicalStreamEvent = {
  type: 'delta',
  content: { type: 'tool_use', id: 'call_1', name: 'search' },
};

const toolArgDelta: CanonicalStreamEvent = {
  type: 'delta',
  content: { type: 'tool_use', id: '', input_delta: '{"q":"test"}' },
};

const stopEvent: CanonicalStreamEvent = {
  type: 'stop',
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
};

const errorEvent: CanonicalStreamEvent = {
  type: 'error',
  error: { message: 'Something broke', code: 'internal_error' },
};

// ═══════════════════════════════════════════════════════════
// ChatCompletions Serializer
// ═══════════════════════════════════════════════════════════

describe('ChatCompletionsStreamSerializer', () => {
  let serializer: ChatCompletionsStreamSerializer;

  beforeEach(() => {
    serializer = new ChatCompletionsStreamSerializer();
  });

  it('should serialize start event as initial chunk with role', () => {
    const result = serializer.serialize(startEvent);
    expect(result).toMatch(/^data: /);
    const data = JSON.parse(result.replace('data: ', '').trim());
    expect(data.object).toBe('chat.completion.chunk');
    expect(data.model).toBe('gpt-4o');
    expect(data.choices[0].delta.role).toBe('assistant');
  });

  it('should serialize text delta', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(textDelta);
    const data = JSON.parse(result.replace('data: ', '').trim());
    expect(data.choices[0].delta.content).toBe('Hello ');
  });

  it('should serialize tool_use delta with name', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(toolUseDelta);
    const data = JSON.parse(result.replace('data: ', '').trim());
    expect(data.choices[0].delta.tool_calls).toBeDefined();
    expect(data.choices[0].delta.tool_calls[0].function.name).toBe('search');
  });

  it('should serialize tool argument delta', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(toolArgDelta);
    const data = JSON.parse(result.replace('data: ', '').trim());
    expect(data.choices[0].delta.tool_calls[0].function.arguments).toBe(
      '{"q":"test"}',
    );
  });

  it('should serialize stop event with finish_reason and [DONE]', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(stopEvent);
    expect(result).toContain('finish_reason');
    expect(result).toContain('[DONE]');
    // Parse the first SSE chunk (before [DONE])
    const firstData = JSON.parse(result.split('\n\n')[0].replace('data: ', ''));
    expect(firstData.choices[0].finish_reason).toBe('stop');
    expect(firstData.usage.prompt_tokens).toBe(10);
    expect(firstData.usage.completion_tokens).toBe(5);
  });

  it('should serialize error event', () => {
    const result = serializer.serialize(errorEvent);
    const data = JSON.parse(result.replace('data: ', '').trim());
    expect(data.error.message).toBe('Something broke');
  });

  it('should map stop reasons correctly', () => {
    serializer.serialize(startEvent);

    // tool_use → tool_calls
    const toolStop: CanonicalStreamEvent = {
      type: 'stop',
      stop_reason: 'tool_use',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const result = serializer.serialize(toolStop);
    const data = JSON.parse(result.split('\n\n')[0].replace('data: ', ''));
    expect(data.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should produce valid SSE format', () => {
    const result = serializer.serialize(startEvent);
    expect(result).toMatch(/^data: .+\n\n$/);
  });
});

// ═══════════════════════════════════════════════════════════
// Responses Serializer
// ═══════════════════════════════════════════════════════════

describe('ResponsesStreamSerializer', () => {
  let serializer: ResponsesStreamSerializer;

  beforeEach(() => {
    serializer = new ResponsesStreamSerializer();
  });

  it('should serialize start event with response.created', () => {
    const result = serializer.serialize(startEvent);
    expect(result).toContain('event: response.created');
    expect(result).toContain('event: response.in_progress');
    expect(result).toContain('event: response.output_item.added');
    expect(result).toContain('event: response.content_part.added');
  });

  it('should serialize text delta as response.output_text.delta', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(textDelta);
    expect(result).toContain('event: response.output_text.delta');
    const line = result.split('\n').find((l) => l.startsWith('data: '));
    const data = JSON.parse(line!.replace('data: ', ''));
    expect(data.delta).toBe('Hello ');
  });

  it('should serialize tool use as function_call', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(toolUseDelta);
    expect(result).toContain('event: response.output_item.added');
    const lines = result.split('\n').filter((l) => l.startsWith('data: '));
    const data = JSON.parse(lines[0].replace('data: ', ''));
    expect(data.item.type).toBe('function_call');
    expect(data.item.name).toBe('search');
  });

  it('should serialize stop event as response.completed', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(stopEvent);
    expect(result).toContain('event: response.completed');
    expect(result).toContain('event: response.output_text.done');
    expect(result).toContain('event: response.output_item.done');
  });

  it('should serialize error event', () => {
    const result = serializer.serialize(errorEvent);
    expect(result).toContain('event: error');
    const line = result.split('\n').find((l) => l.startsWith('data: '));
    const data = JSON.parse(line!.replace('data: ', ''));
    expect(data.message).toBe('Something broke');
  });

  it('should produce valid SSE format with event type', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(textDelta);
    expect(result).toMatch(/^event: .+\ndata: .+\n\n$/);
  });
});

// ═══════════════════════════════════════════════════════════
// Messages Serializer (Anthropic format)
// ═══════════════════════════════════════════════════════════

describe('MessagesStreamSerializer', () => {
  let serializer: MessagesStreamSerializer;

  beforeEach(() => {
    serializer = new MessagesStreamSerializer();
  });

  it('should serialize start event as message_start + content_block_start', () => {
    const result = serializer.serialize(startEvent);
    expect(result).toContain('event: message_start');
    expect(result).toContain('event: content_block_start');
    // Verify Anthropic format
    const lines = result.split('\n').filter((l) => l.startsWith('data: '));
    const msgStart = JSON.parse(lines[0].replace('data: ', ''));
    expect(msgStart.type).toBe('message_start');
    expect(msgStart.message.role).toBe('assistant');
    expect(msgStart.message.model).toBe('gpt-4o');
  });

  it('should serialize text delta as content_block_delta with text_delta', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(textDelta);
    expect(result).toContain('event: content_block_delta');
    const line = result.split('\n').find((l) => l.startsWith('data: '));
    const data = JSON.parse(line!.replace('data: ', ''));
    expect(data.delta.type).toBe('text_delta');
    expect(data.delta.text).toBe('Hello ');
  });

  it('should serialize tool_use as content_block_start with tool_use type', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(toolUseDelta);
    expect(result).toContain('event: content_block_stop'); // closes previous block
    expect(result).toContain('event: content_block_start');
    const lines = result.split('\n').filter((l) => l.startsWith('data: '));
    const blockStart = JSON.parse(lines[1].replace('data: ', ''));
    expect(blockStart.content_block.type).toBe('tool_use');
    expect(blockStart.content_block.name).toBe('search');
  });

  it('should serialize tool arg delta as input_json_delta', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(toolArgDelta);
    expect(result).toContain('event: content_block_delta');
    const line = result.split('\n').find((l) => l.startsWith('data: '));
    const data = JSON.parse(line!.replace('data: ', ''));
    expect(data.delta.type).toBe('input_json_delta');
    expect(data.delta.partial_json).toBe('{"q":"test"}');
  });

  it('should serialize stop event with message_delta + message_stop', () => {
    serializer.serialize(startEvent);
    const result = serializer.serialize(stopEvent);
    expect(result).toContain('event: content_block_stop');
    expect(result).toContain('event: message_delta');
    expect(result).toContain('event: message_stop');
    // Verify stop reason
    const lines = result.split('\n').filter((l) => l.startsWith('data: '));
    const msgDelta = JSON.parse(lines[1].replace('data: ', ''));
    expect(msgDelta.delta.stop_reason).toBe('end_turn');
    expect(msgDelta.usage.output_tokens).toBe(5);
  });

  it('should serialize error event in Anthropic format', () => {
    const result = serializer.serialize(errorEvent);
    expect(result).toContain('event: error');
    const line = result.split('\n').find((l) => l.startsWith('data: '));
    const data = JSON.parse(line!.replace('data: ', ''));
    expect(data.error.type).toBe('api_error');
    expect(data.error.message).toBe('Something broke');
  });
});

// ═══════════════════════════════════════════════════════════
// Cache Token Passthrough in Stream Serializers
// ═══════════════════════════════════════════════════════════

describe('Stream Serializers — cache token passthrough', () => {
  it('ChatCompletions serializer should include prompt_tokens_details in stop event', () => {
    const ser = new ChatCompletionsStreamSerializer();
    ser.serialize(startEvent);
    const result = ser.serialize({
      type: 'stop',
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 200 },
    });
    const lines = result.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
    const data = JSON.parse(lines[0].replace('data: ', ''));
    expect(data.usage.prompt_tokens).toBe(500);
    expect(data.usage.prompt_tokens_details).toEqual({ cached_tokens: 200 });
  });

  it('ChatCompletions serializer should NOT include prompt_tokens_details when no cache', () => {
    const ser = new ChatCompletionsStreamSerializer();
    ser.serialize(startEvent);
    const result = ser.serialize({
      type: 'stop',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    const lines = result.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
    const data = JSON.parse(lines[0].replace('data: ', ''));
    expect(data.usage.prompt_tokens_details).toBeUndefined();
  });

  it('Responses serializer should include both modern and legacy cached token fields in response.completed', () => {
    const ser = new ResponsesStreamSerializer();
    ser.serialize(startEvent);
    const result = ser.serialize({
      type: 'stop',
      stop_reason: 'end_turn',
      usage: { input_tokens: 800, output_tokens: 100, cache_read_input_tokens: 400 },
    });
    const completedLine = result.split('\n').find((l) => l.startsWith('data: ') && l.includes('response.completed'));
    // Actually, the event name is on a separate line
    const allLines = result.split('\n');
    const completedIdx = allLines.findIndex((l) => l.includes('response.completed'));
    const dataLine = allLines[completedIdx + 1];
    const data = JSON.parse(dataLine.replace('data: ', ''));
    expect(data.usage.prompt_tokens_details).toEqual({ cached_tokens: 400 });
    expect(data.usage.input_token_details).toEqual({ cached_tokens: 400 });
  });

  it('Messages serializer should include cache tokens in message_delta usage', () => {
    const ser = new MessagesStreamSerializer();
    ser.serialize(startEvent);
    const result = ser.serialize({
      type: 'stop',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 500, output_tokens: 20,
        cache_creation_input_tokens: 100, cache_read_input_tokens: 50,
      },
    });
    // Find message_delta event
    const allLines = result.split('\n');
    const deltaIdx = allLines.findIndex((l) => l.includes('event: message_delta'));
    const deltaData = JSON.parse(allLines[deltaIdx + 1].replace('data: ', ''));
    expect(deltaData.usage.cache_creation_input_tokens).toBe(100);
    expect(deltaData.usage.cache_read_input_tokens).toBe(50);
  });

  it('Messages serializer should NOT include cache tokens when absent', () => {
    const ser = new MessagesStreamSerializer();
    ser.serialize(startEvent);
    const result = ser.serialize({
      type: 'stop',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    const allLines = result.split('\n');
    const deltaIdx = allLines.findIndex((l) => l.includes('event: message_delta'));
    const deltaData = JSON.parse(allLines[deltaIdx + 1].replace('data: ', ''));
    expect(deltaData.usage.cache_creation_input_tokens).toBeUndefined();
    expect(deltaData.usage.cache_read_input_tokens).toBeUndefined();
  });
});
