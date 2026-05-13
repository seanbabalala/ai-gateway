import { CanonicalStreamEvent, TokenUsage } from '../../canonical/canonical.types';
import {
  extractUsageBySchema,
  extractUsageByKnownFields,
  UsageSchema,
} from '../usage-schema-resolver';

/**
 * Parses SSE stream from an OpenAI Responses API provider → CanonicalStreamEvent.
 *
 * SSE format (multiple event types):
 *   event: response.created
 *   data: {"id":"resp_...","model":"gpt-5.4",...}
 *
 *   event: response.output_item.added
 *   data: {...}
 *
 *   event: response.output_text.delta
 *   data: {"delta":"Hello"}
 *
 *   event: response.function_call_arguments.delta
 *   data: {"delta":"...","call_id":"...","name":"..."}
 *
 *   event: response.completed
 *   data: {"id":"resp_...","usage":{...},...}
 */
export class ResponsesStreamParser {
  private buffer = '';
  private currentEvent = '';

  constructor(private readonly usageSchema?: UsageSchema) {}

  *parse(chunk: string): Generator<CanonicalStreamEvent> {
    this.buffer += chunk;

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith(':')) continue;

      // Event type line
      if (trimmed.startsWith('event: ')) {
        this.currentEvent = trimmed.slice(7).trim();
        continue;
      }

      // Data line
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6).trim();

        try {
          const parsed = JSON.parse(data);
          yield* this.processEvent(this.currentEvent, parsed);
        } catch {
          // Skip unparseable
        }

        this.currentEvent = '';
      }
    }
  }

  private *processEvent(
    eventType: string,
    data: Record<string, unknown>,
  ): Generator<CanonicalStreamEvent> {
    switch (eventType) {
      case 'response.created': {
        yield {
          type: 'start',
          id: (data.id as string) || '',
          model: (data.model as string) || '',
        };
        break;
      }

      case 'response.output_text.delta': {
        const delta = (data.delta as string) || '';
        if (delta) {
          yield {
            type: 'delta',
            content: { type: 'text', text: delta },
          };
        }
        break;
      }

      case 'response.function_call_arguments.delta': {
        yield {
          type: 'delta',
          content: {
            type: 'tool_use',
            id: (data.call_id as string) || (data.item_id as string) || '',
            name: data.name as string | undefined,
            input_delta: (data.delta as string) || undefined,
          },
        };
        break;
      }

      case 'response.function_call_arguments.done': {
        // Final function call arguments — we've already streamed the deltas
        break;
      }

      case 'response.completed': {
        yield {
          type: 'stop',
          stop_reason: this.mapStatus(data.status as string),
          usage: this.resolveUsage(data),
        };
        break;
      }

      case 'response.output_item.added':
      case 'response.output_item.done':
      case 'response.output_text.done':
      case 'response.content_part.added':
      case 'response.content_part.done':
      case 'response.in_progress':
        // Informational events — skip
        break;

      case 'error': {
        yield {
          type: 'error',
          error: {
            message: (data.message as string) || 'Unknown stream error',
            code: (data.code as string) || undefined,
          },
        };
        break;
      }

      default:
        // Unknown event types — skip silently
        break;
    }
  }

  private mapStatus(status: string): string {
    if (status === 'completed') return 'end_turn';
    if (status === 'incomplete') return 'max_tokens';
    return 'end_turn';
  }

  private resolveUsage(data: Record<string, unknown>) {
    const usage = (data.usage || {}) as Record<string, unknown>;
    const inputTokensDetails = (usage.input_tokens_details || {}) as Record<
      string,
      unknown
    >;
    const inputDetails = (usage.input_token_details || {}) as Record<
      string,
      unknown
    >;
    const promptDetails = (usage.prompt_tokens_details || {}) as Record<
      string,
      unknown
    >;
    const fallbackUsage: TokenUsage = {
      input_tokens: (usage.input_tokens as number) || 0,
      output_tokens: (usage.output_tokens as number) || 0,
      cache_read_input_tokens:
        ((inputTokensDetails.cached_tokens as number) ||
          (promptDetails.cached_tokens as number) ||
          (inputDetails.cached_tokens as number) ||
          0),
    };

    const schemaUsage = this.usageSchema
      ? extractUsageBySchema(data, this.usageSchema)
      : { input_tokens: 0, output_tokens: 0 };
    const knownUsage = extractUsageByKnownFields(data);
    return {
      input_tokens:
        schemaUsage.input_tokens ||
        knownUsage.input_tokens ||
        fallbackUsage.input_tokens ||
        0,
      output_tokens:
        schemaUsage.output_tokens ||
        knownUsage.output_tokens ||
        fallbackUsage.output_tokens ||
        0,
      cache_creation_input_tokens:
        schemaUsage.cache_creation_input_tokens ||
        knownUsage.cache_creation_input_tokens ||
        fallbackUsage.cache_creation_input_tokens ||
        0,
      cache_read_input_tokens:
        schemaUsage.cache_read_input_tokens ||
        knownUsage.cache_read_input_tokens ||
        fallbackUsage.cache_read_input_tokens ||
        0,
    };
  }
}
