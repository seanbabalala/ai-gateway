import { ProviderClientService } from '../../src/providers/provider-client.service';
import { MessagesDenormalizer } from '../../src/canonical/denormalizers/messages.denormalizer';
import { TelemetryService } from '../../src/telemetry/telemetry.service';
import type { Tier } from '../../src/canonical/canonical.types';

describe('native Messages content fidelity', () => {
  it('preserves server search calls, results, citations and signatures in JSON without changing cache accounting', () => {
    const body = {
      id: 'msg_native',
      type: 'message',
      role: 'assistant',
      model: 'native-model',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'plan', signature: 'native-signature' },
        {
          type: 'server_tool_use',
          id: 'srv_1',
          name: 'web_search',
          input: { query: 'official docs' },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srv_1',
          content: [
            {
              type: 'web_search_result',
              title: 'Docs',
              url: 'https://example.com/docs',
              encrypted_content: 'opaque-provider-content',
            },
          ],
        },
        {
          type: 'text',
          text: 'See Docs.',
          citations: [
            {
              type: 'web_search_result_location',
              url: 'https://example.com/docs',
              title: 'Docs',
              cited_text: 'Docs',
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
        output_tokens: 5,
      },
    };
    const before = JSON.stringify(body);
    const service = new ProviderClientService(
      {} as any,
      new TelemetryService(),
    );
    const canonical = service.normalizeResponse(
      body,
      'messages',
      { tier: 'standard' as Tier, score: 0, is_fallback: false },
      'native',
      'native-model',
      1,
    );
    const out = new MessagesDenormalizer().denormalizeResponse(canonical);
    expect(out.content).toEqual(body.content);
    expect(out.usage).toEqual(body.usage);
    expect(out.id).toBe(body.id);
    expect(JSON.stringify(body)).toBe(before);
    (out.content as any[])[1].input.query = 'changed';
    expect((canonical.native_messages_content?.[1] as any).input.query).toBe(
      'official docs',
    );
  });
  it('keeps a native search error as an error block, never turning it into successful text', () => {
    const content = [
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srv_1',
        content: {
          type: 'web_search_tool_result_error',
          error_code: 'max_uses_exceeded',
        },
      },
    ];
    const service = new ProviderClientService(
      {} as any,
      new TelemetryService(),
    );
    const c = service.normalizeResponse(
      {
        id: 'msg_error',
        model: 'native',
        content,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      'messages',
      { tier: 'standard' as Tier, score: 0, is_fallback: false },
      'native',
      'native',
      1,
    );
    expect(new MessagesDenormalizer().denormalizeResponse(c).content).toEqual(
      content,
    );
  });
});
