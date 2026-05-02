/**
 * PluginLoaderService unit tests.
 *
 * Overrides require() for dynamic plugin loading by mocking the
 * private loadSinglePlugin method or using jest.spyOn on fs.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { PluginLoaderService } from "../../src/plugins/plugin-loader.service";
import { PluginRegistryService } from "../../src/plugins/plugin-registry.service";
import { EventBusService } from "../../src/plugins/event-bus.service";
import type { GatewayPlugin } from "../../src/plugins/types";

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
  meta = { name: "test-plugin", version: "1.0.0" };
  onLoad = jest.fn();
}

// ── Tests ───────────────────────────────────────────────────

describe("PluginLoaderService", () => {
  let existsSyncSpy: jest.SpyInstance;
  let readdirSyncSpy: jest.SpyInstance;

  beforeEach(() => {
    existsSyncSpy = jest.spyOn(fs, "existsSync");
    readdirSyncSpy = jest.spyOn(fs, "readdirSync");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Empty directory ───────────────────────────────────────

  it("should load zero plugins when plugins/ directory does not exist", async () => {
    existsSyncSpy.mockReturnValue(false);

    const { loader, registry } = makeLoader();
    await loader.onModuleInit();

    expect(registry.hasPlugins()).toBe(false);
  });

  it("should load zero plugins when plugins/ is empty", async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([]);

    const { loader, registry } = makeLoader();
    await loader.onModuleInit();

    expect(registry.hasPlugins()).toBe(false);
  });

  // ── File discovery ────────────────────────────────────────

  it("should discover .ts files and load them", async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([
      { name: "hello.ts", isFile: () => true, isDirectory: () => false },
    ]);

    // Spy on require to intercept plugin loading
    const requireSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    requireSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader();
    await loader.onModuleInit();

    expect(requireSpy).toHaveBeenCalledTimes(1);
    const callArg = requireSpy.mock.calls[0][0] as any;
    expect(callArg.path).toContain("hello.ts");
  });

  it("should discover directories with index.ts", async () => {
    existsSyncSpy.mockImplementation((p: unknown) => {
      if (String(p).endsWith("plugins")) return true;
      if (String(p).endsWith("index.ts")) return true;
      return false;
    });
    readdirSyncSpy.mockReturnValue([
      { name: "my-plugin", isFile: () => false, isDirectory: () => true },
    ]);

    const requireSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    requireSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader();
    await loader.onModuleInit();

    expect(requireSpy).toHaveBeenCalledTimes(1);
    const callArg = requireSpy.mock.calls[0][0] as any;
    expect(callArg.path).toContain("index.ts");
  });

  it("should skip .d.ts and .spec.ts files", async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([
      { name: "types.d.ts", isFile: () => true, isDirectory: () => false },
      { name: "plugin.spec.ts", isFile: () => true, isDirectory: () => false },
    ]);

    const { loader, registry } = makeLoader();
    await loader.onModuleInit();

    expect(registry.hasPlugins()).toBe(false);
  });

  // ── YAML plugins ──────────────────────────────────────────

  it("should load plugins declared in YAML config", async () => {
    existsSyncSpy.mockReturnValue(false); // No plugins/ directory

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: "my-custom-plugin.ts", config: { key: "val" } }],
      },
    });
    await loader.onModuleInit();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy.mock.calls[0][0]).toEqual({
      path: "my-custom-plugin.ts",
      config: { key: "val" },
    });
  });

  it("should load plugins declared in plugins.config.yaml", async () => {
    existsSyncSpy.mockImplementation((p: unknown) =>
      String(p).endsWith("plugins.config.yaml"),
    );
    jest.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      if (String(p).endsWith("plugins.config.yaml")) {
        return 'plugins:\n  - path: "@siftgate/plugin-guardrails"\n    required: false\n';
      }
      return "";
    });

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader();
    await loader.onModuleInit();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy.mock.calls[0][0]).toEqual({
      path: "@siftgate/plugin-guardrails",
      required: false,
    });
  });

  it("should merge YAML and directory entries (YAML takes priority)", async () => {
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReturnValue([
      { name: "shared.ts", isFile: () => true, isDirectory: () => false },
    ]);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockResolvedValue(undefined);

    const sharedPath = path.resolve(process.cwd(), "plugins", "shared.ts");
    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: sharedPath, config: { from: "yaml" } }],
      },
    });
    await loader.onModuleInit();

    // Should only load once (YAML takes priority, directory duplicate is skipped)
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("should deduplicate YAML directory paths against discovered index.ts files", async () => {
    const pluginIndex = path.resolve(
      process.cwd(),
      "plugins",
      "redis-cache",
      "index.ts",
    );
    existsSyncSpy.mockImplementation((p: unknown) => {
      const value = String(p);
      return value.endsWith("plugins") || value === pluginIndex;
    });
    readdirSyncSpy.mockReturnValue([
      { name: "redis-cache", isFile: () => false, isDirectory: () => true },
    ]);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockResolvedValue(undefined);

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: "plugins/redis-cache", config: { enabled: false } }],
      },
    });
    await loader.onModuleInit();

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy.mock.calls[0][0]).toEqual({
      path: "plugins/redis-cache",
      config: { enabled: false },
    });
  });

  // ── required: false ───────────────────────────────────────

  it("should skip optional plugins that fail to load", async () => {
    existsSyncSpy.mockReturnValue(false);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockRejectedValue(new Error("Cannot find module"));

    const { loader, registry } = makeLoader({
      fullConfig: {
        plugins: [{ path: "nonexistent-plugin.ts", required: false }],
      },
    });

    // Should not throw
    await loader.onModuleInit();
    expect(registry.hasPlugins()).toBe(false);
  });

  it("should throw for required plugins that fail to load", async () => {
    existsSyncSpy.mockReturnValue(false);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockRejectedValue(new Error("Cannot find module"));

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: "nonexistent-plugin.ts", required: true }],
      },
    });

    await expect(loader.onModuleInit()).rejects.toThrow("Cannot find module");
  });

  it("should default required to true", async () => {
    existsSyncSpy.mockReturnValue(false);

    const loadSpy = jest.spyOn(
      PluginLoaderService.prototype as any,
      "loadSinglePlugin",
    );
    loadSpy.mockRejectedValue(new Error("Cannot find module"));

    const { loader } = makeLoader({
      fullConfig: {
        plugins: [{ path: "missing.ts" }], // no required field → default true
      },
    });

    await expect(loader.onModuleInit()).rejects.toThrow("Cannot find module");
  });

  it("should resolve source plugin paths to compiled runtime files in production mode", () => {
    const { loader } = makeLoader();
    jest.spyOn(loader as any, "isCompiledRuntime").mockReturnValue(true);

    const compiledIndex = path.resolve(
      process.cwd(),
      "dist-runtime-plugins/plugins/pii-filter/index.js",
    );
    existsSyncSpy.mockImplementation(
      (p: unknown) => String(p) === compiledIndex,
    );

    const resolved = (loader as any).resolvePluginPath("plugins/pii-filter");
    expect(resolved).toBe(compiledIndex);
  });

  it("should resolve npm package plugin declarations through node_modules", () => {
    existsSyncSpy.mockRestore();
    readdirSyncSpy.mockRestore();
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "siftgate-plugin-loader-"),
    );
    const packageDir = path.join(
      tmp,
      "node_modules",
      "@siftgate",
      "plugin-guardrails",
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@siftgate/plugin-guardrails",
        version: "1.0.0",
        main: "index.js",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(packageDir, "index.js"),
      "module.exports = class {};\n",
      "utf8",
    );

    try {
      process.chdir(tmp);
      const { loader } = makeLoader();
      const resolved = (loader as any).resolvePluginPath(
        "@siftgate/plugin-guardrails",
      );
      expect(fs.realpathSync(resolved)).toBe(
        fs.realpathSync(path.join(packageDir, "index.js")),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should resolve source plugin directories to index.ts in development mode", () => {
    const { loader } = makeLoader();
    jest.spyOn(loader as any, "isCompiledRuntime").mockReturnValue(false);

    const sourceIndex = path.resolve(
      process.cwd(),
      "plugins/redis-cache/index.ts",
    );
    existsSyncSpy.mockImplementation((p: unknown) => String(p) === sourceIndex);

    const resolved = (loader as any).resolvePluginPath("plugins/redis-cache");
    expect(resolved).toBe(sourceIndex);
  });
});
