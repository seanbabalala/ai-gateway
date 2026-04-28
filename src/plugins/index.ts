// ===================================================================
// Plugin System — Barrel Exports
// ===================================================================

// Types
export type {
  GatewayPlugin,
  PluginMeta,
  PipelineHooks,
  HookContext,
  HookResult,
  PluginLogger,
  PreRequestData,
  PostScoringData,
  PreUpstreamData,
  PostUpstreamData,
  PreResponseData,
  StreamEventData,
  OnErrorData,
  ShortCircuitResult,
  DropResult,
  RecoverResult,
  DimensionRegistration,
  EventSubscription,
  PluginConfigEntry,
} from './types';

// Services
export { PluginRegistryService } from './plugin-registry.service';
export { HookExecutorService } from './hook-executor.service';
export { EventBusService } from './event-bus.service';
export { PluginLoaderService } from './plugin-loader.service';

// Module
export { PluginModule } from './plugin.module';

// Testing
export { createNoOpHookExecutor, createNoOpPluginRegistry } from './testing';
