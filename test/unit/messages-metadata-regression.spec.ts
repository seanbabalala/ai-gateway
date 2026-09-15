import { ProviderClientService } from '../../src/providers/provider-client.service';
import { TelemetryService } from '../../src/telemetry/telemetry.service';
import { MessagesDenormalizer } from '../../src/canonical/denormalizers/messages.denormalizer';
import { MessagesNormalizer } from '../../src/canonical/normalizers/messages.normalizer';
import { ResponsesNormalizer } from '../../src/canonical/normalizers/responses.normalizer';
import { ChatCompletionsDenormalizer } from '../../src/canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../../src/canonical/denormalizers/responses.denormalizer';
import { resolveReasoningForwarding } from '../../src/canonical/reasoning-effort';

const provider = new ProviderClientService(
  {} as any,
  new TelemetryService(),
) as any;
const denormalizer = new MessagesDenormalizer();
const normalizer = new MessagesNormalizer();
const routing = { tier: 'standard', score: 0.1, is_fallback: false };
const content = [
  {
    type: 'thinking',
    thinking: '检查🙂\nnext',
    signature: 'opaque-signed-state',
  },
  { type: 'redacted_thinking', data: 'opaque-redacted-data' },
  { type: 'text', text: 'Working' },
  {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'read_file',
    input: { path: '测试.ts' },
  },
];

describe('native Messages response and history fidelity', () => {
  it.each([
    [173, 21248, 0],
    [10, 0, 25],
    [10, 20, 5],
    [10, 0, 0],
    [0, 20, 5],
    [0, 0, 0],
  ])(
    'round-trips uncached=%i read=%i write=%i without double counting',
    (uncached, read, write) => {
      const body = {
        id: 'msg_original',
        model: 'claude',
        content,
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {
          input_tokens: uncached,
          output_tokens: 8,
          cache_read_input_tokens: read,
          cache_creation_input_tokens: write,
        },
      };
      const canonical = provider.normalizeMessagesResponse(
        body,
        routing,
        'example-messages-provider',
        'claude',
        10,
      );
      expect(canonical.usage.input_tokens).toBe(uncached + read + write);
      const wire = denormalizer.denormalizeResponse(canonical) as any;
      expect(wire.usage.input_tokens).toBe(uncached);
      expect(wire.usage.cache_read_input_tokens).toBe(read);
      expect(wire.usage.cache_creation_input_tokens).toBe(write);
      expect(wire.id).toBe('msg_original');
      expect(wire.content).toEqual(content);
      expect(wire.stop_sequence).toBeNull();
      const again = provider.normalizeMessagesResponse(
        wire,
        routing,
        'example-messages-provider',
        'claude',
        10,
      );
      expect(again.usage).toEqual(canonical.usage);
      expect(denormalizer.denormalizeResponse(again)).toEqual(wire);
      expect(denormalizer.denormalizeResponse(canonical)).toEqual(wire);
    },
  );
  it('preserves signatures, redacted blocks, empty thinking and block order in native history', () => {
    const blocks = [
      { type: 'thinking', thinking: '', signature: '' },
      ...content,
    ];
    const body = {
      model: 'claude',
      max_tokens: 512,
      messages: [{ role: 'assistant', content: blocks }],
    };
    const canonical = normalizer.normalize(body, {});
    expect(
      (denormalizer.denormalize(canonical, 'claude') as any).messages[0]
        .content,
    ).toEqual(blocks);
    expect(
      provider.buildNativeMessagesRequest(canonical, 'claude').messages[0]
        .content,
    ).toEqual(blocks);
    expect(body.messages[0].content).toEqual(blocks);
  });
  it.each([false, true])(
    'replays a non-stream response through the actual provider path (stream=%s)',
    (stream) => {
      const upstream = {
        id: 'msg_original',
        model: 'claude',
        content,
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 8 },
      };
      const response = denormalizer.denormalizeResponse(
        provider.normalizeMessagesResponse(
          upstream,
          routing,
          'example-provider',
          'claude',
          10,
        ),
      ) as any;
      const history = [
        { role: 'user', content: 'Read the file' },
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'File contents',
            },
          ],
        },
      ];
      const canonical = normalizer.normalize(
        { model: 'claude', max_tokens: 4096, stream, messages: history },
        {},
      );
      expect(
        provider.denormalizeRequest(canonical, 'messages', 'claude').messages,
      ).toEqual(history);
    },
  );
  it('preserves the actual stop sequence', () => {
    const canonical = provider.normalizeMessagesResponse(
      {
        content: [],
        stop_reason: 'stop_sequence',
        stop_sequence: 'END',
        usage: {},
      },
      routing,
      'example-provider',
      'claude',
      10,
    );
    expect(denormalizer.denormalizeResponse(canonical)).toMatchObject({
      stop_reason: 'stop_sequence',
      stop_sequence: 'END',
    });
  });
  it('adds the Messages ID prefix only when missing', () => {
    const canonical = provider.normalizeMessagesResponse(
      { id: 'original', content: [], usage: {} },
      routing,
      'example-provider',
      'claude',
      10,
    );
    expect(denormalizer.denormalizeResponse(canonical)).toMatchObject({
      id: 'msg_original',
    });
  });
  it.each(['user', 'assistant'])(
    'never leaks opaque native state as %s text on other protocols',
    (role) => {
      const canonical = normalizer.normalize(
        { model: 'claude', max_tokens: 512, messages: [{ role, content }] },
        {},
      );
      for (const target of [
        new ChatCompletionsDenormalizer(),
        new ResponsesDenormalizer(),
      ]) {
        const wire = JSON.stringify(
          target.denormalize(canonical, 'other-model'),
        );
        expect(wire).not.toContain('opaque-signed-state');
        expect(wire).not.toContain('opaque-redacted-data');
      }
    },
  );
});

describe('forced tool choice preserves explicit thinking intent', () => {
  it.each([{ type: 'tool', name: 'probe' }, { type: 'any' }])(
    'disables provider-default thinking for %j',
    (tool_choice) => {
      const body = {
        model: 'claude',
        messages: [{ role: 'user', content: 'Probe' }],
        max_tokens: 512,
        tool_choice,
      };
      const canonical = normalizer.normalize(body, {});
      expect(
        provider.buildNativeMessagesRequest(canonical, 'claude'),
      ).toMatchObject({ thinking: { type: 'disabled' } });
      expect(denormalizer.denormalize(canonical, 'claude')).toMatchObject({
        thinking: { type: 'disabled' },
      });
      expect(body).not.toHaveProperty('thinking');
    },
  );
  it.each([
    { type: 'enabled', budget_tokens: 2048 },
    { type: 'adaptive' },
    { type: 'disabled' },
  ])('does not overwrite explicit %j', (thinking) => {
    const body = {
      model: 'claude',
      messages: [],
      max_tokens: 4096,
      tool_choice: { type: 'any' },
      thinking,
    };
    expect(
      provider.buildNativeMessagesRequest(
        normalizer.normalize(body, {}),
        'claude',
      ),
    ).toMatchObject({ thinking });
    expect(
      denormalizer.denormalize(normalizer.normalize(body, {}), 'claude'),
    ).toMatchObject({ thinking });
  });
  it.each([undefined, { type: 'auto' }, { type: 'none' }])(
    'does not change default thinking for non-forced choice %j',
    (tool_choice) => {
      const canonical = normalizer.normalize(
        { model: 'claude', messages: [], max_tokens: 4096, tool_choice },
        {},
      );
      expect(
        provider.buildNativeMessagesRequest(canonical, 'claude'),
      ).not.toHaveProperty('thinking');
      expect(denormalizer.denormalize(canonical, 'claude')).not.toHaveProperty(
        'thinking',
      );
    },
  );
  it('honors tool_choice none rather than turning tools on', () => {
    const body = {
      model: 'claude',
      messages: [],
      max_tokens: 512,
      tool_choice: { type: 'none' },
    };
    expect(
      denormalizer.denormalize(normalizer.normalize(body, {}), 'claude'),
    ).toMatchObject({ tool_choice: { type: 'none' } });
  });
  it('maps an explicit Responses reasoning none into disabled thinking', () => {
    const canonical = new ResponsesNormalizer().normalize(
      {
        model: 'claude',
        input: 'Probe',
        tool_choice: 'required',
        reasoning: { effort: 'none' },
      },
      {},
    );
    expect(denormalizer.denormalize(canonical, 'claude')).toMatchObject({
      thinking: { type: 'disabled' },
    });
    expect(
      resolveReasoningForwarding(
        canonical.reasoning,
        'responses',
        'messages',
        true,
      ),
    ).toMatchObject({ supported: true, strategy: 'native', effort: 'none' });
  });
  it.each(['none', 'high'])(
    'respects reasoning effort %s on the native Messages path',
    (effort) => {
      const canonical = normalizer.normalize(
        {
          model: 'claude',
          messages: [],
          max_tokens: 4096,
          reasoning: { effort },
          tool_choice: { type: 'any' },
        },
        {},
      );
      expect(
        provider.buildNativeMessagesRequest(canonical, 'claude').thinking,
      ).toEqual(
        effort === 'none'
          ? { type: 'disabled' }
          : { type: 'enabled', budget_tokens: 3072 },
      );
    },
  );
  it.each([{ type: 'enabled', budget_tokens: 2048 }, { type: 'adaptive' }])(
    'keeps an explicit incompatible %j and its upstream 400',
    async (thinking) => {
      const canonical = normalizer.normalize(
        {
          model: 'claude',
          messages: [{ role: 'user', content: 'Probe' }],
          max_tokens: 4096,
          tool_choice: { type: 'any' },
          thinking,
        },
        {},
      );
      const node = {
        id: 'fixture',
        name: 'Fixture',
        protocol: 'messages',
        base_url: 'https://fixture.invalid',
        endpoint: '/v1/messages',
        api_key: 'fixture-not-a-secret',
        models: ['claude'],
        model_aliases: {},
        timeout_ms: 5000,
      };
      const service = new ProviderClientService(
        { getNode: () => node } as any,
        new TelemetryService(),
      );
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'Thinking mode does not support this tool_choice.',
              },
            }),
            { status: 400 },
          ),
        );
      try {
        await expect(
          service.forward(canonical, 'fixture', 'claude', {
            ...routing,
            tier: 'standard',
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          message: expect.stringContaining(
            'Thinking mode does not support this tool_choice.',
          ),
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(
          JSON.parse(fetchMock.mock.calls[0][1]?.body as string).thinking,
        ).toEqual(thinking);
      } finally {
        fetchMock.mockRestore();
      }
    },
  );
});
