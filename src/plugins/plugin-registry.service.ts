// ===================================================================
// PluginRegistryService — Plugin registration, hook chain management
// ===================================================================
// Stores plugin instances, maintains sorted hook chains, manages
// plugin lifecycle (onReady / onDestroy).
// ===================================================================

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type {
  GatewayPlugin,
  PipelineHooks,
  DimensionRegistration,
} from './types';

interface RegisteredPlugin {
  instance: GatewayPlugin;
  config: Record<string, unknown>;
}

interface HookChainLink {
  priority: number;
  fn: PipelineHooks[keyof PipelineHooks];
  pluginName: string;
}

@Injectable()
export class PluginRegistryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PluginRegistryService.name);

  private readonly plugins: RegisteredPlugin[] = [];
  private readonly hookChains = new Map<string, HookChainLink[]>();
  private readonly dimensions: DimensionRegistration[] = [];

  // ── Registration ──────────────────────────────────────────

  register(plugin: GatewayPlugin, config: Record<string, unknown> = {}): void {
    const name = plugin.meta.name;
    const priority = plugin.meta.priority ?? 100;

    // Check for duplicate names
    if (this.plugins.some((p) => p.instance.meta.name === name)) {
      throw new Error(`Plugin "${name}" is already registered`);
    }

    this.plugins.push({ instance: plugin, config });

    // Register hooks
    if (plugin.hooks) {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        if (typeof hookFn !== 'function') continue;
        if (!this.hookChains.has(hookName)) {
          this.hookChains.set(hookName, []);
        }
        this.hookChains
          .get(hookName)!
          .push({ priority, fn: hookFn, pluginName: name });
      }
    }

    // Sort all hook chains by priority (lower = first)
    for (const chain of this.hookChains.values()) {
      chain.sort((a, b) => a.priority - b.priority);
    }

    // Register scoring dimensions
    if (plugin.scoringDimensions) {
      this.dimensions.push(...plugin.scoringDimensions);
    }

    this.logger.log(
      `Registered plugin "${name}" v${plugin.meta.version} (priority: ${priority})`,
    );
  }

  // ── Queries ───────────────────────────────────────────────

  getHookChain(hookName: string): HookChainLink[] {
    return this.hookChains.get(hookName) || [];
  }

  getDimensions(): DimensionRegistration[] {
    return this.dimensions;
  }

  hasPlugins(): boolean {
    return this.plugins.length > 0;
  }

  getPluginConfig(pluginName: string): Readonly<Record<string, unknown>> {
    const entry = this.plugins.find(
      (p) => p.instance.meta.name === pluginName,
    );
    return entry?.config ?? {};
  }

  getRegisteredPlugins(): ReadonlyArray<{
    name: string;
    version: string;
    priority: number;
  }> {
    return this.plugins.map((p) => ({
      name: p.instance.meta.name,
      version: p.instance.meta.version,
      priority: p.instance.meta.priority ?? 100,
    }));
  }

  getPluginStatus(pluginName: string): unknown {
    const entry = this.plugins.find(
      (p) => p.instance.meta.name === pluginName,
    );
    if (!entry?.instance.getStatus) return null;
    return entry.instance.getStatus();
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async onApplicationBootstrap(): Promise<void> {
    for (const { instance } of this.plugins) {
      if (instance.onReady) {
        try {
          await instance.onReady();
          this.logger.log(`Plugin "${instance.meta.name}" ready`);
        } catch (err) {
          this.logger.error(
            `Plugin "${instance.meta.name}" onReady failed: ${(err as Error).message}`,
          );
          throw err;
        }
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Reverse order for shutdown
    const reversed = [...this.plugins].reverse();
    for (const { instance } of reversed) {
      if (instance.onDestroy) {
        try {
          await instance.onDestroy();
          this.logger.log(`Plugin "${instance.meta.name}" destroyed`);
        } catch (err) {
          // Log but don't rethrow — ensure all plugins get a chance to clean up
          this.logger.error(
            `Plugin "${instance.meta.name}" onDestroy failed: ${(err as Error).message}`,
          );
        }
      }
    }
  }
}
