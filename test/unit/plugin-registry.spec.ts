/**
 * PluginRegistryService unit tests.
 */

import { PluginRegistryService } from '../../src/plugins/plugin-registry.service';
import type { GatewayPlugin } from '../../src/plugins/types';

function makePlugin(
  name: string,
  overrides: Partial<GatewayPlugin> = {},
): GatewayPlugin {
  return {
    meta: { name, version: '1.0.0', priority: 100, ...overrides.meta },
    hooks: overrides.hooks,
    scoringDimensions: overrides.scoringDimensions,
    events: overrides.events,
    onLoad: overrides.onLoad,
    onReady: overrides.onReady,
    onDestroy: overrides.onDestroy,
    getStatus: overrides.getStatus,
  } as GatewayPlugin;
}

describe('PluginRegistryService', () => {
  let registry: PluginRegistryService;

  beforeEach(() => {
    registry = new PluginRegistryService();
  });

  // ── Registration ──────────────────────────────────────────

  it('should register a single plugin and report hasPlugins=true', () => {
    expect(registry.hasPlugins()).toBe(false);
    registry.register(makePlugin('test-plugin'));
    expect(registry.hasPlugins()).toBe(true);
  });

  it('should throw on duplicate plugin names', () => {
    registry.register(makePlugin('dup'));
    expect(() => registry.register(makePlugin('dup'))).toThrow(
      'already registered',
    );
  });

  it('should return registered plugins metadata', () => {
    registry.register(
      makePlugin('alpha', { meta: { name: 'alpha', version: '2.0.0', priority: 50 } } as any),
    );
    const plugins = registry.getRegisteredPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toEqual({ name: 'alpha', version: '2.0.0', priority: 50 });
  });

  it('should return optional privacy-safe plugin status snapshots', () => {
    registry.register(
      makePlugin('guardrails', {
        getStatus: () => ({ enabled: true, findings: { total: 1 } }),
      }),
    );

    expect(registry.getPluginStatus('guardrails')).toEqual({
      enabled: true,
      findings: { total: 1 },
    });
    expect(registry.getPluginStatus('missing')).toBeNull();
  });

  // ── Hook Chains ───────────────────────────────────────────

  it('should build hook chains from registered plugins', () => {
    const hookFn = jest.fn();
    registry.register(
      makePlugin('p1', {
        hooks: { preRequest: hookFn } as any,
      }),
    );
    const chain = registry.getHookChain('preRequest');
    expect(chain).toHaveLength(1);
    expect(chain[0].fn).toBe(hookFn);
    expect(chain[0].pluginName).toBe('p1');
  });

  it('should sort hook chains by priority (lower first)', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    const fn3 = jest.fn();

    registry.register(
      makePlugin('p-high', {
        meta: { name: 'p-high', version: '1.0.0', priority: 200 },
        hooks: { preRequest: fn1 } as any,
      } as any),
    );
    registry.register(
      makePlugin('p-low', {
        meta: { name: 'p-low', version: '1.0.0', priority: 10 },
        hooks: { preRequest: fn2 } as any,
      } as any),
    );
    registry.register(
      makePlugin('p-mid', {
        meta: { name: 'p-mid', version: '1.0.0', priority: 100 },
        hooks: { preRequest: fn3 } as any,
      } as any),
    );

    const chain = registry.getHookChain('preRequest');
    expect(chain.map((c) => c.pluginName)).toEqual([
      'p-low',
      'p-mid',
      'p-high',
    ]);
  });

  it('should return empty chain for unregistered hooks', () => {
    expect(registry.getHookChain('nonexistent')).toEqual([]);
  });

  // ── Dimensions ────────────────────────────────────────────

  it('should merge scoring dimensions from multiple plugins', () => {
    registry.register(
      makePlugin('dim-1', {
        scoringDimensions: [
          { name: 'custom1', defaultWeight: 0.05, scorer: () => 0 },
        ],
      }),
    );
    registry.register(
      makePlugin('dim-2', {
        scoringDimensions: [
          { name: 'custom2', defaultWeight: 0.03, scorer: () => 0 },
        ],
      }),
    );

    const dims = registry.getDimensions();
    expect(dims).toHaveLength(2);
    expect(dims.map((d) => d.name)).toEqual(['custom1', 'custom2']);
  });

  // ── Plugin Config ─────────────────────────────────────────

  it('should store and return plugin config', () => {
    registry.register(makePlugin('cfg'), { key: 'value' });
    expect(registry.getPluginConfig('cfg')).toEqual({ key: 'value' });
  });

  it('should return empty object for unknown plugin config', () => {
    expect(registry.getPluginConfig('nonexistent')).toEqual({});
  });

  // ── Lifecycle: onReady / onDestroy ────────────────────────

  it('should call onReady() for all plugins on bootstrap', async () => {
    const onReady1 = jest.fn();
    const onReady2 = jest.fn();
    registry.register(makePlugin('r1', { onReady: onReady1 }));
    registry.register(makePlugin('r2', { onReady: onReady2 }));

    await registry.onApplicationBootstrap();

    expect(onReady1).toHaveBeenCalledTimes(1);
    expect(onReady2).toHaveBeenCalledTimes(1);
  });

  it('should call onDestroy() in reverse order on shutdown', async () => {
    const order: string[] = [];
    registry.register(
      makePlugin('d1', {
        onDestroy: () => {
          order.push('d1');
        },
      }),
    );
    registry.register(
      makePlugin('d2', {
        onDestroy: () => {
          order.push('d2');
        },
      }),
    );

    await registry.onApplicationShutdown();

    expect(order).toEqual(['d2', 'd1']);
  });

  it('should not throw if one plugin onDestroy fails', async () => {
    registry.register(
      makePlugin('fail', {
        onDestroy: () => {
          throw new Error('destroy error');
        },
      }),
    );
    registry.register(
      makePlugin('ok', {
        onDestroy: jest.fn(),
      }),
    );

    // Should not throw
    await registry.onApplicationShutdown();
  });

  it('should propagate onReady errors', async () => {
    registry.register(
      makePlugin('fail-ready', {
        onReady: () => {
          throw new Error('ready error');
        },
      }),
    );

    await expect(registry.onApplicationBootstrap()).rejects.toThrow(
      'ready error',
    );
  });
});
