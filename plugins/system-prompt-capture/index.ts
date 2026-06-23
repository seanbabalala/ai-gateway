import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  CanonicalMessage,
  CanonicalRequest,
} from '../../src/canonical/canonical.types';
import type {
  GatewayPlugin,
  HookContext,
  HookResult,
  PreRequestData,
} from '../../src/plugins/types';

interface SystemPromptCaptureConfig {
  enabled?: boolean;
  output_file?: string;
  max_chars?: number;
  only_api_key_names?: string[];
  api_key_name_prefixes?: string[];
  only_models?: string[];
}

interface CapturedSystemPrompt {
  index: number;
  text: string;
  raw_chars: number;
  captured_chars: number;
  truncated: boolean;
  non_text_block_types?: string[];
}

const DEFAULT_OUTPUT_FILE = path.join(
  os.homedir(),
  'Library',
  'Logs',
  'siftgate-2099',
  'system-prompts.jsonl',
);

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk_machine_[A-Za-z0-9_-]+\b/g, 'sk_machine_[REDACTED]'],
  [/\bgw_sk_[A-Za-z0-9_-]+\b/g, 'gw_sk_[REDACTED]'],
  [/\bkgw_local_[A-Za-z0-9_-]+\b/g, 'kgw_local_[REDACTED]'],
  [/\bada_[A-Za-z0-9_-]+\b/g, 'ada_[REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]'],
];

export default class SystemPromptCapturePlugin implements GatewayPlugin {
  meta = {
    name: 'system-prompt-capture',
    version: '0.1.0',
    priority: 20,
  };

  private enabled = false;
  private outputFile = DEFAULT_OUTPUT_FILE;
  private maxChars = 200_000;
  private onlyApiKeyNames = new Set<string>();
  private apiKeyNamePrefixes: string[] = [];
  private onlyModels = new Set<string>();
  private warnedWriteError = false;

  onLoad(config: Readonly<Record<string, unknown>>): void {
    const cfg = config as SystemPromptCaptureConfig;
    this.enabled = cfg.enabled === true;
    this.outputFile =
      typeof cfg.output_file === 'string' && cfg.output_file.trim()
        ? path.resolve(cfg.output_file)
        : DEFAULT_OUTPUT_FILE;
    this.maxChars = positiveInteger(cfg.max_chars, this.maxChars);
    this.onlyApiKeyNames = new Set(stringList(cfg.only_api_key_names));
    this.apiKeyNamePrefixes = stringList(cfg.api_key_name_prefixes);
    this.onlyModels = new Set(stringList(cfg.only_models));

    if (this.enabled) {
      fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    }
  }

  getStatus(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      output_file: this.outputFile,
      max_chars: this.maxChars,
      only_api_key_names: Array.from(this.onlyApiKeyNames),
      api_key_name_prefixes: this.apiKeyNamePrefixes,
      only_models: Array.from(this.onlyModels),
    };
  }

  hooks = {
    preRequest: async (
      ctx: HookContext<PreRequestData>,
    ): Promise<HookResult<PreRequestData>> => {
      if (!this.enabled) return { unchanged: true };

      const request = ctx.data.request;
      if (!this.matchesFilters(request)) return { unchanged: true };

      const prompts = captureSystemPrompts(request.messages, this.maxChars);
      if (prompts.length === 0) return { unchanged: true };

      const combinedText = prompts.map((prompt) => prompt.text).join('\n');
      const record = {
        captured_at: new Date().toISOString(),
        source_format: request.metadata.source_format,
        original_model: request.metadata.original_model ?? null,
        api_key_name: request.metadata.api_key_name ?? null,
        team_name: request.metadata.team_name ?? null,
        session_id: request.metadata.session_id ?? null,
        session_key: request.metadata.session_key ?? null,
        agent_session_id: request.metadata.agent_session_id ?? null,
        agent_turn_id: request.metadata.agent_turn_id ?? null,
        agent_profile_name: request.metadata.agent_profile_name ?? null,
        agent_virtual_model: request.metadata.agent_virtual_model ?? null,
        agent_requested_model: request.metadata.agent_requested_model ?? null,
        message_count: request.messages.length,
        tool_count: request.tools?.length ?? 0,
        stream: request.stream,
        system_prompt_sha256: sha256(combinedText),
        system_prompts: prompts,
      };

      try {
        await fs.promises.appendFile(
          this.outputFile,
          `${JSON.stringify(record)}\n`,
          'utf8',
        );
      } catch (err) {
        if (!this.warnedWriteError) {
          this.warnedWriteError = true;
          ctx.log.warn(
            `failed to write system prompt capture: ${(err as Error).message}`,
          );
        }
      }

      return { unchanged: true };
    },
  };

  private matchesFilters(request: CanonicalRequest): boolean {
    if (this.onlyApiKeyNames.size > 0 || this.apiKeyNamePrefixes.length > 0) {
      const apiKeyName = request.metadata.api_key_name;
      if (!apiKeyName) return false;

      const exactMatch = this.onlyApiKeyNames.has(apiKeyName);
      const prefixMatch = this.apiKeyNamePrefixes.some((prefix) =>
        apiKeyName.startsWith(prefix),
      );
      if (!exactMatch && !prefixMatch) return false;
    }

    if (this.onlyModels.size > 0) {
      const model = request.metadata.original_model;
      if (!model || !this.onlyModels.has(model)) return false;
    }

    return true;
  }
}

function captureSystemPrompts(
  messages: readonly CanonicalMessage[],
  maxChars: number,
): CapturedSystemPrompt[] {
  let remaining = maxChars;
  const prompts: CapturedSystemPrompt[] = [];

  messages.forEach((message, index) => {
    if (message.role !== 'system' || remaining <= 0) return;

    const extracted = extractText(message);
    const redactedText = redactSecrets(extracted.text);
    const capturedText = redactedText.slice(0, remaining);
    remaining -= capturedText.length;

    prompts.push({
      index,
      text: capturedText,
      raw_chars: redactedText.length,
      captured_chars: capturedText.length,
      truncated: capturedText.length < redactedText.length,
      ...(extracted.nonTextBlockTypes.length > 0
        ? { non_text_block_types: extracted.nonTextBlockTypes }
        : {}),
    });
  });

  return prompts;
}

function extractText(message: CanonicalMessage): {
  text: string;
  nonTextBlockTypes: string[];
} {
  if (typeof message.content === 'string') {
    return { text: message.content, nonTextBlockTypes: [] };
  }

  const textParts: string[] = [];
  const nonTextBlockTypes = new Set<string>();

  for (const block of message.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else {
      nonTextBlockTypes.add(block.type);
    }
  }

  return {
    text: textParts.join('\n'),
    nonTextBlockTypes: Array.from(nonTextBlockTypes),
  };
}

function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
