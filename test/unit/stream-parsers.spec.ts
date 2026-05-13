import { ChatCompletionsStreamParser } from '../../src/providers/stream/chat-completions.stream';
import { MessagesStreamParser } from '../../src/providers/stream/messages.stream';
import { ResponsesStreamParser } from '../../src/providers/stream/responses.stream';
import { CanonicalStreamEvent } from '../../src/canonical/canonical.types';
import { getCompatibilityProfile } from '../../src/catalog/compatibility-profiles';

/** Collect all events from feeding chunks to a parser */
function collect(parser: { parse(chunk: string): Generator<CanonicalStreamEvent> }, ...chunks: string[]): CanonicalStreamEvent[] {
  const events: CanonicalStreamEvent[] = [];
  for (const chunk of chunks) {
    for (const event of parser.parse(chunk)) {
      events.push(event);
    }
  }
  return events;
}

// ═══════════════════════════════════════════════════════════
// ChatCompletions Stream Parser
// ═══════════════════════════════════════════════════════════

describe('ChatCompletionsStreamParser', () => {
  it('should parse start event (role-only delta)', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('start');
    if (events[0].type === 'start') {
      expect(events[0].id).toBe('chatcmpl-1');
      expect(events[0].model).toBe('gpt-4o');
    }
  });

  it('should parse text delta', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'start', id: '1', model: 'gpt-4o' });
    expect(events[1].type).toBe('delta');
    if (events[1].type === 'delta') {
      expect(events[1].content.type).toBe('text');
      if (events[1].content.type === 'text') {
        expect(events[1].content.text).toBe('Hello ');
      }
    }
  });

  it('should parse tool_calls delta', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'start', id: '1', model: 'gpt-4o' });
    expect(events[1].type).toBe('delta');
    if (events[1].type === 'delta') {
      expect(events[1].content.type).toBe('tool_use');
    }
  });

  it('should parse finish_reason and usage', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'start', id: '1', model: 'gpt-4o' });
    expect(events[1].type).toBe('stop');
    if (events[1].type === 'stop') {
      expect(events[1].stop_reason).toBe('end_turn');
      expect(events[1].usage.input_tokens).toBe(10);
      expect(events[1].usage.output_tokens).toBe(5);
    }
  });

  it('should parse [DONE] signal', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser, 'data: [DONE]\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
  });

  it('should not emit duplicate stop on finish_reason + [DONE]', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
      'data: [DONE]\n\n',
    );
    const stopEvents = events.filter((e) => e.type === 'stop');
    expect(stopEvents).toHaveLength(1);
  });

  it('should handle usage-only chunk (no choices)', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"usage":{"prompt_tokens":50,"completion_tokens":20}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
    if (events[0].type === 'stop') {
      expect(events[0].usage.input_tokens).toBe(50);
      expect(events[0].usage.output_tokens).toBe(20);
    }
  });

  it('should map finish reasons correctly', () => {
    const parser = new ChatCompletionsStreamParser();

    const stopEvents = collect(parser,
      'data: {"id":"1","model":"m","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n',
    );
    const stop = stopEvents.find((event) => event.type === 'stop');
    expect(stop?.type).toBe('stop');
    if (stop?.type === 'stop') expect(stop.stop_reason).toBe('tool_use');
  });

  it('should handle chunked/split SSE lines across multiple calls', () => {
    const parser = new ChatCompletionsStreamParser();
    // Split a single SSE line across two chunks
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","cho',
      'ices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('start');
    expect(events[1].type).toBe('delta');
  });

  it('should skip comments and empty lines', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      ': this is a comment\n\n' +
      '\n\n' +
      'data: {"id":"1","model":"m","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('start');
    expect(events[1].type).toBe('delta');
  });

  it('should keep tool call id/name across indexed argument deltas', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}\n\n' +
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"finish_reason":null}]}\n\n' +
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]},"finish_reason":null}]}\n\n',
    );
    const deltas = events.filter((event) => event.type === 'delta') as Extract<CanonicalStreamEvent, { type: 'delta' }>[];
    expect(deltas).toHaveLength(3);
    expect(deltas[0].content).toMatchObject({ type: 'tool_use', id: 'call_1', name: 'search' });
    expect(deltas[1].content).toMatchObject({ type: 'tool_use', id: 'call_1', input_delta: '{"q":' });
    expect(deltas[2].content).toMatchObject({ type: 'tool_use', id: 'call_1', input_delta: '"test"}' });
  });

  it('should combine finish_reason with following usage-only chunk', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: {"id":"1","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":50,"completion_tokens":20}}\n\n' +
      'data: [DONE]\n\n',
    );
    const stopEvents = events.filter((event) => event.type === 'stop');
    expect(stopEvents).toHaveLength(1);
    const stop = stopEvents[0];
    if (stop.type === 'stop') {
      expect(stop.stop_reason).toBe('end_turn');
      expect(stop.usage.input_tokens).toBe(50);
      expect(stop.usage.output_tokens).toBe(20);
    }
  });

  it('should parse upstream error chunks', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"error":{"message":"bad request","code":"invalid_request_error"}}\n\n',
    );
    expect(events).toEqual([
      {
        type: 'error',
        error: { message: 'bad request', code: 'invalid_request_error' },
      },
    ]);
  });

  it('should skip unparseable JSON', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser, 'data: {invalid json}\n\n');
    expect(events).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Messages Stream Parser (Anthropic)
// ═══════════════════════════════════════════════════════════

describe('MessagesStreamParser', () => {
  it('should parse message_start → start event', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-3-opus","content":[],"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('start');
    if (events[0].type === 'start') {
      expect(events[0].id).toBe('msg_1');
      expect(events[0].model).toBe('claude-3-opus');
    }
  });

  it('should parse content_block_delta text_delta → text delta', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    );
    // content_block_start for text → no event; content_block_delta → text delta
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delta');
    if (events[0].type === 'delta') {
      expect(events[0].content.type).toBe('text');
      if (events[0].content.type === 'text') {
        expect(events[0].content.text).toBe('Hello');
      }
    }
  });

  it('should parse tool_use content_block_start → initial tool delta', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search"}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delta');
    if (events[0].type === 'delta') {
      expect(events[0].content.type).toBe('tool_use');
      if (events[0].content.type === 'tool_use') {
        expect(events[0].content.id).toBe('toolu_1');
        expect(events[0].content.name).toBe('search');
      }
    }
  });

  it('should parse input_json_delta', () => {
    const parser = new MessagesStreamParser();
    // Set up block first
    collect(parser,
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search"}}\n\n',
    );
    const events = collect(parser,
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
    );
    expect(events).toHaveLength(1);
    if (events[0].type === 'delta' && events[0].content.type === 'tool_use') {
      expect(events[0].content.input_delta).toBe('{"q":');
      expect(events[0].content.id).toBe('toolu_1');
    }
  });

  it('should parse message_delta → stop event', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
    if (events[0].type === 'stop') {
      expect(events[0].stop_reason).toBe('end_turn');
      expect(events[0].usage.output_tokens).toBe(15);
    }
  });

  it('should parse error event', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error.message).toBe('Overloaded');
    }
  });

  it('should skip ping events', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: ping\ndata: {"type":"ping"}\n\n',
    );
    expect(events).toHaveLength(0);
  });

  it('should handle chunked data across multiple parse calls', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","mod',
      'el":"claude-3","content":[]}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('start');
  });
});

// ═══════════════════════════════════════════════════════════
// Responses Stream Parser (OpenAI)
// ═══════════════════════════════════════════════════════════

describe('ResponsesStreamParser', () => {
  it('should parse response.created → start event', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.created\ndata: {"id":"resp_1","model":"gpt-5.4","status":"in_progress"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('start');
    if (events[0].type === 'start') {
      expect(events[0].id).toBe('resp_1');
      expect(events[0].model).toBe('gpt-5.4');
    }
  });

  it('should parse OpenAI wrapped response.created → start event', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.created\n' +
      'data: {"type":"response.created","response":{"id":"resp_wrapped","model":"gpt-5.5","status":"in_progress"}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('start');
    if (events[0].type === 'start') {
      expect(events[0].id).toBe('resp_wrapped');
      expect(events[0].model).toBe('gpt-5.5');
    }
  });

  it('should parse response.output_text.delta → text delta', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.output_text.delta\ndata: {"delta":"Hello world"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delta');
    if (events[0].type === 'delta' && events[0].content.type === 'text') {
      expect(events[0].content.text).toBe('Hello world');
    }
  });

  it('should skip empty text deltas', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.output_text.delta\ndata: {"delta":""}\n\n',
    );
    expect(events).toHaveLength(0);
  });

  it('should parse response.function_call_arguments.delta → tool_use delta', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.function_call_arguments.delta\ndata: {"call_id":"call_1","name":"search","delta":"{\\"q\\":\\"test\\"}"}\n\n',
    );
    expect(events).toHaveLength(1);
    if (events[0].type === 'delta' && events[0].content.type === 'tool_use') {
      expect(events[0].content.id).toBe('call_1');
      expect(events[0].content.name).toBe('search');
      expect(events[0].content.input_delta).toBe('{"q":"test"}');
    }
  });

  it('should parse response.output_item.added function_call → tool_use start', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.output_item.added\n' +
        'data: {"output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"shell","arguments":"","status":"in_progress"}}\n\n',
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delta');
    if (events[0].type === 'delta' && events[0].content.type === 'tool_use') {
      expect(events[0].content.id).toBe('call_1');
      expect(events[0].content.name).toBe('shell');
      expect(events[0].content.input_delta).toBeUndefined();
    }
  });

  it('should parse Responses function_call lifecycle before arguments', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.output_item.added\n' +
        'data: {"output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"shell","arguments":"","status":"in_progress"}}\n\n' +
        'event: response.function_call_arguments.delta\n' +
        'data: {"output_index":1,"item_id":"fc_1","call_id":"call_1","delta":"{\\"command\\":"}\n\n' +
        'event: response.function_call_arguments.delta\n' +
        'data: {"output_index":1,"item_id":"fc_1","call_id":"call_1","delta":"\\"pwd\\"}"}\n\n',
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: 'delta',
      content: { type: 'tool_use', id: 'call_1', name: 'shell' },
    });
    expect(events[1]).toMatchObject({
      type: 'delta',
      content: { type: 'tool_use', id: 'call_1', input_delta: '{"command":' },
    });
    expect(events[2]).toMatchObject({
      type: 'delta',
      content: { type: 'tool_use', id: 'call_1', input_delta: '"pwd"}' },
    });
  });

  it('should map Responses function argument item_id back to call_id', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.output_item.added\n' +
        'data: {"output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"shell","arguments":"","status":"in_progress"}}\n\n' +
        'event: response.function_call_arguments.delta\n' +
        'data: {"output_index":1,"item_id":"fc_1","delta":"{\\"command\\":\\"pwd\\"}"}\n\n',
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'delta',
      content: { type: 'tool_use', id: 'call_1', name: 'shell' },
    });
    expect(events[1]).toMatchObject({
      type: 'delta',
      content: {
        type: 'tool_use',
        id: 'call_1',
        input_delta: '{"command":"pwd"}',
      },
    });
  });

  it('should recover function_call arguments from output_item.done when deltas are absent', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.output_item.done\n' +
        'data: {"output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"shell","arguments":"{\\"command\\":\\"pwd\\"}","status":"completed"}}\n\n',
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'delta',
      content: { type: 'tool_use', id: 'call_1', name: 'shell' },
    });
    expect(events[1]).toMatchObject({
      type: 'delta',
      content: {
        type: 'tool_use',
        id: 'call_1',
        input_delta: '{"command":"pwd"}',
      },
    });
  });

  it('should parse response.completed → stop event', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.completed\ndata: {"id":"resp_1","status":"completed","usage":{"input_tokens":20,"output_tokens":10}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
    if (events[0].type === 'stop') {
      expect(events[0].stop_reason).toBe('end_turn');
      expect(events[0].usage.input_tokens).toBe(20);
      expect(events[0].usage.output_tokens).toBe(10);
    }
  });

  it('should parse [DONE] as a terminal stop event', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser, 'data: [DONE]\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
  });

  it('should not emit duplicate stop on response.completed followed by [DONE]', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.completed\n' +
        'data: {"id":"resp_1","status":"completed","usage":{"input_tokens":20,"output_tokens":10}}\n\n' +
        'data: [DONE]\n\n',
    );
    expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
  });

  it('should parse response.incomplete as max_tokens stop', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.incomplete\n' +
        'data: {"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete","usage":{"input_tokens":20,"output_tokens":4096}}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
    if (events[0].type === 'stop') {
      expect(events[0].stop_reason).toBe('max_tokens');
      expect(events[0].usage.input_tokens).toBe(20);
      expect(events[0].usage.output_tokens).toBe(4096);
    }
  });

  it('should parse OpenAI wrapped response.completed → stop event with usage', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.completed\n' +
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":20,"output_tokens":10,"input_tokens_details":{"cached_tokens":5}}}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stop');
    if (events[0].type === 'stop') {
      expect(events[0].stop_reason).toBe('end_turn');
      expect(events[0].usage.input_tokens).toBe(20);
      expect(events[0].usage.output_tokens).toBe(10);
      expect(events[0].usage.cache_read_input_tokens).toBe(5);
    }
  });

  it('should parse response.failed with nested response error', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(
      parser,
      'event: response.failed\n' +
        'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed","error":{"message":"Bad input","code":"invalid_request_error"}}}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error.message).toBe('Bad input');
      expect(events[0].error.code).toBe('invalid_request_error');
    }
  });

  it('should map incomplete status to max_tokens', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.completed\ndata: {"id":"resp_1","status":"incomplete","usage":{"input_tokens":20,"output_tokens":4096}}\n\n',
    );
    if (events[0].type === 'stop') {
      expect(events[0].stop_reason).toBe('max_tokens');
    }
  });

  it('should parse error event', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: error\ndata: {"message":"Rate limited","code":"rate_limit"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error.message).toBe('Rate limited');
      expect(events[0].error.code).toBe('rate_limit');
    }
  });

  it('should skip informational events', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.output_item.added\ndata: {"type":"message"}\n\n' +
      'event: response.in_progress\ndata: {"id":"resp_1"}\n\n' +
      'event: response.content_part.added\ndata: {"type":"output_text"}\n\n',
    );
    expect(events).toHaveLength(0);
  });

  it('should handle chunked data', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.created\ndata: {"id":"resp_1","mod',
      'el":"gpt-5.4"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('start');
  });
});

// ═══════════════════════════════════════════════════════════
// Cache Token Extraction in Stream Parsers
// ═══════════════════════════════════════════════════════════

describe('Stream Parsers — cache token extraction', () => {
  it('MessagesStreamParser should extract cache tokens from message_start usage', () => {
    const parser = new MessagesStreamParser();
    const events = collect(parser,
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-3-sonnet","usage":{"input_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":100}}}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
    );
    const stop = events.find(e => e.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.input_tokens).toBe(800);
      expect(stop.usage.output_tokens).toBe(10);
      expect(stop.usage.cache_creation_input_tokens).toBe(200);
      expect(stop.usage.cache_read_input_tokens).toBe(100);
    }
  });

  it('ChatCompletionsStreamParser should extract cached_tokens from usage chunk', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":500,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":300}}}\n\n',
    );
    const stop = events.find(e => e.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.input_tokens).toBe(500);
      expect(stop.usage.cache_read_input_tokens).toBe(300);
    }
  });

  it('ChatCompletionsStreamParser should extract cached_tokens from finish_reason chunk', () => {
    const parser = new ChatCompletionsStreamParser();
    const events = collect(parser,
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":50}}}\n\n',
    );
    const stop = events.find(e => e.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.cache_read_input_tokens).toBe(50);
    }
  });

  it('ChatCompletionsStreamParser should use the DeepSeek schema for prompt cache hit/miss counters', () => {
    const parser = new ChatCompletionsStreamParser(
      getCompatibilityProfile('deepseek_compatible')?.usage_schema
        ?.chat_completions,
    );
    const events = collect(
      parser,
      'data: {"id":"chatcmpl-1","model":"deepseek-chat","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[],"usage":{"completion_tokens":5,"prompt_cache_hit_tokens":80,"prompt_cache_miss_tokens":20,"total_tokens":105}}\n\n',
    );
    const stop = events.find((event) => event.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.input_tokens).toBe(100);
      expect(stop.usage.output_tokens).toBe(5);
      expect(stop.usage.cache_read_input_tokens).toBe(80);
    }
  });

  it('ResponsesStreamParser should extract cached_tokens from response.completed', () => {
    const parser = new ResponsesStreamParser();
    const events = collect(parser,
      'event: response.created\n' +
      'data: {"id":"resp_1","model":"gpt-4.1"}\n\n' +
      'event: response.completed\n' +
      'data: {"id":"resp_1","status":"completed","usage":{"input_tokens":800,"output_tokens":100,"input_token_details":{"cached_tokens":400}}}\n\n',
    );
    const stop = events.find(e => e.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.input_tokens).toBe(800);
      expect(stop.usage.cache_read_input_tokens).toBe(400);
    }
  });

  it('ResponsesStreamParser should extract input_tokens_details.cached_tokens in the final chunk', () => {
    const parser = new ResponsesStreamParser(
      getCompatibilityProfile('openai_responses_compatible')?.usage_schema
        ?.responses,
    );
    const events = collect(
      parser,
      'event: response.completed\ndata: {"id":"resp_1","status":"completed","usage":{"input_tokens":800,"output_tokens":100,"input_tokens_details":{"cached_tokens":512}}}\n\n',
    );
    const stop = events.find((event) => event.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.cache_read_input_tokens).toBe(512);
    }
  });

  it('ResponsesStreamParser should accept prompt_tokens_details.cached_tokens in the final chunk', () => {
    const parser = new ResponsesStreamParser(
      getCompatibilityProfile('openai_responses_compatible')?.usage_schema
        ?.responses,
    );
    const events = collect(
      parser,
      'event: response.completed\ndata: {"id":"resp_1","status":"completed","usage":{"input_tokens":800,"output_tokens":100,"prompt_tokens_details":{"cached_tokens":320}}}\n\n',
    );
    const stop = events.find((event) => event.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.cache_read_input_tokens).toBe(320);
    }
  });

  it('MessagesStreamParser should normalize Anthropic-compatible cache creation tokens into canonical input usage', () => {
    const parser = new MessagesStreamParser(
      getCompatibilityProfile('anthropic_messages_compatible')?.usage_schema
        ?.messages,
    );
    const events = collect(
      parser,
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4","usage":{"input_tokens":21,"cache_creation_input_tokens":188086,"cache_read_input_tokens":0}}}\n\n' +
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":393}}\n\n',
    );
    const stop = events.find((event) => event.type === 'stop');
    expect(stop).toBeDefined();
    if (stop?.type === 'stop') {
      expect(stop.usage.input_tokens).toBe(188107);
      expect(stop.usage.cache_creation_input_tokens).toBe(188086);
      expect(stop.usage.output_tokens).toBe(393);
    }
  });
});
