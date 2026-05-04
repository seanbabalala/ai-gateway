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

/**
 * Normalizes OpenAI Chat Completions format → Canonical format.
 *
 * Reference: https://platform.openai.com/docs/api-reference/chat/create
 *
 * Key mappings:
 *   messages[].role           → CanonicalRole
 *   messages[].content        → string | CanonicalContentBlock[]
 *   messages[].tool_calls     → ToolUseBlock (assistant messages)
 *   tools[].function          → CanonicalTool
 *   tool_choice               → CanonicalToolChoice
 *   function_call (legacy)    → CanonicalToolChoice
 */
export class ChatCompletionsNormalizer implements Normalizer {
  normalize(body: unknown, headers: Record<string, string>): CanonicalRequest {
    const req = body as Record<string, unknown>;
    const structured = normalizeStructuredOutputFromBody(
      'chat_completions',
      req,
    );
    const reasoning = normalizeReasoningFromBody('chat_completions', req);

    return {
      messages: this.normalizeMessages(req.messages as unknown[]),
      tools: this.normalizeTools(req.tools as unknown[] | undefined),
      tool_choice: this.normalizeToolChoice(
        req.tool_choice,
        req.function_call,
      ),
      max_tokens:
        (req.max_tokens as number) ??
        (req.max_completion_tokens as number) ??
        undefined,
      temperature: req.temperature as number | undefined,
      top_p: req.top_p as number | undefined,
      stop: this.normalizeStop(req.stop),
      ...structured,
      ...reasoning,
      stream: Boolean(req.stream),
      metadata: {
        source_format: 'chat_completions',
        original_model: req.model as string | undefined,
        session_key: (headers['x-session-id'] || headers['x-session-key']) as
          | string
          | undefined,
        raw_headers: headers,
        raw_body: req,
      },
    };
  }

  private normalizeMessages(messages: unknown[]): CanonicalMessage[] {
    if (!Array.isArray(messages)) return [];

    return messages.map((msg) => {
      const m = msg as Record<string, unknown>;
      const role = this.mapRole(m.role as string);

      // Tool message (function result)
      if (role === 'tool') {
        return {
          role: 'tool' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: (m.tool_call_id as string) || '',
              content: (m.content as string) || '',
            } satisfies ToolResultBlock,
          ],
        };
      }

      // Assistant message with tool_calls
      if (role === 'assistant' && m.tool_calls) {
        const blocks: CanonicalContentBlock[] = [];

        // Text content first
        if (m.content && typeof m.content === 'string') {
          blocks.push({ type: 'text', text: m.content } satisfies TextBlock);
        }

        // Then tool calls
        const toolCalls = m.tool_calls as Record<string, unknown>[];
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown>;
          blocks.push({
            type: 'tool_use',
            id: (tc.id as string) || '',
            name: (fn.name as string) || '',
            input: this.safeParseJson(fn.arguments as string),
          } satisfies ToolUseBlock);
        }

        return { role, content: blocks };
      }

      // Legacy: assistant message with function_call
      if (role === 'assistant' && m.function_call) {
        const fn = m.function_call as Record<string, unknown>;
        const blocks: CanonicalContentBlock[] = [];

        if (m.content && typeof m.content === 'string') {
          blocks.push({ type: 'text', text: m.content });
        }

        blocks.push({
          type: 'tool_use',
          id: `legacy_fc_${Date.now()}`,
          name: (fn.name as string) || '',
          input: this.safeParseJson(fn.arguments as string),
        });

        return { role, content: blocks };
      }

      // Legacy: function role (old function result)
      if ((m.role as string) === 'function') {
        return {
          role: 'tool' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: (m.name as string) || '',
              content: (m.content as string) || '',
            } satisfies ToolResultBlock,
          ],
        };
      }

      // Regular message — may have array content (multimodal)
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
    if (content === null || content === undefined) return '';

    if (Array.isArray(content)) {
      return content.map((part) => {
        const p = part as Record<string, unknown>;

        if (p.type === 'text') {
          return { type: 'text', text: p.text as string } satisfies TextBlock;
        }

        if (p.type === 'image_url') {
          const imgUrl = p.image_url as Record<string, unknown>;
          const url = imgUrl.url as string;

          // Check if it's a base64 data URI
          if (url.startsWith('data:')) {
            const match = url.match(
              /^data:([^;]+);base64,(.+)$/,
            );
            if (match) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2],
                },
              } satisfies ImageBlock;
            }
          }

          return {
            type: 'image',
            source: { type: 'url', media_type: 'image/unknown', data: url },
          } satisfies ImageBlock;
        }

        // Fallback: treat unknown as text
        return {
          type: 'text',
          text: JSON.stringify(p),
        } satisfies TextBlock;
      });
    }

    return String(content);
  }

  private normalizeTools(
    tools: unknown[] | undefined,
  ): CanonicalTool[] | undefined {
    if (!tools || !Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((tool) => {
      const t = tool as Record<string, unknown>;

      // OpenAI format: { type: "function", function: { name, description, parameters } }
      if (t.type === 'function' && t.function) {
        const fn = t.function as Record<string, unknown>;
        return {
          name: (fn.name as string) || '',
          description: (fn.description as string) || '',
          parameters: (fn.parameters as Record<string, unknown>) || {},
        };
      }

      // Legacy / direct format: { name, description, parameters }
      return {
        name: (t.name as string) || '',
        description: (t.description as string) || '',
        parameters: (t.parameters as Record<string, unknown>) || {},
      };
    });
  }

  private normalizeToolChoice(
    toolChoice: unknown,
    functionCall: unknown,
  ): CanonicalToolChoice | undefined {
    // New format: tool_choice
    if (toolChoice !== undefined) {
      if (typeof toolChoice === 'string') {
        if (
          toolChoice === 'auto' ||
          toolChoice === 'none' ||
          toolChoice === 'required'
        ) {
          return toolChoice;
        }
        return undefined;
      }

      const tc = toolChoice as Record<string, unknown>;
      if (tc.type === 'function' && tc.function) {
        const fn = tc.function as Record<string, unknown>;
        return { name: fn.name as string };
      }
    }

    // Legacy: function_call
    if (functionCall !== undefined) {
      if (functionCall === 'auto') return 'auto';
      if (functionCall === 'none') return 'none';
      if (typeof functionCall === 'object' && functionCall !== null) {
        const fc = functionCall as Record<string, unknown>;
        return { name: fc.name as string };
      }
    }

    return undefined;
  }

  private normalizeStop(stop: unknown): string[] | undefined {
    if (stop === undefined || stop === null) return undefined;
    if (typeof stop === 'string') return [stop];
    if (Array.isArray(stop)) return stop as string[];
    return undefined;
  }

  private mapRole(
    role: string,
  ): 'system' | 'user' | 'assistant' | 'tool' {
    switch (role) {
      case 'system':
      case 'developer':
        return 'system';
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'tool':
      case 'function':
        return 'tool';
      default:
        return 'user';
    }
  }

  private safeParseJson(str: string): Record<string, unknown> {
    if (!str) return {};
    try {
      return JSON.parse(str);
    } catch {
      return { _raw: str };
    }
  }
}
