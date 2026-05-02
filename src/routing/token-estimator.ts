import {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalTool,
} from '../canonical/canonical.types';

export interface TokenEstimate {
  input_tokens: number;
  output_tokens: number;
  context_tokens: number;
}

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_OVERHEAD_TOKENS = 16;
const DEFAULT_OUTPUT_RESERVE_TOKENS = 1024;
const IMAGE_REFERENCE_TOKENS = 512;

export function estimateCanonicalRequestTokens(
  canonical: CanonicalRequest,
): TokenEstimate {
  const inputTokens =
    canonical.messages.reduce(
      (sum, message) => sum + estimateMessageTokens(message),
      0,
    ) + estimateToolsTokens(canonical.tools);
  const outputTokens = Math.max(
    0,
    canonical.max_tokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS,
  );

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    context_tokens: inputTokens + outputTokens,
  };
}

function estimateMessageTokens(message: CanonicalMessage): number {
  const roleTokens = estimateTextTokens(message.role);
  const contentTokens =
    typeof message.content === 'string'
      ? estimateTextTokens(message.content)
      : message.content.reduce(
          (sum, block) => sum + estimateBlockTokens(block),
          0,
        );
  return MESSAGE_OVERHEAD_TOKENS + roleTokens + contentTokens;
}

function estimateBlockTokens(block: CanonicalContentBlock): number {
  switch (block.type) {
    case 'text':
      return estimateTextTokens(block.text);
    case 'image':
      if (block.source.type === 'base64') {
        return Math.max(
          IMAGE_REFERENCE_TOKENS,
          Math.ceil(block.source.data.length / CHARS_PER_TOKEN),
        );
      }
      return IMAGE_REFERENCE_TOKENS + estimateTextTokens(block.source.data);
    case 'tool_use':
      return (
        TOOL_OVERHEAD_TOKENS +
        estimateTextTokens(block.name) +
        estimateTextTokens(JSON.stringify(block.input || {}))
      );
    case 'tool_result':
      return (
        TOOL_OVERHEAD_TOKENS +
        estimateTextTokens(block.tool_use_id) +
        (typeof block.content === 'string'
          ? estimateTextTokens(block.content)
          : block.content.reduce(
              (sum, nestedBlock) => sum + estimateBlockTokens(nestedBlock),
              0,
            ))
      );
    default:
      return 0;
  }
}

function estimateToolsTokens(tools: CanonicalTool[] | undefined): number {
  if (!tools || tools.length === 0) return 0;
  return tools.reduce(
    (sum, tool) =>
      sum +
      TOOL_OVERHEAD_TOKENS +
      estimateTextTokens(tool.name) +
      estimateTextTokens(tool.description) +
      estimateTextTokens(JSON.stringify(tool.parameters || {})),
    0,
  );
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
