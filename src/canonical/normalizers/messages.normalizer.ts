import {
  Normalizer,
  CanonicalRequest,
  CanonicalMessage,
  CanonicalContentBlock,
  CanonicalTool,
  CanonicalToolChoice,
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '../canonical.types';

/**
 * Normalizes Anthropic Messages API format → Canonical format.
 *
 * Reference: https://docs.anthropic.com/en/docs/api-reference/messages/create
 *
 * This is the closest to our Canonical format — mostly direct mapping.
 *
 * Key mappings:
 *   system (string | array)     → system message(s)
 *   messages[].role             → CanonicalRole (user | assistant only in Anthropic)
 *   messages[].content          → string | ContentBlock[]
 *   content[].type="tool_use"   → ToolUseBlock
 *   content[].type="tool_result"→ ToolResultBlock
 *   tools[]                     → CanonicalTool
 *   tool_choice                 → CanonicalToolChoice
 */
export class MessagesNormalizer implements Normalizer {
  normalize(body: unknown, headers: Record<string, string>): CanonicalRequest {
    const req = body as Record<string, unknown>;

    const messages: CanonicalMessage[] = [];

    // system → system message(s)
    if (req.system) {
      messages.push(...this.normalizeSystem(req.system));
    }

    // messages → user/assistant messages
    if (Array.isArray(req.messages)) {
      messages.push(...this.normalizeMessages(req.messages as unknown[]));
    }

    return {
      messages,
      tools: this.normalizeTools(req.tools as unknown[] | undefined),
      tool_choice: this.normalizeToolChoice(req.tool_choice),
      max_tokens: (req.max_tokens as number) || 4096,
      temperature: req.temperature as number | undefined,
      top_p: req.top_p as number | undefined,
      stop: this.normalizeStop(req.stop_sequences),
      stream: Boolean(req.stream),
      metadata: {
        source_format: 'messages',
        original_model: req.model as string | undefined,
        session_key: (headers['x-session-id'] || headers['x-session-key']) as
          | string
          | undefined,
        raw_headers: headers,
      },
    };
  }

  private normalizeSystem(system: unknown): CanonicalMessage[] {
    // String system prompt
    if (typeof system === 'string') {
      return [{ role: 'system', content: system }];
    }

    // Array of system content blocks: [{ type: "text", text: "..." }]
    if (Array.isArray(system)) {
      const text = system
        .filter(
          (s) => (s as Record<string, unknown>).type === 'text',
        )
        .map((s) => (s as Record<string, unknown>).text as string)
        .join('\n');

      if (text) {
        return [{ role: 'system', content: text }];
      }
    }

    return [];
  }

  private normalizeMessages(messages: unknown[]): CanonicalMessage[] {
    return messages.map((msg) => {
      const m = msg as Record<string, unknown>;
      const role = this.mapRole(m.role as string);

      return {
        role,
        content: this.normalizeContent(m.content),
      };
    });
  }

  private normalizeContent(
    content: unknown,
  ): string | CanonicalContentBlock[] {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return String(content || '');

    return content.map((block) => {
      const b = block as Record<string, unknown>;

      switch (b.type) {
        case 'text':
          return {
            type: 'text',
            text: (b.text as string) || '',
          } satisfies TextBlock;

        case 'image': {
          const source = b.source as Record<string, unknown>;
          return {
            type: 'image',
            source: {
              type: (source.type as 'base64' | 'url') || 'base64',
              media_type: (source.media_type as string) || 'image/unknown',
              data: (source.data as string) || '',
            },
          } satisfies ImageBlock;
        }

        case 'tool_use':
          return {
            type: 'tool_use',
            id: (b.id as string) || '',
            name: (b.name as string) || '',
            input: (b.input as Record<string, unknown>) || {},
          } satisfies ToolUseBlock;

        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: (b.tool_use_id as string) || '',
            content: this.normalizeToolResultContent(b.content),
          } satisfies ToolResultBlock;

        default:
          return {
            type: 'text',
            text: JSON.stringify(b),
          } satisfies TextBlock;
      }
    });
  }

  private normalizeToolResultContent(
    content: unknown,
  ): string | CanonicalContentBlock[] {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return String(content || '');

    return content.map((block) => {
      const b = block as Record<string, unknown>;
      if (b.type === 'text') {
        return { type: 'text', text: (b.text as string) || '' } satisfies TextBlock;
      }
      if (b.type === 'image') {
        const source = b.source as Record<string, unknown>;
        return {
          type: 'image',
          source: {
            type: (source.type as 'base64' | 'url') || 'base64',
            media_type: (source.media_type as string) || 'image/unknown',
            data: (source.data as string) || '',
          },
        } satisfies ImageBlock;
      }
      return { type: 'text', text: JSON.stringify(b) } satisfies TextBlock;
    });
  }

  private normalizeTools(
    tools: unknown[] | undefined,
  ): CanonicalTool[] | undefined {
    if (!tools || !Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((tool) => {
      const t = tool as Record<string, unknown>;
      // Anthropic format: { name, description, input_schema }
      return {
        name: (t.name as string) || '',
        description: (t.description as string) || '',
        parameters: (t.input_schema as Record<string, unknown>) || {},
      };
    });
  }

  private normalizeToolChoice(
    toolChoice: unknown,
  ): CanonicalToolChoice | undefined {
    if (toolChoice === undefined || toolChoice === null) return undefined;

    // Anthropic: { type: "auto" | "any" | "tool", name?: string }
    const tc = toolChoice as Record<string, unknown>;

    switch (tc.type) {
      case 'auto':
        return 'auto';
      case 'any':
        return 'required';
      case 'tool':
        return { name: (tc.name as string) || '' };
      case 'none':
        return 'none';
      default:
        return undefined;
    }
  }

  private normalizeStop(stop: unknown): string[] | undefined {
    if (!stop || !Array.isArray(stop)) return undefined;
    return stop as string[];
  }

  private mapRole(role: string): 'user' | 'assistant' {
    // Anthropic only supports user and assistant in messages array
    return role === 'assistant' ? 'assistant' : 'user';
  }
}
