// ===================================================================
// Plugin System — Testing Utilities
// ===================================================================
// Provides no-op mocks for HookExecutorService and PluginRegistryService
// so existing tests can pass without any plugin-related side effects.
// ===================================================================

import type { HookExecutorService, HookRunResult } from './hook-executor.service';
import type { PluginRegistryService } from './plugin-registry.service';

/**
 * Creates a no-op HookExecutorService mock.
 * isEmpty() returns true, run() passes data through unchanged.
 */
export function createNoOpHookExecutor(): HookExecutorService {
  return {
    isEmpty: () => true,
    run: async <T>(_hookName: string, data: T): Promise<HookRunResult<T>> => ({
      data,
    }),
  } as unknown as HookExecutorService;
}

/**
 * Creates a no-op PluginRegistryService mock.
 * hasPlugins() returns false, getDimensions() returns [].
 */
export function createNoOpPluginRegistry(): PluginRegistryService {
  return {
    hasPlugins: () => false,
    getDimensions: () => [],
    getHookChain: () => [],
    getPluginConfig: () => ({}),
    register: () => {},
    getRegisteredPlugins: () => [],
    onApplicationBootstrap: async () => {},
    onApplicationShutdown: async () => {},
  } as unknown as PluginRegistryService;
}
