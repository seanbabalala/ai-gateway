/**
 * HookExecutorService unit tests.
 */

import { HookExecutorService } from '../../src/plugins/hook-executor.service';
import { PluginRegistryService } from '../../src/plugins/plugin-registry.service';
import type { GatewayPlugin, HookContext, PreRequestData } from '../../src/plugins/types';
import type { GatewayConfig } from '../../src/config/gateway.config';

function makePlugin(
  name: string,
  hooks: Record<string, Function>,
  priority = 100,
): GatewayPlugin {
  return {
    meta: { name, version: '1.0.0', priority },
    hooks: hooks as any,
  } as GatewayPlugin;
}

function makeGatewayConfig(): GatewayConfig {
  return {} as GatewayConfig;
}

describe('HookExecutorService', () => {
  let registry: PluginRegistryService;
  let executor: HookExecutorService;

  beforeEach(() => {
    registry = new PluginRegistryService();
    executor = new HookExecutorService(registry);
  });

  // ── isEmpty ───────────────────────────────────────────────

  it('should return isEmpty=true when no plugins registered', () => {
    expect(executor.isEmpty()).toBe(true);
  });

  it('should return isEmpty=false when plugins are registered', () => {
    registry.register(makePlugin('p1', {}));
    expect(executor.isEmpty()).toBe(false);
  });

  // ── Empty chain ───────────────────────────────────────────

  it('should return data unchanged for empty hook chain', async () => {
    const data = { request: { foo: 'bar' } };
    const result = await executor.run(
      'preRequest',
      data as any,
      new Map(),
      makeGatewayConfig(),
    );
    expect(result.data).toEqual(data);
    expect(result.shortCircuit).toBeUndefined();
  });

  // ── Single hook ───────────────────────────────────────────

  it('should pass data through a single modifying hook', async () => {
    registry.register(
      makePlugin('mod', {
        preRequest: (ctx: HookContext<PreRequestData>) => ({
          request: { ...ctx.data.request, modified: true },
        }),
      }),
    );

    const data = { request: { original: true } };
    const result = await executor.run(
      'preRequest',
      data as any,
      new Map(),
      makeGatewayConfig(),
    );

    expect((result.data as any).request.modified).toBe(true);
    expect((result.data as any).request.original).toBe(true);
  });

  // ── Waterfall ─────────────────────────────────────────────

  it('should chain multiple hooks in waterfall mode', async () => {
    registry.register(
      makePlugin(
        'p1',
        {
          preRequest: () => ({ request: { step: 1 } }),
        },
        10,
      ),
    );
    registry.register(
      makePlugin(
        'p2',
        {
          preRequest: (ctx: any) => ({
            request: { ...ctx.data.request, step2: true },
          }),
        },
        20,
      ),
    );

    const result = await executor.run(
      'preRequest',
      { request: {} } as any,
      new Map(),
      makeGatewayConfig(),
    );

    expect((result.data as any).request.step).toBe(1);
    expect((result.data as any).request.step2).toBe(true);
  });

  // ── void / null / undefined → no modification ────────────

  it('should skip hooks that return void', async () => {
    registry.register(
      makePlugin('void-hook', {
        preRequest: () => undefined,
      }),
    );

    const data = { request: { original: true } };
    const result = await executor.run(
      'preRequest',
      data as any,
      new Map(),
      makeGatewayConfig(),
    );
    expect(result.data).toEqual(data);
  });

  it('should skip hooks that return null', async () => {
    registry.register(
      makePlugin('null-hook', {
        preRequest: () => null,
      }),
    );

    const data = { request: { original: true } };
    const result = await executor.run(
      'preRequest',
      data as any,
      new Map(),
      makeGatewayConfig(),
    );
    expect(result.data).toEqual(data);
  });

  // ── { unchanged: true } → explicit no-op ─────────────────

  it('should skip hooks that return { unchanged: true }', async () => {
    registry.register(
      makePlugin('unchanged', {
        preRequest: () => ({ unchanged: true }),
      }),
    );

    const data = { request: { original: true } };
    const result = await executor.run(
      'preRequest',
      data as any,
      new Map(),
      makeGatewayConfig(),
    );
    expect(result.data).toEqual(data);
  });

  // ── shortCircuit ──────────────────────────────────────────

  it('should return shortCircuit and stop processing', async () => {
    const scResponse = { id: 'sc-1', content: [] };
    registry.register(
      makePlugin(
        'circuit',
        {
          preRequest: () => ({ shortCircuit: scResponse }),
        },
        10,
      ),
    );
    const afterHook = jest.fn(() => ({ request: { neverReached: true } }));
    registry.register(
      makePlugin('after', { preRequest: afterHook }, 20),
    );

    const result = await executor.run(
      'preRequest',
      { request: {} } as any,
      new Map(),
      makeGatewayConfig(),
    );

    expect(result.shortCircuit).toEqual(scResponse);
    expect(afterHook).not.toHaveBeenCalled();
  });

  // ── drop ──────────────────────────────────────────────────

  it('should return drop signal for streamEvent hooks', async () => {
    registry.register(
      makePlugin('dropper', {
        streamEvent: () => ({ drop: true }),
      }),
    );

    const result = await executor.run(
      'streamEvent',
      { event: { type: 'delta' } } as any,
      new Map(),
      makeGatewayConfig(),
    );

    expect((result.shortCircuit as any).__drop).toBe(true);
  });

  // ── recover ───────────────────────────────────────────────

  it('should return recover signal for onError hooks', async () => {
    const fallbackResponse = { id: 'recovered', content: [] };
    registry.register(
      makePlugin('recoverer', {
        onError: () => ({ recover: fallbackResponse }),
      }),
    );

    const result = await executor.run(
      'onError',
      { error: new Error('test'), phase: 'preRequest' } as any,
      new Map(),
      makeGatewayConfig(),
    );

    expect(result.shortCircuit).toEqual(fallbackResponse);
  });

  // ── Hook exceptions propagate ─────────────────────────────

  it('should propagate hook exceptions', async () => {
    registry.register(
      makePlugin('thrower', {
        preRequest: () => {
          throw new Error('hook error');
        },
      }),
    );

    await expect(
      executor.run(
        'preRequest',
        { request: {} } as any,
        new Map(),
        makeGatewayConfig(),
      ),
    ).rejects.toThrow('hook error');
  });

  // ── Context ───────────────────────────────────────────────

  it('should provide correct context to hooks', async () => {
    let capturedCtx: any = null;
    registry.register(makePlugin('ctx-check', {
      preRequest: (ctx: any) => {
        capturedCtx = ctx;
        return undefined;
      },
    }), { myConfig: true });

    const store = new Map([['key', 'val']]);
    const gatewayConfig = { server: { port: 3000 } } as any;

    await executor.run(
      'preRequest',
      { request: { test: true } } as any,
      store,
      gatewayConfig,
    );

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx.data.request.test).toBe(true);
    expect(capturedCtx.store).toBe(store);
    expect(capturedCtx.pluginConfig).toEqual({ myConfig: true });
    expect(capturedCtx.gatewayConfig).toBe(gatewayConfig);
    expect(capturedCtx.log).toBeDefined();
    expect(typeof capturedCtx.log.log).toBe('function');
    expect(typeof capturedCtx.log.warn).toBe('function');
    expect(typeof capturedCtx.log.error).toBe('function');
    expect(typeof capturedCtx.log.debug).toBe('function');
  });

  // ── Async hooks ───────────────────────────────────────────

  it('should handle async hooks', async () => {
    registry.register(
      makePlugin('async-mod', {
        preRequest: async () => {
          await new Promise((r) => setTimeout(r, 1));
          return { request: { async: true } };
        },
      }),
    );

    const result = await executor.run(
      'preRequest',
      { request: {} } as any,
      new Map(),
      makeGatewayConfig(),
    );

    expect((result.data as any).request.async).toBe(true);
  });
});
