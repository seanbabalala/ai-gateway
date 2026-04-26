import {
  RequestDenormalizer,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalContentBlock,
} from '../canonical.types';

/**
 * Denormalizes Canonical → OpenAI Responses API format.
 *
 * Used in two directions:
 *   1. RequestDenormalizer: Canonical → request body to send to a responses provider
 *   2. ResponseDenormalizer: CanonicalResponse → response body to return to a responses client
 */
export class ResponsesDenormalizer implements RequestDenormalizer {
  // ===== Request: Canonical → responses request body =====

  denormalize(
    canonical: CanonicalRequest,
    targetModel: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: targetModel,
      stream: canonical.stream,
    };

    // Extract system message as instructions
    const systemMsg = canonical.messages.find((m) => m.role === 'system');
    if (systemMsg) {
      body.instructions =
        typeof systemMsg.content === 'string'
          ? systemMsg.content
          : this.blocksToText(systemMsg.content);
    }

    // Convert non-system messages to input items
    const nonSystemMessages = canonical.messages.filter(
      (m) => m.role !== 'system',
    );
    body.input = this.denormalizeInput(nonSystemMessages);

    // Tools
    if (canonical.tools && canonical.tools.length > 0) {
      body.tools = canonical.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }

    // Tool choice
    if (canonical.tool_choice !== undefined) {
      body.tool_choice = this.denormalizeToolChoice(canonical.tool_choice);
    }

    if (canonical.max_tokens !== undefined)
      body.max_output_tokens = canonical.max_tokens;
    if (canonical.temperature !== undefined)
      body.temperature = canonical.temperature;
    if (canonical.top_p !== undefined) body.top_p = canonical.top_p;

    return body;
  }

  private denormalizeInput(
    messages: CanonicalMessage[],
  ): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [];

    for (const msg of messages) {
      // Tool results → function_call_output items
      if (msg.role === 'tool') {
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            items.push({
              type: 'function_call_output',
              call_id: block.tool_use_id,
              output:
                typeof block.content === 'string'
                  ? block.content
                  : this.blocksToText(
                      block.content as CanonicalContentBlock[],
                    ),
            });
          }
        }
        continue;
      }

      // Assistant messages with tool_use → function_call items
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const contentParts: Record<string, unknown>[] = [];
        const functionCalls: Record<string, unknown>[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            contentParts.push({ type: 'output_text', text: block.text });
          } else if (block.type === 'tool_use') {
            functionCalls.push({
              type: 'function_call',
              call_id: block.id,
              name: block.name,
              arguments: JSON.stringify(block.input),
            });
          }
        }

        // Add assistant message with text content
        if (contentParts.length > 0) {
          items.push({
            type: 'message',
            role: 'assistant',
            content: contentParts,
          });
        }

        // Add function calls as separate items
        items.push(...functionCalls);
        continue;
      }

      // User / assistant messages
      items.push({
        type: 'message',
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: this.denormalizeContent(msg.content),
      });
    }

    return items;
  }

  private denormalizeContent(
    content: string | CanonicalContentBlock[],
  ): Record<string, unknown>[] {
    if (typeof content === 'string') {
      return [{ type: 'input_text', text: content }];
    }

    return content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'input_text', text: block.text };

        case 'image':
          if (block.source.type === 'base64') {
            return {
              type: 'input_image',
              image_url: `data:${block.source.media_type};base64,${block.source.data}`,
            };
          }
          return { type: 'input_image', image_url: block.source.data };

        default:
          return { type: 'input_text', text: JSON.stringify(block) };
      }
    });
  }

  private denormalizeToolChoice(
    choice: NonNullable<CanonicalRequest['tool_choice']>,
  ): unknown {
    if (typeof choice === 'string') return choice;
    return { type: 'function', name: choice.name };
  }

  // ===== Response: CanonicalResponse → responses API response body =====

  denormalizeResponse(canonical: CanonicalResponse): Record<string, unknown> {
    const output: Record<string, unknown>[] = [];

    const textParts: string[] = [];
    const functionCalls: Record<string, unknown>[] = [];

    for (const block of canonical.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        functionCalls.push({
          type: 'function_call',
          id: `fc_${block.id}`,
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
          status: 'completed',
        });
      }
    }

    // Text output as a message item
    if (textParts.length > 0) {
      output.push({
        type: 'message',
        id: `msg_${canonical.id}`,
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: textParts.join(''),
            annotations: [],
          },
        ],
        status: 'completed',
      });
    }

    // Function calls as separate output items
    output.push(...functionCalls);

    return {
      id: `resp_${canonical.id}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: canonical.model,
      output,
      status: 'completed',
      usage: {
        input_tokens: canonical.usage.input_tokens,
        output_tokens: canonical.usage.output_tokens,
        total_tokens:
          canonical.usage.input_tokens + canonical.usage.output_tokens,
      },
    };
  }

  private blocksToText(blocks: CanonicalContentBlock[]): string {
    return blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
  }
}
