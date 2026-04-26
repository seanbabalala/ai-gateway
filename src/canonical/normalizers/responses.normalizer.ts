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
 * Normalizes OpenAI Responses API format → Canonical format.
 *
 * Reference: https://platform.openai.com/docs/api-reference/responses/create
 *
 * Key mappings:
 *   input (string)                    → single user message
 *   input (array of items)            → CanonicalMessage[]
 *   instructions                      → system message
 *   tools[].type === "function"       → CanonicalTool
 *   tool_choice                       → CanonicalToolChoice
 *   previous_response_id              → out of scope (MVP)
 */
export class ResponsesNormalizer implements Normalizer {
  normalize(body: unknown, headers: Record<string, string>): CanonicalRequest {
    const req = body as Record<string, unknown>;

    const messages: CanonicalMessage[] = [];

    // instructions → system message
    if (req.instructions && typeof req.instructions === 'string') {
      messages.push({ role: 'system', content: req.instructions });
    }

    // input → user/assistant/tool messages
    messages.push(...this.normalizeInput(req.input));

    return {
      messages,
      tools: this.normalizeTools(req.tools as unknown[] | undefined),
      tool_choice: this.normalizeToolChoice(req.tool_choice),
      max_tokens:
        (req.max_output_tokens as number) ??
        (req.max_tokens as number) ??
        undefined,
      temperature: req.temperature as number | undefined,
      top_p: req.top_p as number | undefined,
      stop: undefined, // Responses API doesn't have stop sequences
      stream: Boolean(req.stream),
      metadata: {
        source_format: 'responses',
        original_model: req.model as string | undefined,
        session_key: (headers['x-session-id'] || headers['x-session-key']) as
          | string
          | undefined,
        raw_headers: headers,
      },
    };
  }

  private normalizeInput(input: unknown): CanonicalMessage[] {
    if (!input) return [];

    // Simple string input → single user message
    if (typeof input === 'string') {
      return [{ role: 'user', content: input }];
    }

    if (!Array.isArray(input)) return [];

    const messages: CanonicalMessage[] = [];

    for (const item of input) {
      const it = item as Record<string, unknown>;

      // Easy message: { role: "user", content: "..." }
      if (it.role && it.content !== undefined) {
        const role = this.mapRole(it.role as string);
        messages.push({
          role,
          content: this.normalizeItemContent(it.content),
        });
        continue;
      }

      // Input item types from Responses API
      switch (it.type) {
        case 'message': {
          const role = this.mapRole(it.role as string);
          const contentItems = it.content as unknown[];
          if (Array.isArray(contentItems)) {
            messages.push({
              role,
              content: this.normalizeContentArray(contentItems),
            });
          } else {
            messages.push({
              role,
              content: String(it.content || ''),
            });
          }
          break;
        }

        case 'item_reference': {
          // previous_response_id related — out of scope
          // Skip silently
          break;
        }

        // function_call_output — tool result
        case 'function_call_output': {
          messages.push({
            role: 'tool',
            content: [
              {
                type: 'tool_result',
                tool_use_id: (it.call_id as string) || '',
                content: (it.output as string) || '',
              } satisfies ToolResultBlock,
            ],
          });
          break;
        }

        default: {
          // Content part objects directly in input array
          // e.g., { type: "input_text", text: "..." }
          if (it.type === 'input_text' || it.type === 'text') {
            messages.push({
              role: 'user',
              content: (it.text as string) || '',
            });
          } else if (it.type === 'input_image') {
            const block = this.normalizeImage(it);
            if (block) {
              messages.push({ role: 'user', content: [block] });
            }
          }
          break;
        }
      }
    }

    return messages;
  }

  private normalizeItemContent(
    content: unknown,
  ): string | CanonicalContentBlock[] {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return this.normalizeContentArray(content);
    }
    return String(content || '');
  }

  private normalizeContentArray(parts: unknown[]): CanonicalContentBlock[] {
    const blocks: CanonicalContentBlock[] = [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;

      switch (p.type) {
        case 'input_text':
        case 'text':
        case 'output_text':
          blocks.push({
            type: 'text',
            text: (p.text as string) || '',
          } satisfies TextBlock);
          break;

        case 'input_image': {
          const img = this.normalizeImage(p);
          if (img) blocks.push(img);
          break;
        }

        case 'function_call':
          blocks.push({
            type: 'tool_use',
            id: (p.call_id as string) || (p.id as string) || '',
            name: (p.name as string) || '',
            input: this.safeParseJson(p.arguments as string),
          } satisfies ToolUseBlock);
          break;

        case 'function_call_output':
          blocks.push({
            type: 'tool_result',
            tool_use_id: (p.call_id as string) || '',
            content: (p.output as string) || '',
          } satisfies ToolResultBlock);
          break;

        default:
          if (p.text) {
            blocks.push({
              type: 'text',
              text: p.text as string,
            } satisfies TextBlock);
          }
          break;
      }
    }

    return blocks;
  }

  private normalizeImage(item: Record<string, unknown>): ImageBlock | null {
    // { type: "input_image", image_url: "data:..." } or { detail, image_url }
    const url =
      (item.image_url as string) ||
      ((item.image_url as Record<string, unknown>)?.url as string);

    if (!url) return null;

    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: match[1], data: match[2] },
        };
      }
    }

    return {
      type: 'image',
      source: { type: 'url', media_type: 'image/unknown', data: url },
    };
  }

  private normalizeTools(
    tools: unknown[] | undefined,
  ): CanonicalTool[] | undefined {
    if (!tools || !Array.isArray(tools) || tools.length === 0) return undefined;

    const canonical: CanonicalTool[] = [];

    for (const tool of tools) {
      const t = tool as Record<string, unknown>;

      // Responses API: { type: "function", name, description, parameters }
      if (t.type === 'function') {
        canonical.push({
          name: (t.name as string) || '',
          description: (t.description as string) || '',
          parameters: (t.parameters as Record<string, unknown>) || {},
        });
      }
      // Skip non-function tools (web_search, file_search, etc. — not supported)
    }

    return canonical.length > 0 ? canonical : undefined;
  }

  private normalizeToolChoice(
    toolChoice: unknown,
  ): CanonicalToolChoice | undefined {
    if (toolChoice === undefined || toolChoice === null) return undefined;

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

    // { type: "function", name: "..." }
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === 'function' && tc.name) {
      return { name: tc.name as string };
    }

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
