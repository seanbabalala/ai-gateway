import { buildNodeModelDiagnostics } from '../../src/config/config-diagnostics';
import type { NodeConfig } from '../../src/config/gateway.config';

const SPECIALIZED_MODEL_BUCKETS = [
  'embedding_models',
  'rerank_models',
  'image_models',
  'audio_models',
  'video_models',
  'realtime_models',
] as const;

function node(id: string, overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id,
    name: id,
    protocol: 'chat_completions',
    base_url: 'https://provider.example',
    endpoint: '/v1/chat/completions',
    api_key: 'test-only-key',
    timeout_ms: 60000,
    models: ['shared-model'],
    ...overrides,
  };
}

describe('buildNodeModelDiagnostics model ownership', () => {
  it.each(SPECIALIZED_MODEL_BUCKETS)(
    'does not report multiple providers for models and %s on one node',
    (bucket) => {
      const diagnostics = buildNodeModelDiagnostics({
        nodes: [node('provider-a', { [bucket]: ['shared-model'] })],
      });

      expect(
        diagnostics.filter((item) => item.code === 'duplicate_model_id'),
      ).toEqual([]);
      expect(
        diagnostics.filter((item) => item.code === 'missing_model_pricing'),
      ).toEqual([
        expect.objectContaining({
          model: 'shared-model',
          nodes: ['provider-a'],
        }),
      ]);
    },
  );

  it('does not treat repeated entries within one bucket as multiple providers', () => {
    const diagnostics = buildNodeModelDiagnostics({
      nodes: [node('provider-a', { models: ['shared-model', 'shared-model'] })],
    });

    expect(
      diagnostics.filter((item) => item.code === 'duplicate_model_id'),
    ).toEqual([]);
    expect(
      diagnostics.find((item) => item.code === 'missing_model_pricing')?.nodes,
    ).toEqual(['provider-a']);
  });

  it('counts each provider once across all model buckets without mutating config', () => {
    const provider = node('provider-a');
    for (const bucket of SPECIALIZED_MODEL_BUCKETS) {
      provider[bucket] = ['shared-model', 'shared-model'];
    }
    const config = { nodes: [provider] };
    const original = structuredClone(config);

    const diagnostics = buildNodeModelDiagnostics(config);

    expect(
      diagnostics.filter((item) => item.code === 'duplicate_model_id'),
    ).toEqual([]);
    expect(
      diagnostics.find((item) => item.code === 'missing_model_pricing')?.nodes,
    ).toEqual(['provider-a']);
    expect(config).toEqual(original);
  });

  it.each(SPECIALIZED_MODEL_BUCKETS)(
    'preserves real conflicts with a specialized-only %s model on another node',
    (bucket) => {
      const diagnostics = buildNodeModelDiagnostics({
        nodes: [
          node('provider-b', { [bucket]: ['shared-model', 'shared-model'] }),
          node('provider-a', { models: [], [bucket]: ['shared-model'] }),
        ],
      });

      expect(
        diagnostics.filter((item) => item.code === 'duplicate_model_id'),
      ).toEqual([
        {
          severity: 'warning',
          code: 'duplicate_model_id',
          message:
            'Model id "shared-model" is listed under multiple upstream nodes (provider-b, provider-a). Direct requests for this model will route to the first matching node in config order.',
          nodes: ['provider-b', 'provider-a'],
          model: 'shared-model',
        },
      ]);
    },
  );

  it('lists each real model owner once in alias conflict diagnostics', () => {
    const diagnostics = buildNodeModelDiagnostics({
      nodes: [
        node('provider-a', { image_models: ['shared-model'] }),
        node('provider-b', {
          models: ['other-model'],
          model_aliases: { 'shared-model': 'other-model' },
        }),
      ],
    });

    expect(
      diagnostics.find((item) => item.code === 'alias_conflicts_with_model_id'),
    ).toEqual(
      expect.objectContaining({
        alias: 'shared-model',
        nodes: ['provider-b'],
        matchingNodes: ['provider-a'],
      }),
    );
  });

  it('still reports only unpriced providers for a shared model', () => {
    const diagnostics = buildNodeModelDiagnostics({
      nodes: [
        node('provider-a', {
          embedding_models: ['shared-model'],
          model_capabilities: {
            'shared-model': { pricing: { input: 0.1, output: 0 } },
          },
        }),
        node('provider-b', { embedding_models: ['shared-model'] }),
      ],
    });

    expect(
      diagnostics.find((item) => item.code === 'duplicate_model_id')?.nodes,
    ).toEqual(['provider-a', 'provider-b']);
    expect(
      diagnostics.find((item) => item.code === 'missing_model_pricing')?.nodes,
    ).toEqual(['provider-b']);
  });

  it('deduplicates model owners by node ID even in an otherwise invalid config', () => {
    const diagnostics = buildNodeModelDiagnostics({
      nodes: [
        node('provider-a'),
        node('provider-a', { embedding_models: ['shared-model'] }),
      ],
    });

    expect(
      diagnostics.filter((item) => item.code === 'duplicate_model_id'),
    ).toEqual([]);
  });
});
