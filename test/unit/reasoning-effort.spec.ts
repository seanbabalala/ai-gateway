import {
  resolveReasoningForwarding,
  toAnthropicThinking,
} from '../../src/canonical/reasoning-effort';
import type { CanonicalReasoningIntent } from '../../src/canonical/canonical.types';

describe('reasoning effort forwarding', () => {
  const maxIntent: CanonicalReasoningIntent = {
    requested: true,
    source: 'chat_completions.reasoning_effort',
    effort: 'max',
    raw: 'max',
  };

  it('maps GPT-5.6 max effort between OpenAI Chat and Responses', () => {
    expect(
      resolveReasoningForwarding(
        maxIntent,
        'chat_completions',
        'responses',
        true,
      ),
    ).toMatchObject({
      effort: 'max',
      strategy: 'native',
      supported: true,
    });
  });

  it('does not invent an Anthropic token budget for max effort', () => {
    expect(toAnthropicThinking(maxIntent, 16_384)).toBeUndefined();
    expect(
      resolveReasoningForwarding(
        maxIntent,
        'chat_completions',
        'messages',
        true,
      ),
    ).toMatchObject({
      effort: 'max',
      strategy: 'downgraded',
      supported: false,
    });
  });
});
