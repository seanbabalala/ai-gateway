/**
 * ConfigService — mutation path tests.
 *
 * Tests addNode, updateNode, deleteNode, cleanupRoutingReferences,
 * setModelPricing, deleteModelPricing, updateRouting, setDashboardPasswordHash.
 *
 * Uses a temporary YAML file to avoid touching the real config.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { ConfigService } from '../../src/config/config.service';

function createTempConfig(config: Record<string, unknown>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-test-'));
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
        id: 'openai', name: 'OpenAI', protocol: 'chat_completions',
        base_url: 'https://api.openai.com', endpoint: '/v1/chat/completions',
        api_key: 'sk-test', models: ['gpt-4o', 'gpt-4o-mini'],
      },
      {
        id: 'claude', name: 'Claude', protocol: 'messages',
        base_url: 'https://api.anthropic.com', endpoint: '/v1/messages',
        api_key: 'sk-ant', models: ['claude-3-opus'],
      },
    ],
    routing: {
      tiers: {
        simple: { primary: { node: 'openai', model: 'gpt-4o-mini' }, fallbacks: [{ node: 'claude', model: 'claude-3-opus' }] },
        standard: { primary: { node: 'openai', model: 'gpt-4o' }, fallbacks: [{ node: 'claude', model: 'claude-3-opus' }] },
        complex: { primary: { node: 'claude', model: 'claude-3-opus' }, fallbacks: [{ node: 'openai', model: 'gpt-4o' }] },
      },
      scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 },
      domain_preferences: { code: ['claude'], math: ['openai'] },
    },
    budget: { daily_token_limit: 1_000_000, daily_cost_limit: 10, alert_threshold: 0.8 },
    models_pricing: { 'gpt-4o': { input: 5, output: 15 } },
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
// addNode
// ═══════════════════════════════════════════════════════════

describe('ConfigService — addNode', () => {
  it('should add a new node and persist to YAML', () => {
    const { svc, configPath } = loadConfigService();
    const newNode = {
      id: 'gemini', name: 'Gemini', protocol: 'chat_completions',
      base_url: 'https://api.google.com', endpoint: '/v1/chat/completions',
      api_key: 'gk-test', models: ['gemini-2.0-flash'],
    } as any;

    svc.addNode(newNode);

    expect(svc.nodes).toHaveLength(3);
    expect(svc.getNode('gemini')).toBeDefined();
    // Verify persisted
    const persisted = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(persisted.nodes).toHaveLength(3);
  });

  it('should throw if node ID already exists', () => {
    const { svc } = loadConfigService();
    expect(() => svc.addNode({ id: 'openai' } as any)).toThrow('already exists');
  });
});

// ═══════════════════════════════════════════════════════════
// updateNode
// ═══════════════════════════════════════════════════════════

describe('ConfigService — updateNode', () => {
  it('should merge-update node fields', () => {
    const { svc } = loadConfigService();
    svc.updateNode('openai', { name: 'OpenAI Updated' });
    expect(svc.getNode('openai')!.name).toBe('OpenAI Updated');
    expect(svc.getNode('openai')!.id).toBe('openai'); // ID preserved
  });

  it('should throw for unknown node', () => {
    const { svc } = loadConfigService();
    expect(() => svc.updateNode('nonexistent', { name: 'X' })).toThrow('not found');
  });
});

// ═══════════════════════════════════════════════════════════
// deleteNode + cleanupRoutingReferences
// ═══════════════════════════════════════════════════════════

describe('ConfigService — deleteNode', () => {
  it('should delete a node and persist', () => {
    const { svc, configPath } = loadConfigService();
    svc.deleteNode('claude');

    expect(svc.nodes).toHaveLength(1);
    expect(svc.getNode('claude')).toBeUndefined();
    const persisted = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(persisted.nodes).toHaveLength(1);
  });

  it('should throw when deleting the last node', () => {
    const { svc } = loadConfigService();
    svc.deleteNode('claude'); // now only openai
    expect(() => svc.deleteNode('openai')).toThrow('last remaining');
  });

  it('should throw for unknown node', () => {
    const { svc } = loadConfigService();
    expect(() => svc.deleteNode('nonexistent')).toThrow('not found');
  });

  it('should remove deleted node from fallbacks in routing tiers', () => {
    const { svc } = loadConfigService();
    svc.deleteNode('claude');

    // claude was fallback in simple and standard tiers
    const simple = svc.routing.tiers.simple;
    expect(simple.fallbacks.every((fb: any) => fb.node !== 'claude')).toBe(true);
  });

  it('should promote fallback to primary when primary is deleted', () => {
    const { svc } = loadConfigService();
    // In 'complex' tier, claude is primary → deleting claude should promote openai
    svc.deleteNode('claude');

    const complex = svc.routing.tiers.complex;
    expect(complex.primary.node).toBe('openai');
  });

  it('should remove deleted node from domain_preferences', () => {
    const { svc } = loadConfigService();
    svc.deleteNode('claude');

    const domainPrefs = svc.routing.domain_preferences;
    if (domainPrefs) {
      expect(domainPrefs.code).not.toContain('claude');
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Model Pricing CRUD
// ═══════════════════════════════════════════════════════════

describe('ConfigService — model pricing', () => {
  it('should set pricing for a new model', () => {
    const { svc } = loadConfigService();
    svc.setModelPricing('claude-3-opus', { input: 15, output: 75 });
    expect(svc.getModelPricing('claude-3-opus')).toEqual({ input: 15, output: 75 });
  });

  it('should update existing pricing', () => {
    const { svc } = loadConfigService();
    svc.setModelPricing('gpt-4o', { input: 2.5, output: 10 });
    expect(svc.getModelPricing('gpt-4o')).toEqual({ input: 2.5, output: 10 });
  });

  it('should delete pricing', () => {
    const { svc } = loadConfigService();
    svc.deleteModelPricing('gpt-4o');
    expect(svc.getModelPricing('gpt-4o')).toBeUndefined();
  });

  it('should throw when deleting non-existent pricing', () => {
    const { svc } = loadConfigService();
    expect(() => svc.deleteModelPricing('nonexistent')).toThrow('not found');
  });
});

// ═══════════════════════════════════════════════════════════
// updateRouting
// ═══════════════════════════════════════════════════════════

describe('ConfigService — updateRouting', () => {
  it('should update scoring thresholds', () => {
    const { svc } = loadConfigService();
    svc.updateRouting({ scoring: { simple_max: 0.2, standard_max: 0.5, complex_max: 0.8 } });
    expect(svc.routing.scoring.simple_max).toBe(0.2);
  });

  it('should update tier configuration', () => {
    const { svc } = loadConfigService();
    svc.updateRouting({
      tiers: {
        simple: { primary: { node: 'claude', model: 'claude-3-opus' }, fallbacks: [] },
      },
    });
    expect(svc.routing.tiers.simple.primary.node).toBe('claude');
  });

  it('should throw for invalid node reference in tiers', () => {
    const { svc } = loadConfigService();
    expect(() => svc.updateRouting({
      tiers: {
        simple: { primary: { node: 'nonexistent', model: 'foo' }, fallbacks: [] },
      },
    })).toThrow('not found');
  });

  it('should update domain preferences', () => {
    const { svc } = loadConfigService();
    svc.updateRouting({ domain_preferences: { code: ['openai', 'claude'] } });
    expect(svc.routing.domain_preferences!.code).toEqual(['openai', 'claude']);
  });
});

// ═══════════════════════════════════════════════════════════
// setDashboardPasswordHash
// ═══════════════════════════════════════════════════════════

describe('ConfigService — setDashboardPasswordHash', () => {
  it('should set dashboard password and persist', () => {
    const { svc, configPath } = loadConfigService();
    svc.setDashboardPasswordHash('$2b$10$hashed');
    expect(svc.dashboardPasswordHash).toBe('$2b$10$hashed');
    const persisted = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    expect(persisted.dashboard.password).toBe('$2b$10$hashed');
  });

  it('should create dashboard section if not present', () => {
    const { svc } = loadConfigService();
    // dashboard section doesn't exist in minimal config
    svc.setDashboardPasswordHash('$2b$10$new');
    expect(svc.dashboardPasswordHash).toBe('$2b$10$new');
  });
});

// ═══════════════════════════════════════════════════════════
// reload
// ═══════════════════════════════════════════════════════════

describe('ConfigService — reload', () => {
  it('should reload config from disk', () => {
    const { svc, configPath } = loadConfigService();
    // Modify the file on disk
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
    raw.server.port = 9999;
    fs.writeFileSync(configPath, yaml.dump(raw), 'utf8');

    svc.reload();
    expect(svc.server.port).toBe(9999);
  });
});
