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
import { normalizeStructuredOutputFromBody } from '../structured-output';
import { normalizeReasoningFromBody } from '../reasoning-effort';
import { normalizeRequestIdentityHeaders } from './request-metadata';

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
    const structured = normalizeStructuredOutputFromBody('messages', req);
    const reasoning = normalizeReasoningFromBody('messages', req);

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
      ...structured,
      ...reasoning,
      stream: Boolean(req.stream),
      metadata: {
        source_format: 'messages',
        original_model: req.model as string | undefined,
        ...normalizeRequestIdentityHeaders(headers),
        raw_headers: headers,
        raw_body: req,
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
      const hasCacheControl = system.some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          Boolean((entry as Record<string, unknown>).cache_control),
      );
      if (!hasCacheControl) {
        const text = system
          .filter(
            (s) =>
              s &&
              typeof s === 'object' &&
              (s as Record<string, unknown>).type === 'text',
          )
          .map((s) => String((s as Record<string, unknown>).text || ''))
          .filter(Boolean)
          .join('\n');

        if (text) {
          return [{ role: 'system', content: text }];
        }
      }

      const content = this.normalizeContent(system);
      if (Array.isArray(content) && content.length > 0) {
        return [{ role: 'system', content }];
      }
    }

    return [];
  }

  private normalizeMessages(messages: unknown[]): CanonicalMessage[] {
    return messages.map((msg) => {
      if (!msg || typeof msg !== 'object') {
        return {
          role: 'user',
          content: String(msg || ''),
        };
      }
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

    return content.flatMap<CanonicalContentBlock>((block) => {
      if (block === null || block === undefined) return [];
      if (typeof block === 'string') {
        return block ? [{ type: 'text', text: block } satisfies TextBlock] : [];
      }
      if (typeof block !== 'object') {
        return [{ type: 'text', text: String(block) } satisfies TextBlock];
      }
      const b = block as Record<string, unknown>;
      if (typeof b.type !== 'string' || b.type.length === 0) {
        return { type: 'text', text: JSON.stringify(b) } satisfies TextBlock;
      }

      switch (b.type) {
        case 'text':
          return this.withCacheControl({
            type: 'text',
            text: typeof b.text === 'string' ? b.text : String(b.text || ''),
          } satisfies TextBlock, b);

        case 'image': {
          const source = b.source as Record<string, unknown>;
          return this.withCacheControl({
            type: 'image',
            source: {
              type: (source.type as 'base64' | 'url') || 'base64',
              media_type: (source.media_type as string) || 'image/unknown',
              data: (source.data as string) || '',
            },
          } satisfies ImageBlock, b);
        }

        case 'tool_use':
          return this.withCacheControl({
            type: 'tool_use',
            id: (b.id as string) || '',
            name: (b.name as string) || '',
            input: (b.input as Record<string, unknown>) || {},
          } satisfies ToolUseBlock, b);

        case 'tool_result':
          return this.withCacheControl({
            type: 'tool_result',
            tool_use_id: (b.tool_use_id as string) || '',
            content: this.normalizeToolResultContent(b.content),
          } satisfies ToolResultBlock, b);

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

    return content.flatMap<CanonicalContentBlock>((block) => {
      if (block === null || block === undefined) return [];
      if (typeof block === 'string') {
        return block ? [{ type: 'text', text: block } satisfies TextBlock] : [];
      }
      if (typeof block !== 'object') {
        return [{ type: 'text', text: String(block) } satisfies TextBlock];
      }
      const b = block as Record<string, unknown>;
      if (typeof b.type !== 'string' || b.type.length === 0) {
        return { type: 'text', text: JSON.stringify(b) } satisfies TextBlock;
      }
      if (b.type === 'text') {
        return this.withCacheControl({
          type: 'text',
          text: typeof b.text === 'string' ? b.text : String(b.text || ''),
        } satisfies TextBlock, b);
      }
      if (b.type === 'image') {
        const source = b.source as Record<string, unknown>;
        return this.withCacheControl({
          type: 'image',
          source: {
            type: (source.type as 'base64' | 'url') || 'base64',
            media_type: (source.media_type as string) || 'image/unknown',
            data: (source.data as string) || '',
          },
        } satisfies ImageBlock, b);
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
        ...this.cacheControlFragment(t),
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

  private withCacheControl<T extends Record<string, unknown>>(
    block: T,
    source: Record<string, unknown>,
  ): T {
    return Object.assign(block, this.cacheControlFragment(source));
  }

  private cacheControlFragment(
    source: Record<string, unknown>,
  ): { cache_control?: Record<string, unknown> } {
    const cacheControl = source.cache_control;
    if (!cacheControl || typeof cacheControl !== 'object' || Array.isArray(cacheControl)) {
      return {};
    }
    return { cache_control: { ...(cacheControl as Record<string, unknown>) } };
  }
}
