/**
 * ConfigService — split validation tests.
 *
 * Tests split weight validation in updateRouting()
 * and split cleanup logic in cleanupRoutingReferences().
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { ConfigService } from '../../src/config/config.service';

function createTempConfig(config: Record<string, unknown>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-split-test-'));
  const configPath = path.join(tmpDir, 'gateway.config.yaml');
  fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
  return configPath;
}

function makeMinimalConfig(overrides: Record<string, unknown> = {}) {
  return {
    server: { port: 3000 },
    database: { type: 'sqlite', path: ':memory:' },
    auth: { api_keys: [{ name: 'test', key: 'gw_sk_test' }] },
    nodes: [
      {
        id: 'claude', name: 'Claude', protocol: 'messages',
        base_url: 'https://api.anthropic.com', endpoint: '/v1/messages',
        api_key: 'sk-ant', models: ['claude-opus-4-6-v1'],
      },
      {
        id: 'gpt', name: 'GPT', protocol: 'chat_completions',
        base_url: 'https://api.openai.com', endpoint: '/v1/chat/completions',
        api_key: 'sk-test', models: ['gpt-5'],
      },
      {
        id: 'gemini', name: 'Gemini', protocol: 'chat_completions',
        base_url: 'https://api.google.com', endpoint: '/v1/chat/completions',
        api_key: 'gk-test', models: ['gemini-2.0-flash'],
      },
    ],
    routing: {
      tiers: {
        complex: {
          primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
          fallbacks: [{ node: 'gpt', model: 'gpt-5' }],
          split: [
            { node: 'claude', model: 'claude-opus-4-6-v1', weight: 70, name: 'control' },
            { node: 'gpt', model: 'gpt-5', weight: 30, name: 'challenger' },
          ],
        },
        simple: {
          primary: { node: 'gpt', model: 'gpt-5' },
          fallbacks: [{ node: 'claude', model: 'claude-opus-4-6-v1' }],
        },
      },
      scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 },
    },
    budget: { daily_token_limit: 1_000_000, daily_cost_limit: 10, alert_threshold: 0.8 },
    models_pricing: {},
    ...overrides,
  };
}

function loadConfigService(overrides: Record<string, unknown> = {}): { svc: ConfigService; configPath: string } {
  const configPath = createTempConfig(makeMinimalConfig(overrides));
  process.env.GATEWAY_CONFIG_PATH = configPath;
  const svc = new ConfigService();
  return { svc, configPath };
}

afterEach(() => {
  delete process.env.GATEWAY_CONFIG_PATH;
});

// ═══════════════════════════════════════════════════════════
// updateRouting — split validation
// ═══════════════════════════════════════════════════════════

describe('ConfigService — split validation', () => {
  it('should reject split weights that do not sum to 100', () => {
    const { svc } = loadConfigService();

    expect(() => {
      svc.updateRouting({
        tiers: {
          complex: {
            primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
            fallbacks: [],
            split: [
              { node: 'claude', model: 'claude-opus-4-6-v1', weight: 60 },
              { node: 'gpt', model: 'gpt-5', weight: 30 },
            ],
          },
        },
      });
    }).toThrow('split weights must sum to 100, got 90');
  });

  it('should reject split variant referencing non-existent node', () => {
    const { svc } = loadConfigService();

    expect(() => {
      svc.updateRouting({
        tiers: {
          complex: {
            primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
            fallbacks: [],
            split: [
              { node: 'nonexistent', model: 'some-model', weight: 50 },
              { node: 'gpt', model: 'gpt-5', weight: 50 },
            ],
          },
        },
      });
    }).toThrow('node "nonexistent" not found');
  });

  it('should accept valid split configuration', () => {
    const { svc, configPath } = loadConfigService();

    expect(() => {
      svc.updateRouting({
        tiers: {
          complex: {
            primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
            fallbacks: [{ node: 'gpt', model: 'gpt-5' }],
            split: [
              { node: 'claude', model: 'claude-opus-4-6-v1', weight: 70, name: 'control' },
              { node: 'gpt', model: 'gpt-5', weight: 30, name: 'challenger' },
            ],
          },
        },
      });
    }).not.toThrow();

    // Verify it was persisted
    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(saved.routing.tiers.complex.split).toHaveLength(2);
    expect(saved.routing.tiers.complex.split[0].weight).toBe(70);
  });
});

// ═══════════════════════════════════════════════════════════
// updateRouting — targets + strategy validation
// ═══════════════════════════════════════════════════════════

describe('ConfigService — load-balancing targets validation', () => {
  it('should accept targets-only routing schema', () => {
    const { svc, configPath } = loadConfigService();

    expect(() => {
      svc.updateRouting({
        tiers: {
          standard: {
            strategy: 'round_robin',
            targets: [
              { node: 'claude', model: 'claude-opus-4-6-v1', weight: 50 },
              { node: 'gpt', model: 'gpt-5', weight: 50 },
            ],
          },
        },
      });
    }).not.toThrow();

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(saved.routing.tiers.standard.strategy).toBe('round_robin');
    expect(saved.routing.tiers.standard.targets).toHaveLength(2);
  });

  it('should reject unsupported load-balancing strategy', () => {
    const { svc } = loadConfigService();

    expect(() => {
      svc.updateRouting({
        tiers: {
          standard: {
            strategy: 'weighted_round_robin' as any,
            targets: [{ node: 'gpt', model: 'gpt-5', weight: 100 }],
          },
        },
      });
    }).toThrow('strategy "weighted_round_robin" is not supported');
  });

  it('should reject weighted targets with no positive weight', () => {
    const { svc } = loadConfigService();

    expect(() => {
      svc.updateRouting({
        tiers: {
          standard: {
            strategy: 'weighted',
            targets: [
              { node: 'gpt', model: 'gpt-5', weight: 0 },
              { node: 'claude', model: 'claude-opus-4-6-v1', weight: 0 },
            ],
          },
        },
      });
    }).toThrow('weighted targets must have total weight > 0');
  });

  it('should warn when split and targets are both configured', () => {
    const { svc } = loadConfigService();
    svc.updateRouting({
      tiers: {
        standard: {
          primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
          fallbacks: [],
          strategy: 'round_robin',
          targets: [{ node: 'gpt', model: 'gpt-5', weight: 100 }],
          split: [{ node: 'claude', model: 'claude-opus-4-6-v1', weight: 100 }],
        },
      },
    });

    expect(svc.getNodeModelDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'split_overrides_targets',
          tier: 'standard',
        }),
      ]),
    );
  });
});

// ═══════════════════════════════════════════════════════════
// deleteNode — split cleanup
// ═══════════════════════════════════════════════════════════

describe('ConfigService — split cleanup on node delete', () => {
  it('should remove deleted node from split variants and renormalize weights', () => {
    const { svc, configPath } = loadConfigService();

    // Delete 'gpt' node — the 'challenger' variant should be removed
    svc.deleteNode('gpt');

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    const complexTier = saved.routing.tiers.complex;

    // Only claude variant should remain
    expect(complexTier.split).toHaveLength(1);
    expect(complexTier.split[0].node).toBe('claude');
    // Weight should be renormalized to 100
    expect(complexTier.split[0].weight).toBe(100);
  });

  it('should remove split field entirely when all variants are deleted', () => {
    const { svc, configPath } = loadConfigService({
      routing: {
        tiers: {
          complex: {
            primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
            fallbacks: [{ node: 'gemini', model: 'gemini-2.0-flash' }],
            split: [
              { node: 'gpt', model: 'gpt-5', weight: 100, name: 'solo' },
            ],
          },
          simple: {
            primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
            fallbacks: [],
          },
        },
        scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 },
      },
    });

    svc.deleteNode('gpt');

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(saved.routing.tiers.complex.split).toBeUndefined();
  });

  it('should not affect split when deleted node is not in split variants', () => {
    const { svc, configPath } = loadConfigService();

    // Delete 'gemini' — not in any split
    svc.deleteNode('gemini');

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(saved.routing.tiers.complex.split).toHaveLength(2);
    expect(saved.routing.tiers.complex.split[0].weight).toBe(70);
    expect(saved.routing.tiers.complex.split[1].weight).toBe(30);
  });
});
