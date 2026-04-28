import { CanonicalStreamEvent } from '../../canonical/canonical.types';

/**
 * Serializes CanonicalStreamEvent → SSE text for each client protocol.
 */

// ═══════════════════════════════════════════════════════
// Chat Completions SSE Serializer
// ═══════════════════════════════════════════════════════

export class ChatCompletionsStreamSerializer {
  private id = '';
  private model = '';

  serialize(event: CanonicalStreamEvent): string {
    switch (event.type) {
      case 'start': {
        this.id = event.id;
        this.model = event.model;
        return this.sse({
          id: this.id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.model,
          choices: [
            { index: 0, delta: { role: 'assistant' }, finish_reason: null },
          ],
        });
      }

      case 'delta': {
        if (event.content.type === 'text') {
          return this.sse({
            id: this.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.model,
            choices: [
              {
                index: 0,
                delta: { content: event.content.text },
                finish_reason: null,
              },
            ],
          });
        }

        if (event.content.type === 'tool_use') {
          const toolCall: Record<string, unknown> = {
            index: 0,
          };
          if (event.content.id) toolCall.id = event.content.id;
          if (event.content.name) {
            toolCall.type = 'function';
            toolCall.function = { name: event.content.name, arguments: '' };
          } else if (event.content.input_delta) {
            toolCall.function = { arguments: event.content.input_delta };
          }

          return this.sse({
            id: this.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.model,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [toolCall] },
                finish_reason: null,
              },
            ],
          });
        }

        return '';
      }

      case 'stop': {
        const finishReason = this.mapStopReason(event.stop_reason);
        const hasUsage = event.usage.input_tokens > 0 || event.usage.output_tokens > 0;
        const usageObj: Record<string, unknown> = hasUsage
          ? {
              prompt_tokens: event.usage.input_tokens,
              completion_tokens: event.usage.output_tokens,
              total_tokens: event.usage.input_tokens + event.usage.output_tokens,
            }
          : {};
        if (hasUsage && event.usage.cache_read_input_tokens) {
          usageObj.prompt_tokens_details = { cached_tokens: event.usage.cache_read_input_tokens };
        }
        let result = this.sse({
          id: this.id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.model,
          choices: [
            { index: 0, delta: {}, finish_reason: finishReason },
          ],
          ...(hasUsage ? { usage: usageObj } : {}),
        });
        result += 'data: [DONE]\n\n';
        return result;
      }

      case 'error': {
        return this.sse({
          error: {
            message: event.error.message,
            type: 'server_error',
            code: event.error.code || null,
          },
        });
      }
    }
  }

  private sse(data: unknown): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  private mapStopReason(reason: string): string {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }
}

// ═══════════════════════════════════════════════════════
// Responses SSE Serializer
// ═══════════════════════════════════════════════════════

export class ResponsesStreamSerializer {
  private id = '';
  private model = '';
  private outputIndex = 0;

  serialize(event: CanonicalStreamEvent): string {
    switch (event.type) {
      case 'start': {
        this.id = event.id || `resp_${Date.now()}`;
        this.model = event.model;
        let result = '';
        result += this.sseEvent('response.created', {
          id: this.id,
          object: 'response',
          model: this.model,
          status: 'in_progress',
          output: [],
        });
        result += this.sseEvent('response.in_progress', {
          id: this.id,
          object: 'response',
          model: this.model,
          status: 'in_progress',
        });
        // Add output item
        result += this.sseEvent('response.output_item.added', {
          output_index: this.outputIndex,
          item: {
            type: 'message',
            id: `msg_${this.id}`,
            role: 'assistant',
            content: [],
            status: 'in_progress',
          },
        });
        result += this.sseEvent('response.content_part.added', {
          output_index: this.outputIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        });
        return result;
      }

      case 'delta': {
        if (event.content.type === 'text') {
          return this.sseEvent('response.output_text.delta', {
            output_index: this.outputIndex,
            content_index: 0,
            delta: event.content.text,
          });
        }

        if (event.content.type === 'tool_use') {
          if (event.content.name) {
            // New function call
            this.outputIndex++;
            return this.sseEvent('response.output_item.added', {
              output_index: this.outputIndex,
              item: {
                type: 'function_call',
                call_id: event.content.id,
                name: event.content.name,
                arguments: '',
                status: 'in_progress',
              },
            });
          }
          if (event.content.input_delta) {
            return this.sseEvent(
              'response.function_call_arguments.delta',
              {
                output_index: this.outputIndex,
                delta: event.content.input_delta,
              },
            );
          }
        }
        return '';
      }

      case 'stop': {
        let result = '';
        result += this.sseEvent('response.output_text.done', {
          output_index: 0,
          content_index: 0,
          text: '', // Full text not available in stream
        });
        result += this.sseEvent('response.output_item.done', {
          output_index: 0,
          item: { type: 'message', status: 'completed' },
        });
        result += this.sseEvent('response.completed', {
          id: this.id,
          object: 'response',
          model: this.model,
          status: 'completed',
          usage: {
            input_tokens: event.usage.input_tokens,
            output_tokens: event.usage.output_tokens,
            total_tokens:
              event.usage.input_tokens + event.usage.output_tokens,
            ...(event.usage.cache_read_input_tokens
              ? { input_token_details: { cached_tokens: event.usage.cache_read_input_tokens } }
              : {}),
          },
        });
        return result;
      }

      case 'error': {
        return this.sseEvent('error', {
          message: event.error.message,
          code: event.error.code || null,
        });
      }
    }
  }

  private sseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

// ═══════════════════════════════════════════════════════
// Messages SSE Serializer (Anthropic format)
// ═══════════════════════════════════════════════════════

export class MessagesStreamSerializer {
  private id = '';
  private model = '';
  private blockIndex = 0;

  serialize(event: CanonicalStreamEvent): string {
    switch (event.type) {
      case 'start': {
        this.id = event.id || `msg_${Date.now()}`;
        this.model = event.model;
        let result = '';
        result += this.sseEvent('message_start', {
          type: 'message_start',
          message: {
            id: this.id,
            type: 'message',
            role: 'assistant',
            model: this.model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
        // Start first text content block
        result += this.sseEvent('content_block_start', {
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: { type: 'text', text: '' },
        });
        return result;
      }

      case 'delta': {
        if (event.content.type === 'text') {
          return this.sseEvent('content_block_delta', {
            type: 'content_block_delta',
            index: this.blockIndex,
            delta: { type: 'text_delta', text: event.content.text },
          });
        }

        if (event.content.type === 'tool_use') {
          if (event.content.name) {
            // Close previous block, start new tool_use block
            let result = this.sseEvent('content_block_stop', {
              type: 'content_block_stop',
              index: this.blockIndex,
            });
            this.blockIndex++;
            result += this.sseEvent('content_block_start', {
              type: 'content_block_start',
              index: this.blockIndex,
              content_block: {
                type: 'tool_use',
                id: event.content.id,
                name: event.content.name,
                input: {},
              },
            });
            return result;
          }
          if (event.content.input_delta) {
            return this.sseEvent('content_block_delta', {
              type: 'content_block_delta',
              index: this.blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: event.content.input_delta,
              },
            });
          }
        }
        return '';
      }

      case 'stop': {
        let result = '';
        // Close current block
        result += this.sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.blockIndex,
        });
        // Message delta with stop reason and usage (including cache tokens)
        const deltaUsage: Record<string, unknown> = { output_tokens: event.usage.output_tokens };
        if (event.usage.cache_creation_input_tokens) {
          deltaUsage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        }
        if (event.usage.cache_read_input_tokens) {
          deltaUsage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        }
        result += this.sseEvent('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: event.stop_reason || 'end_turn' },
          usage: deltaUsage,
        });
        // Message stop
        result += this.sseEvent('message_stop', {
          type: 'message_stop',
        });
        return result;
      }

      case 'error': {
        return this.sseEvent('error', {
          type: 'error',
          error: {
            type: 'api_error',
            message: event.error.message,
          },
        });
      }
    }
  }

  private sseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}
