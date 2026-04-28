// ===================================================================
// Plugin System — Type Definitions
// ===================================================================
// Interfaces for the gateway plugin system. Plugins implement
// GatewayPlugin to hook into the request pipeline, register custom
// scoring dimensions, and subscribe to gateway events.
// ===================================================================

import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, Tier } from '../canonical/canonical.types';
import type { GatewayConfig } from '../config/gateway.config';

// ===== Plugin Interface =====

export interface GatewayPlugin {
  /** Plugin metadata — name must be unique across all plugins */
  meta: PluginMeta;

  /** Called once after the plugin is loaded, before registration. Receives validated config. */
  onLoad?(config: Readonly<Record<string, unknown>>): Promise<void> | void;

  /** Called after all plugins are registered and the application is bootstrapped. */
  onReady?(): Promise<void> | void;

  /** Called on application shutdown (reverse order of registration). */
  onDestroy?(): Promise<void> | void;

  /** Pipeline hooks — partial, only implement what you need */
  hooks?: Partial<PipelineHooks>;

  /** Custom scoring dimensions to merge into the scoring engine */
  scoringDimensions?: DimensionRegistration[];

  /** Event subscriptions — subscribe to gateway events (log, config.reload, etc.) */
  events?: EventSubscription[];
}

// ===== Plugin Metadata =====

export interface PluginMeta {
  /** Unique plugin identifier */
  name: string;
  /** Semver version string */
  version: string;
  /** Execution priority — lower runs first (default: 100) */
  priority?: number;
  /** JSON Schema for config validation (validated with ajv if available) */
  configSchema?: Record<string, unknown>;
}

// ===== Pipeline Hooks =====

export interface PipelineHooks {
  /** After normalize, before budget check. Can modify request or short-circuit. */
  preRequest: (ctx: HookContext<PreRequestData>) => Promise<HookResult<PreRequestData>> | HookResult<PreRequestData>;

  /** After scoring, before routing. Can modify tier/score for A/B testing or per-key overrides. */
  postScoring: (ctx: HookContext<PostScoringData>) => Promise<HookResult<PostScoringData>> | HookResult<PostScoringData>;

  /** After routing, before sending to provider. Can modify request body or short-circuit (guardrails). */
  preUpstream: (ctx: HookContext<PreUpstreamData>) => Promise<HookResult<PreUpstreamData>> | HookResult<PreUpstreamData>;

  /** After receiving provider response. Can modify response (PII filtering). */
  postUpstream: (ctx: HookContext<PostUpstreamData>) => Promise<HookResult<PostUpstreamData>> | HookResult<PostUpstreamData>;

  /** After denormalize, before returning to client. Can modify final output. */
  preResponse: (ctx: HookContext<PreResponseData>) => Promise<HookResult<PreResponseData>> | HookResult<PreResponseData>;

  /** Each SSE event flowing through. Can modify or drop individual events. */
  streamEvent: (ctx: HookContext<StreamEventData>) => Promise<HookResult<StreamEventData>> | HookResult<StreamEventData>;

  /** On any pipeline error. Can modify error or recover (swallow error, return fallback response). */
  onError: (ctx: HookContext<OnErrorData>) => Promise<HookResult<OnErrorData>> | HookResult<OnErrorData>;
}

// ===== Hook Data Types =====

export interface PreRequestData {
  request: CanonicalRequest;
}

export interface PostScoringData {
  request: CanonicalRequest;
  tier: Tier;
  score: number;
  dimensions: Record<string, number>;
}

export interface PreUpstreamData {
  request: CanonicalRequest;
  nodeId: string;
  model: string;
}

export interface PostUpstreamData {
  request: CanonicalRequest;
  response: CanonicalResponse;
}

export interface PreResponseData {
  request: CanonicalRequest;
  body: Record<string, unknown>;
}

export interface StreamEventData {
  request: CanonicalRequest;
  event: CanonicalStreamEvent;
}

export interface OnErrorData {
  request: CanonicalRequest;
  error: Error;
  phase: string;
}

// ===== Hook Context =====

export interface PluginLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface HookContext<T> {
  /** Current phase data (shallow-frozen for safety) */
  data: Readonly<T>;
  /** Per-request shared storage across all plugins */
  store: Map<string, unknown>;
  /** This plugin's validated configuration */
  pluginConfig: Readonly<Record<string, unknown>>;
  /** Gateway config snapshot (read-only) */
  gatewayConfig: Readonly<GatewayConfig>;
  /** Logger with plugin name prefix */
  log: PluginLogger;
}

// ===== Hook Return Types =====

/**
 * Hook return conventions:
 *  - void / null / undefined → no modification, continue
 *  - { unchanged: true }     → explicit no-op, continue
 *  - { request: ... }        → modify data field(s), waterfall to next plugin
 *  - { shortCircuit: ... }   → skip remaining pipeline, return response (preRequest/preUpstream only)
 *  - { drop: true }          → discard current stream event (streamEvent only)
 *  - { recover: ... }        → swallow error and return fallback response (onError only)
 */
export type HookResult<T> =
  | void
  | null
  | undefined
  | { unchanged: true }
  | Partial<T>
  | ShortCircuitResult
  | DropResult
  | RecoverResult;

export interface ShortCircuitResult {
  shortCircuit: CanonicalResponse;
}

export interface DropResult {
  drop: true;
}

export interface RecoverResult {
  recover: CanonicalResponse;
}

// ===== Scoring Dimension Registration =====

export interface DimensionRegistration {
  /** Dimension name (must not conflict with built-in dimensions) */
  name: string;
  /** Default weight (will be overridden by config if user specifies) */
  defaultWeight: number;
  /** Scorer function — returns [-1, 1] */
  scorer: (req: CanonicalRequest) => number;
}

// ===== Event Subscription =====

export interface EventSubscription {
  /** Event topic: 'log', 'config.reload', 'circuit.open', etc. */
  event: string;
  /** Handler — async is allowed, errors are caught and logged */
  handler: (payload: unknown) => void | Promise<void>;
}

// ===== Plugin Config Entry (for gateway.config.yaml) =====

export interface PluginConfigEntry {
  /** Relative path to plugin file/directory, or npm package name */
  path: string;
  /** Plugin-specific configuration passed to onLoad() */
  config?: Record<string, unknown>;
  /** If true (default), loading failure prevents gateway startup */
  required?: boolean;
}
