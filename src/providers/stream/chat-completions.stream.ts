import { CanonicalStreamEvent, TokenUsage } from '../../canonical/canonical.types';

/**
 * Parses SSE stream from a chat/completions provider → CanonicalStreamEvent.
 *
 * Works for: OpenAI, Gemini, MiniMax (all use the same SSE format)
 *
 * SSE format:
 *   data: {"id":"...","choices":[{"delta":{"content":"..."}}],...}
 *   data: [DONE]
 */
export class ChatCompletionsStreamParser {
  private buffer = '';
  private hasSentStop = false;

  /**
   * Feed raw SSE text chunks and get parsed events.
   */
  *parse(chunk: string): Generator<CanonicalStreamEvent> {
    this.buffer += chunk;

    // Process complete lines
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith(':')) continue; // skip empty lines and comments

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6).trim();

        if (data === '[DONE]') {
          // Only emit stop if we haven't already from a finish_reason chunk
          if (!this.hasSentStop) {
            this.hasSentStop = true;
            yield {
              type: 'stop',
              stop_reason: 'end_turn',
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          }
          return;
        }

        try {
          const parsed = JSON.parse(data);
          yield* this.parseDataObject(parsed);
        } catch {
          // Skip unparseable lines
        }
      }
    }
  }

  private *parseDataObject(
    data: Record<string, unknown>,
  ): Generator<CanonicalStreamEvent> {
    const choices = data.choices as Record<string, unknown>[];
    if (!choices || choices.length === 0) {
      // Could be a usage-only chunk at the end
      if (data.usage) {
        const usage = data.usage as Record<string, unknown>;
        const promptDetails = (usage.prompt_tokens_details || {}) as Record<string, unknown>;
        yield {
          type: 'stop',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: (usage.prompt_tokens as number) || 0,
            output_tokens: (usage.completion_tokens as number) || 0,
            cache_read_input_tokens: (promptDetails.cached_tokens as number) || undefined,
          },
        };
      }
      return;
    }

    const choice = choices[0];
    const delta = (choice.delta || {}) as Record<string, unknown>;
    const finishReason = choice.finish_reason as string | null;

    // First chunk often has role but no content — emit start
    if (delta.role === 'assistant' && !delta.content && !delta.tool_calls) {
      yield {
        type: 'start',
        id: (data.id as string) || '',
        model: (data.model as string) || '',
      };
      return;
    }

    // Text delta
    if (delta.content !== undefined && delta.content !== null) {
      yield {
        type: 'delta',
        content: { type: 'text', text: delta.content as string },
      };
    }

    // Tool call delta
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls as Record<string, unknown>[]) {
        const fn = (tc.function || {}) as Record<string, unknown>;
        yield {
          type: 'delta',
          content: {
            type: 'tool_use',
            id: (tc.id as string) || '',
            name: fn.name as string | undefined,
            input_delta: fn.arguments as string | undefined,
          },
        };
      }
    }

    // Finish reason — end of stream
    if (finishReason) {
      this.hasSentStop = true;
      const usage = (data.usage || {}) as Record<string, unknown>;
      const promptDetails = (usage.prompt_tokens_details || {}) as Record<string, unknown>;
      yield {
        type: 'stop',
        stop_reason: this.mapFinishReason(finishReason),
        usage: {
          input_tokens: (usage.prompt_tokens as number) || 0,
          output_tokens: (usage.completion_tokens as number) || 0,
          cache_read_input_tokens: (promptDetails.cached_tokens as number) || undefined,
        },
      };
    }
  }

  private mapFinishReason(reason: string): string {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}
