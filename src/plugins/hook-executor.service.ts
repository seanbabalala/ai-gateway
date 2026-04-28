// ===================================================================
// HookExecutorService — Runs hook chains in waterfall mode
// ===================================================================
// Pure logic service. Iterates a hook chain, passing modified data
// from one plugin to the next. Supports short-circuit, drop, recover.
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import type {
  HookContext,
  HookResult,
  PluginLogger,
  ShortCircuitResult,
  DropResult,
  RecoverResult,
} from './types';
import type { GatewayConfig } from '../config/gateway.config';

export interface HookRunResult<T> {
  data: T;
  shortCircuit?: unknown;
}

@Injectable()
export class HookExecutorService {
  private readonly logger = new Logger(HookExecutorService.name);

  constructor(private readonly registry: PluginRegistryService) {}

  /** Fast check — if true, all hook calls can be skipped */
  isEmpty(): boolean {
    return !this.registry.hasPlugins();
  }

  /**
   * Run a hook chain in waterfall mode.
   *
   * @param hookName  - Which hook to run (e.g. 'preRequest')
   * @param data      - Initial data for the hook
   * @param store     - Per-request shared storage
   * @param gatewayConfig - Gateway config snapshot
   */
  async run<T extends Record<string, unknown>>(
    hookName: string,
    data: T,
    store: Map<string, unknown>,
    gatewayConfig: GatewayConfig,
  ): Promise<HookRunResult<T>> {
    const chain = this.registry.getHookChain(hookName);
    if (!chain.length) return { data };

    let current = data;

    for (const link of chain) {
      const pluginConfig = this.registry.getPluginConfig(link.pluginName);
      const log = this.createPluginLogger(link.pluginName);

      const ctx: HookContext<T> = {
        data: Object.freeze({ ...current }) as Readonly<T>,
        store,
        pluginConfig,
        gatewayConfig,
        log,
      };

      const result: HookResult<T> = await (link.fn as unknown as (ctx: HookContext<T>) => Promise<HookResult<T>>)(ctx);

      // void / null / undefined → no change
      if (result == null) continue;

      // { unchanged: true } → explicit no-op
      if (typeof result === 'object' && 'unchanged' in result && (result as { unchanged: boolean }).unchanged) {
        continue;
      }

      // { shortCircuit: ... } → stop pipeline
      if (typeof result === 'object' && 'shortCircuit' in result) {
        return {
          data: current,
          shortCircuit: (result as ShortCircuitResult).shortCircuit,
        };
      }

      // { recover: ... } → swallow error (onError hook)
      if (typeof result === 'object' && 'recover' in result) {
        return {
          data: current,
          shortCircuit: (result as RecoverResult).recover,
        };
      }

      // { drop: true } → drop stream event
      if (typeof result === 'object' && 'drop' in result && (result as DropResult).drop) {
        return {
          data: current,
          shortCircuit: { __drop: true },
        };
      }

      // Partial data modification → waterfall merge
      current = { ...current, ...(result as Partial<T>) };
    }

    return { data: current };
  }

  private createPluginLogger(pluginName: string): PluginLogger {
    return {
      log: (msg: string) => this.logger.log(`[${pluginName}] ${msg}`),
      warn: (msg: string) => this.logger.warn(`[${pluginName}] ${msg}`),
      error: (msg: string) => this.logger.error(`[${pluginName}] ${msg}`),
      debug: (msg: string) => this.logger.debug(`[${pluginName}] ${msg}`),
    };
  }
}
