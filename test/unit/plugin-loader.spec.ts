/**
 * PluginLoaderService unit tests.
 *
 * Overrides require() for dynamic plugin loading by mocking the
 * private loadSinglePlugin method or using jest.spyOn on fs.
 */

import * as path from 'path';
import * as fs from 'fs';
import { PluginLoaderService } from '../../src/plugins/plugin-loader.service';
import { PluginRegistryService } from '../../src/plugins/plugin-registry.service';
import { EventBusService } from '../../src/plugins/event-bus.service';
import type { GatewayPlugin } from '../../src/plugins/types';

// ── Helpers ─────────────────────────────────────────────────

function makeLoader(overrides: Record<string, any> = {}): {
  loader: PluginLoaderService;
  registry: PluginRegistryService;
  eventBus: EventBusService;
} {
  const registry = new PluginRegistryService();
  const eventBus = new EventBusService();
  const config = {
    getFullConfig: jest.fn().mockReturnValue(overrides.fullConfig || {}),
    ...overrides.config,
  };

  const loader = new PluginLoaderService(registry, eventBus, config as any);
  return { loader, registry, eventBus };
}

class TestPlugin implements GatewayPlugin {
  meta = { name: 'test-plugin', version: '1.0.0' };
  onLoad = jest.fn();
}

// ── Tests ───────────────────────────────────────────────────

describe('PluginLoaderService', () => {
  let existsSyncSpy: jest.SpyInstance;
  let readdirSyncSpy: jest.SpyInstance;

  beforeEach(() => {
    existsSyncSpy = jest.spyOn(fs, 'existsSync');
    readdirSyncSpy = jest.spyOn(fs, 'readdirSync');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Empty directory ───────────────────────────────────────

  it('should load zero plugins when plugins/ directory does not exist', async () => {
    existsSyncSpy.mockReturnValue(false);

    const { loader, registry } = makeLoader();
    await loader.onModuleInit();

    expect(registry.hasPlugins()).toBe(false);
  });

  it('should load zero plugins when plugins/ is empty', async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([]);

    const { loader, registry } = makeLoader();
    await loader.onModuleInit();

    expect(registry.hasPlugins()).toBe(false);
  });

  // ── File discovery ────────────────────────────────────────

  it('should discover .ts files and load them', async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([
      { name: 'hello.ts', isFile: () => true, isDirectory: () => false },
    ]);

    // Spy on require to intercept plugin loading
    const requireSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    requireSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader();
    await loader.onModuleInit();

    expect(requireSpy).toHaveBeenCalledTimes(1);
    const callArg = requireSpy.mock.calls[0][0] as any;
    expect(callArg.path).toContain('hello.ts');
  });

  it('should discover directories with index.ts', async () => {
    existsSyncSpy.mockImplementation((p: unknown) => {
      if (String(p).endsWith('plugins')) return true;
      if (String(p).endsWith('index.ts')) return true;
      return false;
    });
    readdirSyncSpy.mockReturnValue([
      { name: 'my-plugin', isFile: () => false, isDirectory: () => true },
    ]);

    const requireSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    requireSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader();
    await loader.onModuleInit();

    expect(requireSpy).toHaveBeenCalledTimes(1);
    const callArg = requireSpy.mock.calls[0][0] as any;
    expect(callArg.path).toContain('index.ts');
  });

  it('should skip .d.ts and .spec.ts files', async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([
      { name: 'types.d.ts', isFile: () => true, isDirectory: () => false },
      { name: 'plugin.spec.ts', isFile: () => true, isDirectory: () => false },
    ]);

    const { loader, registry } = makeLoader();
    await loader.onModuleInit();

    expect(registry.hasPlugins()).toBe(false);
  });

  // ── YAML plugins ──────────────────────────────────────────

  it('should load plugins declared in YAML config', async () => {
    existsSyncSpy.mockReturnValue(false); // No plugins/ directory

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    loadSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: 'my-custom-plugin.ts', config: { key: 'val' } }],
      },
    });
    await loader.onModuleInit();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy.mock.calls[0][0]).toEqual({
      path: 'my-custom-plugin.ts',
      config: { key: 'val' },
    });
  });

  it('should merge YAML and directory entries (YAML takes priority)', async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([
      { name: 'shared.ts', isFile: () => true, isDirectory: () => false },
    ]);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    loadSpy.mockResolvedValue(undefined);

    const sharedPath = path.resolve(process.cwd(), 'plugins', 'shared.ts');
    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: sharedPath, config: { from: 'yaml' } }],
      },
    });
    await loader.onModuleInit();

    // Should only load once (YAML takes priority, directory duplicate is skipped)
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  // ── required: false ───────────────────────────────────────

  it('should skip optional plugins that fail to load', async () => {
    existsSyncSpy.mockReturnValue(false);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    loadSpy.mockRejectedValue(new Error('Cannot find module'));

    const { loader, registry } = makeLoader({
      fullConfig: {
        plugins: [
          { path: 'nonexistent-plugin.ts', required: false },
        ],
      },
    });

    // Should not throw
    await loader.onModuleInit();
    expect(registry.hasPlugins()).toBe(false);
  });

  it('should throw for required plugins that fail to load', async () => {
    existsSyncSpy.mockReturnValue(false);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    loadSpy.mockRejectedValue(new Error('Cannot find module'));

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [
          { path: 'nonexistent-plugin.ts', required: true },
        ],
      },
    });

    await expect(loader.onModuleInit()).rejects.toThrow('Cannot find module');
  });

  it('should default required to true', async () => {
    existsSyncSpy.mockReturnValue(false);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      'loadSinglePlugin',
    );
    loadSpy.mockRejectedValue(new Error('Cannot find module'));

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: 'missing.ts' }], // no required field → default true
      },
    });

    await expect(loader.onModuleInit()).rejects.toThrow('Cannot find module');
  });
});
