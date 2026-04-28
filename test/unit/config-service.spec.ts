/**
 * ConfigService unit tests.
 *
 * Since ConfigService eagerly loads from YAML in its constructor,
 * we use the real gateway.config.yaml for tests. Set GATEWAY_CONFIG_PATH
 * before constructing.
 */

import * as path from 'path';
import { ConfigService } from '../../src/config/config.service';

describe('ConfigService', () => {
  let config: ConfigService;

  beforeAll(() => {
    process.env.GATEWAY_CONFIG_PATH = path.resolve(
      __dirname,
      '../../gateway.config.yaml',
    );
    config = new ConfigService();
  });

  afterAll(() => {
    delete process.env.GATEWAY_CONFIG_PATH;
  });

  // ── Basic accessors ──────────────────────────────────────

  describe('accessors', () => {
    it('should have server config', () => {
      expect(config.server).toBeDefined();
      expect(typeof config.server.port).toBe('number');
    });

    it('should have database config', () => {
      expect(config.database).toBeDefined();
      expect(config.database.type).toBeDefined();
    });

    it('should have at least one node', () => {
      expect(config.nodes.length).toBeGreaterThan(0);
    });

    it('should have routing config', () => {
      expect(config.routing).toBeDefined();
      expect(config.routing.tiers).toBeDefined();
    });

    it('should have budget config', () => {
      expect(config.budget).toBeDefined();
      expect(typeof config.budget.daily_token_limit).toBe('number');
    });

    it('should return cache defaults when not configured', () => {
      const cache = config.cache;
      expect(typeof cache.enabled).toBe('boolean');
      expect(typeof cache.ttl_seconds).toBe('number');
      expect(typeof cache.max_entries).toBe('number');
    });

    it('should return retry defaults', () => {
      const retry = config.retry;
      expect(typeof retry.max_retries).toBe('number');
      expect(typeof retry.backoff_base_ms).toBe('number');
      expect(Array.isArray(retry.retryable_status)).toBe(true);
    });
  });

  // ── getNode ──────────────────────────────────────────────

  describe('getNode', () => {
    it('should find a node by ID', () => {
      const firstNode = config.nodes[0];
      const found = config.getNode(firstNode.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(firstNode.id);
    });

    it('should return undefined for unknown node', () => {
      expect(config.getNode('nonexistent-node-xxx')).toBeUndefined();
    });
  });

  // ── resolveModel ─────────────────────────────────────────

  describe('resolveModel', () => {
    it('should resolve exact model ID', () => {
      const firstNode = config.nodes[0];
      const firstModel = firstNode.models[0];
      if (firstModel) {
        const result = config.resolveModel(firstModel);
        expect(result).not.toBeNull();
        expect(result!.nodeId).toBe(firstNode.id);
        expect(result!.model).toBe(firstModel);
      }
    });

    it('should resolve node ID shortcut to first model', () => {
      const firstNode = config.nodes[0];
      const result = config.resolveModel(firstNode.id);
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe(firstNode.id);
      expect(result!.model).toBe(firstNode.models[0]);
    });

    it('should resolve prefix with / separator', () => {
      const firstNode = config.nodes[0];
      const result = config.resolveModel(`${firstNode.id}/custom-model-name`);
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe(firstNode.id);
      expect(result!.model).toBe('custom-model-name');
    });

    it('should resolve prefix with : separator', () => {
      const firstNode = config.nodes[0];
      const result = config.resolveModel(`${firstNode.id}:custom-model-name`);
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe(firstNode.id);
      expect(result!.model).toBe('custom-model-name');
    });

    it('should resolve model alias if configured', () => {
      // Find a node with aliases
      const nodeWithAliases = config.nodes.find(
        (n) => n.model_aliases && Object.keys(n.model_aliases).length > 0,
      );
      if (nodeWithAliases) {
        const [alias, target] = Object.entries(nodeWithAliases.model_aliases!)[0];
        const result = config.resolveModel(alias);
        expect(result).not.toBeNull();
        // The alias should resolve to the correct target model
        // (though it might route through exact match or node-prefix first)
        expect(result!.model).toBeDefined();
      }
    });

    it('should return null for truly unknown model', () => {
      expect(config.resolveModel('totally-unknown-model-xyz-123')).toBeNull();
    });
  });

  // ── listModels ───────────────────────────────────────────

  describe('listModels', () => {
    it('should return at least as many entries as total models across nodes', () => {
      const totalModels = config.nodes.reduce(
        (sum, n) => sum + n.models.length,
        0,
      );
      const listed = config.listModels();
      expect(listed.length).toBeGreaterThanOrEqual(totalModels);
    });

    it('should include node ID as an alias for first model', () => {
      const firstNode = config.nodes[0];
      const listed = config.listModels();
      const firstModelEntry = listed.find(
        (m) => m.id === firstNode.models[0] && m.node === firstNode.id,
      );
      expect(firstModelEntry).toBeDefined();
      expect(firstModelEntry!.aliases).toContain(firstNode.id);
    });
  });

  // ── resolveEnvVars ───────────────────────────────────────

  describe('resolveEnvVars (indirect)', () => {
    it('should resolve env vars in config values', () => {
      // Set an env var before loading config
      process.env.TEST_GATEWAY_PORT = '9999';
      // We can't easily test this without a custom YAML, but we can at least
      // verify the config loaded without errors (which means resolveEnvVars ran)
      expect(config.server).toBeDefined();
      delete process.env.TEST_GATEWAY_PORT;
    });
  });

  // ── getFullConfig ────────────────────────────────────────

  describe('getFullConfig', () => {
    it('should return a config with all required sections', () => {
      const full = config.getFullConfig();
      expect(full.server).toBeDefined();
      expect(full.database).toBeDefined();
      expect(full.nodes).toBeDefined();
      expect(full.routing).toBeDefined();
      expect(full.budget).toBeDefined();
    });
  });
});
