import {
  RequestDenormalizer,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentBlock,
} from '../canonical.types';
import { toAnthropicMessagesOutputFormat } from '../structured-output';
import { toAnthropicThinking } from '../reasoning-effort';

/**
 * Denormalizes Canonical → Anthropic Messages API format.
 *
 * Used in two directions:
 *   1. RequestDenormalizer: Canonical → request body to send to a messages provider
 *   2. ResponseDenormalizer: CanonicalResponse → response body to return to a messages client
 */
export class MessagesDenormalizer implements RequestDenormalizer {
  // ===== Request: Canonical → messages request body =====

  denormalize(
    canonical: CanonicalRequest,
    targetModel: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: targetModel,
      stream: canonical.stream,
      max_tokens: canonical.max_tokens || 4096,
    };

    // Extract system messages → top-level system field
    const systemMessages = canonical.messages.filter(
      (m) => m.role === 'system',
    );
    if (systemMessages.length > 0) {
      body.system = this.denormalizeSystem(systemMessages);
    }

    // Non-system messages → messages array
    // Anthropic only allows alternating user/assistant roles
    const nonSystemMessages = canonical.messages.filter(
      (m) => m.role !== 'system',
    );
    body.messages = this.denormalizeMessages(nonSystemMessages);

    // Tools
    if (canonical.tools && canonical.tools.length > 0) {
      body.tools = canonical.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        ...(tool.cache_control ? { cache_control: tool.cache_control } : {}),
      }));
    }

    // Tool choice
    if (canonical.tool_choice !== undefined) {
      body.tool_choice = this.denormalizeToolChoice(canonical.tool_choice);
    }

    if (canonical.temperature !== undefined)
      body.temperature = canonical.temperature;
    if (canonical.top_p !== undefined) body.top_p = canonical.top_p;
    if (canonical.stop && canonical.stop.length > 0)
      body.stop_sequences = canonical.stop;

    const thinking = toAnthropicThinking(
      canonical.reasoning,
      canonical.max_tokens || 4096,
    );
    if (thinking) body.thinking = thinking;

    const outputFormat = toAnthropicMessagesOutputFormat(
      canonical.response_format,
    );
    if (outputFormat) {
      body.output_config = {
        format: outputFormat,
      };
    }

    return body;
  }

  private denormalizeMessages(
    messages: CanonicalMessage[],
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (const msg of messages) {
      // Tool results → user message with tool_result blocks
      // In Anthropic, tool_result is sent as part of a user message
      if (msg.role === 'tool') {
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const toolBlocks = blocks
          .filter((b) => b.type === 'tool_result')
          .map((b) => {
            if (b.type !== 'tool_result') return b;
            return {
              type: 'tool_result',
              tool_use_id: b.tool_use_id,
              content:
                typeof b.content === 'string'
                  ? b.content
                  : this.denormalizeContentBlocks(
                      b.content as CanonicalContentBlock[],
                    ),
            };
          });

        // If previous message is also user, merge tool_result into it
        const prev = result[result.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
          (prev.content as unknown[]).push(...toolBlocks);
        } else {
          result.push({
            role: 'user',
            content: toolBlocks,
          });
        }
        continue;
      }

      // Assistant messages
      if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          result.push({
            role: 'assistant',
            content: [{ type: 'text', text: msg.content }],
          });
        } else {
          result.push({
            role: 'assistant',
            content: this.denormalizeContentBlocks(msg.content),
          });
        }
        continue;
      }

      // User messages
      if (typeof msg.content === 'string') {
        // Check if previous message is also user — merge
        const prev = result[result.length - 1];
        if (prev && prev.role === 'user') {
          if (typeof prev.content === 'string') {
            prev.content = [
              { type: 'text', text: prev.content },
              { type: 'text', text: msg.content },
            ];
          } else if (Array.isArray(prev.content)) {
            (prev.content as unknown[]).push({
              type: 'text',
              text: msg.content,
            });
          }
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      } else {
        const prev = result[result.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
          (prev.content as unknown[]).push(
            ...this.denormalizeContentBlocks(msg.content),
          );
        } else {
          result.push({
            role: 'user',
            content: this.denormalizeContentBlocks(msg.content),
          });
        }
      }
    }

    return result;
  }

  private denormalizeSystem(messages: CanonicalMessage[]): string | Record<string, unknown>[] {
    const hasBlockSystem = messages.some((message) => Array.isArray(message.content));
    if (!hasBlockSystem) {
      return messages
        .map((message) => String(message.content || ''))
        .filter(Boolean)
        .join('\n');
    }

    const blocks: Record<string, unknown>[] = [];
    for (const message of messages) {
      if (typeof message.content === 'string') {
        if (message.content) {
          blocks.push({ type: 'text', text: message.content });
        }
        continue;
      }
      blocks.push(...this.denormalizeContentBlocks(message.content));
    }
    return blocks;
  }

  private denormalizeContentBlocks(
    blocks: CanonicalContentBlock[],
  ): Record<string, unknown>[] {
    return blocks.map((block) => {
      switch (block.type) {
        case 'text':
          return {
            type: 'text',
            text: block.text,
            ...(block.cache_control ? { cache_control: block.cache_control } : {}),
          };

        case 'image':
          return {
            type: 'image',
            source: {
              type: block.source.type,
              media_type: block.source.media_type,
              data: block.source.data,
            },
            ...(block.cache_control ? { cache_control: block.cache_control } : {}),
          };

        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
            ...(block.cache_control ? { cache_control: block.cache_control } : {}),
          };

        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content:
              typeof block.content === 'string'
                ? block.content
                : this.denormalizeContentBlocks(
                    block.content as CanonicalContentBlock[],
                  ),
            ...(block.cache_control ? { cache_control: block.cache_control } : {}),
          };

        default:
          return { type: 'text', text: JSON.stringify(block) };
      }
    });
  }

  private denormalizeToolChoice(
    choice: NonNullable<CanonicalRequest['tool_choice']>,
  ): unknown {
    if (typeof choice === 'string') {
      switch (choice) {
        case 'auto':
          return { type: 'auto' };
        case 'none':
          return { type: 'auto' }; // Anthropic doesn't have 'none', use auto
        case 'required':
          return { type: 'any' };
        default:
          return { type: 'auto' };
      }
    }
    return { type: 'tool', name: choice.name };
  }

  // ===== Response: CanonicalResponse → messages API response body =====

  denormalizeResponse(canonical: CanonicalResponse): Record<string, unknown> {
    const content: Record<string, unknown>[] = [];

    for (const block of canonical.content) {
      switch (block.type) {
        case 'text':
          content.push({ type: 'text', text: block.text });
          break;
        case 'tool_use':
          content.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
          break;
      }
    }

    return {
      id: `msg_${canonical.id}`,
      type: 'message',
      role: 'assistant',
      model: canonical.model,
      content,
      stop_reason: this.mapStopReason(canonical.stop_reason),
      usage: {
        input_tokens: canonical.usage.input_tokens,
        output_tokens: canonical.usage.output_tokens,
        ...(canonical.usage.cache_creation_input_tokens
          ? { cache_creation_input_tokens: canonical.usage.cache_creation_input_tokens }
          : {}),
        ...(canonical.usage.cache_read_input_tokens
          ? { cache_read_input_tokens: canonical.usage.cache_read_input_tokens }
          : {}),
      },
    };
  }

  private mapStopReason(reason: string): string {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      default:
        return 'end_turn';
    }
  }

  private blocksToText(blocks: CanonicalContentBlock[]): string {
    return blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
  }
}
