// ===================================================================
// PluginLoaderService — Discovers and loads plugins at startup
// ===================================================================
// Scans the plugins/ directory and gateway.config.yaml for plugin
// declarations. Loads, validates, and registers each plugin.
// ===================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { PluginRegistryService } from './plugin-registry.service';
import { EventBusService } from './event-bus.service';
import { ConfigService } from '../config/config.service';
import type { GatewayPlugin, PluginConfigEntry } from './types';

@Injectable()
export class PluginLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadPlugins();
  }

  private async loadPlugins(): Promise<void> {
    // Merge YAML-declared plugins with directory discovery
    const yamlEntries = this.getYamlEntries();
    const discoveredEntries = this.discoverPluginDirectory();

    // YAML takes priority — merge and deduplicate by path
    const seen = new Set<string>();
    const allEntries: PluginConfigEntry[] = [];

    for (const entry of yamlEntries) {
      const resolved = this.resolvePluginPath(entry.path);
      seen.add(resolved);
      allEntries.push(entry);
    }

    for (const entry of discoveredEntries) {
      const resolved = this.resolvePluginPath(entry.path);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        allEntries.push(entry);
      }
    }

    if (allEntries.length === 0) {
      this.logger.log('No plugins found');
      return;
    }

    this.logger.log(`Found ${allEntries.length} plugin(s) to load`);

    for (const entry of allEntries) {
      try {
        await this.loadSinglePlugin(entry);
      } catch (err) {
        const required = entry.required !== false;
        if (required) {
          this.logger.error(
            `Failed to load required plugin "${entry.path}": ${(err as Error).message}`,
          );
          throw err;
        } else {
          this.logger.warn(
            `Skipping optional plugin "${entry.path}": ${(err as Error).message}`,
          );
        }
      }
    }
  }

  private async loadSinglePlugin(entry: PluginConfigEntry): Promise<void> {
    const resolvedPath = this.resolvePluginPath(entry.path);

    // require() the plugin module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(resolvedPath);
    const PluginClass = mod.default || mod;

    if (typeof PluginClass !== 'function') {
      throw new Error(
        `Plugin "${entry.path}" does not export a class (got ${typeof PluginClass})`,
      );
    }

    // Instantiate
    const instance: GatewayPlugin = new PluginClass();

    if (!instance.meta?.name) {
      throw new Error(`Plugin "${entry.path}" is missing meta.name`);
    }

    const config = entry.config || {};

    // Validate config against schema if declared
    if (instance.meta.configSchema) {
      this.validateConfig(instance.meta.name, config, instance.meta.configSchema);
    }

    // Call onLoad
    if (instance.onLoad) {
      await instance.onLoad(config);
    }

    // Register event subscriptions with the EventBus
    if (instance.events) {
      for (const sub of instance.events) {
        this.eventBus.on(sub.event, sub.handler);
      }
    }

    // Register with the registry
    this.registry.register(instance, config);
  }

  // ── Config Validation ─────────────────────────────────────

  private validateConfig(
    pluginName: string,
    config: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): void {
    try {
      // Use ajv if available (it's in node_modules)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Ajv = require('ajv');
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);
      if (!validate(config)) {
        const errors = validate.errors
          ?.map((e: { instancePath: string; message: string }) =>
            `${e.instancePath || '/'} ${e.message}`,
          )
          .join('; ');
        throw new Error(
          `Config validation failed for plugin "${pluginName}": ${errors}`,
        );
      }
    } catch (err) {
      // If ajv import fails, skip validation with a warning
      if ((err as Error).message?.includes('Cannot find module')) {
        this.logger.warn(
          `Skipping config validation for plugin "${pluginName}" (ajv not available)`,
        );
        return;
      }
      throw err;
    }
  }

  // ── Directory Discovery ───────────────────────────────────

  private discoverPluginDirectory(): PluginConfigEntry[] {
    const pluginsDir = path.resolve(process.cwd(), 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const entries: PluginConfigEntry[] = [];

    const items = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile()) {
        // .ts or .js files (skip .d.ts, .map, .spec)
        if (
          (item.name.endsWith('.ts') || item.name.endsWith('.js')) &&
          !item.name.endsWith('.d.ts') &&
          !item.name.endsWith('.spec.ts') &&
          !item.name.endsWith('.spec.js') &&
          !item.name.endsWith('.map')
        ) {
          entries.push({ path: path.join(pluginsDir, item.name) });
        }
      } else if (item.isDirectory()) {
        // Directories with index.ts or index.js
        const indexTs = path.join(pluginsDir, item.name, 'index.ts');
        const indexJs = path.join(pluginsDir, item.name, 'index.js');
        if (fs.existsSync(indexTs)) {
          entries.push({ path: indexTs });
        } else if (fs.existsSync(indexJs)) {
          entries.push({ path: indexJs });
        }
      }
    }

    return entries;
  }

  // ── YAML Config ───────────────────────────────────────────

  private getYamlEntries(): PluginConfigEntry[] {
    const fullConfig = this.config.getFullConfig?.();
    if (!fullConfig) return [];
    const plugins = fullConfig.plugins;
    if (!Array.isArray(plugins)) return [];
    return plugins;
  }

  // ── Path Resolution ───────────────────────────────────────

  private resolvePluginPath(pluginPath: string): string {
    if (path.isAbsolute(pluginPath)) return pluginPath;
    // Relative paths are resolved from CWD
    return path.resolve(process.cwd(), pluginPath);
  }
}
