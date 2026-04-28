// ===================================================================
// PII Filter Plugin — Example plugin for redacting sensitive data
// ===================================================================
// Intercepts requests via the preUpstream hook and replaces patterns
// matching configured regexes with [REDACTED] before sending to the
// upstream AI provider.
//
// Config:
//   patterns: string[] — Array of regex patterns to match
//
// Usage in gateway.config.yaml:
//   plugins:
//     - path: plugins/pii-filter
//       config:
//         patterns:
//           - '\b\d{3}-\d{2}-\d{4}\b'     # SSN
//           - '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'  # Email
//           - '\b\d{16}\b'                  # Credit card (simple)
// ===================================================================

import type {
  GatewayPlugin,
  HookContext,
  PreUpstreamData,
  HookResult,
} from '../../src/plugins/types';
import type { CanonicalMessage } from '../../src/canonical/canonical.types';

export default class PiiFilterPlugin implements GatewayPlugin {
  meta = {
    name: 'pii-filter',
    version: '1.0.0',
    priority: 50, // Run early — before other plugins see the data
  };

  private patterns: RegExp[] = [];

  async onLoad(config: Readonly<Record<string, unknown>>): Promise<void> {
    const rawPatterns = (config.patterns as string[]) || [];
    this.patterns = rawPatterns.map((p) => new RegExp(p, 'g'));
  }

  hooks = {
    preUpstream: async (
      ctx: HookContext<PreUpstreamData>,
    ): Promise<HookResult<PreUpstreamData>> => {
      if (this.patterns.length === 0) return { unchanged: true };

      const request = { ...ctx.data.request };
      request.messages = request.messages.map(
        (msg: CanonicalMessage): CanonicalMessage => ({
          ...msg,
          content:
            typeof msg.content === 'string'
              ? this.redact(msg.content)
              : msg.content, // TODO: handle content blocks with text
        }),
      );

      return { request } as unknown as HookResult<PreUpstreamData>;
    },
  };

  private redact(text: string): string {
    let result = text;
    for (const pattern of this.patterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }
}
