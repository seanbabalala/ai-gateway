import type { GatewayConfig, NodeConfig } from './gateway.config';

export type ConfigDiagnosticSeverity = 'warning';

export type ConfigDiagnosticCode =
  | 'duplicate_model_id'
  | 'model_id_matches_node_id'
  | 'alias_conflicts_with_model_id'
  | 'alias_matches_node_id'
  | 'duplicate_alias'
  | 'duplicate_model_prefix'
  | 'missing_model_pricing'
  | 'route_references_unknown_node'
  | 'route_references_unknown_model'
  | 'split_overrides_targets';

export interface ConfigDiagnostic {
  severity: ConfigDiagnosticSeverity;
  code: ConfigDiagnosticCode;
  message: string;
  nodes: string[];
  model?: string;
  alias?: string;
  matchingNodes?: string[];
  tier?: string;
  target?: string;
}

type PartialGatewayConfig = Partial<GatewayConfig>;
type PartialNodeConfig = Partial<NodeConfig> & Record<string, unknown>;
type RouteTargetLike = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function nodeModelIds(node: PartialNodeConfig | undefined): string[] {
  if (!node) return [];
  return [
    ...stringArray(node.models),
    ...stringArray(node.embedding_models),
    ...stringArray(node.rerank_models),
    ...stringArray(node.image_models),
    ...stringArray(node.audio_models),
    ...stringArray(node.video_models),
    ...stringArray(node.realtime_models),
  ];
}

function nodesFromConfig(config: PartialGatewayConfig): PartialNodeConfig[] {
  return Array.isArray(config.nodes)
    ? (config.nodes.filter(isRecord) as PartialNodeConfig[])
    : [];
}

function routeTargetFrom(value: unknown): RouteTargetLike | null {
  return isRecord(value) ? value : null;
}

function hasTopLevelPricingFor(config: PartialGatewayConfig, model: string): boolean {
  const pricing = config.models_pricing as unknown;
  return (
    isRecord(pricing) && Object.prototype.hasOwnProperty.call(pricing, model)
  );
}

function hasNodeModelPricing(node: PartialNodeConfig | undefined, model: string): boolean {
  if (!node || !isRecord(node.model_capabilities)) return false;
  const modelCapability = node.model_capabilities[model];
  return isRecord(modelCapability) && isRecord(modelCapability.pricing);
}

/**
 * Build structured diagnostics for node/model naming, pricing, and route
 * references. The function is deliberately pure so ConfigService, Dashboard,
 * tests, and the CLI can all use the same rules.
 */
export function buildNodeModelDiagnostics(
  config: PartialGatewayConfig,
): ConfigDiagnostic[] {
  const nodes = nodesFromConfig(config);
  const modelOwners = new Map<string, string[]>();
  const aliasOwners = new Map<string, string[]>();
  const prefixOwners = new Map<string, string[]>();
  const nodeIds = new Set<string>();
  const nodeById = new Map<string, PartialNodeConfig>();
  const diagnostics: ConfigDiagnostic[] = [];

  for (const node of nodes) {
    if (!isNonEmptyString(node.id)) continue;

    nodeIds.add(node.id);
    nodeById.set(node.id, node);

    for (const model of stringArray(node.models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    for (const model of stringArray(node.embedding_models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    for (const model of stringArray(node.rerank_models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    for (const model of stringArray(node.image_models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    for (const model of stringArray(node.audio_models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    for (const model of stringArray(node.video_models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    for (const model of stringArray(node.realtime_models)) {
      const owners = modelOwners.get(model) || [];
      owners.push(node.id);
      modelOwners.set(model, owners);
    }

    if (isRecord(node.model_aliases)) {
      for (const alias of Object.keys(node.model_aliases)) {
        if (!isNonEmptyString(alias)) continue;
        const owners = aliasOwners.get(alias) || [];
        owners.push(node.id);
        aliasOwners.set(alias, owners);
      }
    }

    for (const prefix of [
      ...new Set([node.id, ...stringArray(node.model_prefixes)]),
    ]) {
      if (!isNonEmptyString(prefix)) continue;
      const owners = prefixOwners.get(prefix) || [];
      owners.push(node.id);
      prefixOwners.set(prefix, owners);
    }
  }

  for (const [model, owners] of modelOwners.entries()) {
    if (owners.length > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'duplicate_model_id',
        message: `Model id "${model}" is listed under multiple upstream nodes (${owners.join(', ')}). Direct requests for this model will route to the first matching node in config order.`,
        nodes: owners,
        model,
      });
    }
    if (nodeIds.has(model)) {
      diagnostics.push({
        severity: 'warning',
        code: 'model_id_matches_node_id',
        message: `Model id "${model}" is also a node id. Exact model matches take precedence over the node-id shortcut, which can make direct routing confusing.`,
        nodes: [...new Set([...owners, model])],
        model,
      });
    }
  }

  for (const [alias, owners] of aliasOwners.entries()) {
    const matchingModelOwners = modelOwners.get(alias);
    if (matchingModelOwners) {
      diagnostics.push({
        severity: 'warning',
        code: 'alias_conflicts_with_model_id',
        message: `Model alias "${alias}" on node(s) ${owners.join(', ')} conflicts with a real model id on node(s) ${matchingModelOwners.join(', ')}. Exact model ids win before aliases during direct routing.`,
        nodes: owners,
        alias,
        matchingNodes: matchingModelOwners,
      });
    }

    if (nodeIds.has(alias)) {
      diagnostics.push({
        severity: 'warning',
        code: 'alias_matches_node_id',
        message: `Model alias "${alias}" on node(s) ${owners.join(', ')} is also a node id. Aliases resolve before the node-id shortcut.`,
        nodes: [...new Set([...owners, alias])],
        alias,
      });
    }

    if (owners.length > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'duplicate_alias',
        message: `Model alias "${alias}" is defined on multiple upstream nodes (${owners.join(', ')}). Direct requests for this alias will route to the first matching alias in config order.`,
        nodes: owners,
        alias,
      });
    }
  }

  for (const [prefix, owners] of prefixOwners.entries()) {
    if (owners.length > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'duplicate_model_prefix',
        message: `Model prefix "${prefix}-*" is configured on multiple upstream nodes (${owners.join(', ')}). Direct pass-through routing will use the first matching node in config order.`,
        nodes: owners,
        alias: prefix,
      });
    }
  }

  for (const [model, owners] of modelOwners.entries()) {
    const ownersMissingPricing = owners.filter((owner) =>
      !hasTopLevelPricingFor(config, model) &&
      !hasNodeModelPricing(nodeById.get(owner), model),
    );
    if (ownersMissingPricing.length > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'missing_model_pricing',
        message: `Model "${model}" has no pricing entry. Requests can still route, but cost reporting for node(s) ${ownersMissingPricing.join(', ')} may be incomplete.`,
        nodes: ownersMissingPricing,
        model,
      });
    }
  }

  const addRouteTargetDiagnostics = (
    tier: string,
    target: RouteTargetLike | null,
    targetName: string,
  ) => {
    if (!target) return;
    const targetNode = target.node;
    const targetModel = target.model;
    if (!isNonEmptyString(targetNode) || !isNonEmptyString(targetModel)) {
      return;
    }

    const node = nodeById.get(targetNode);
    if (!node) {
      diagnostics.push({
        severity: 'warning',
        code: 'route_references_unknown_node',
        message: `Routing tier "${tier}" ${targetName} references unknown upstream node "${targetNode}".`,
        nodes: [targetNode],
        model: targetModel,
        tier,
        target: targetName,
      });
      return;
    }

    if (!nodeModelIds(node).includes(targetModel)) {
      diagnostics.push({
        severity: 'warning',
        code: 'route_references_unknown_model',
        message: `Routing tier "${tier}" ${targetName} references model "${targetModel}" that is not listed under upstream node "${targetNode}".`,
        nodes: [targetNode],
        model: targetModel,
        tier,
        target: targetName,
      });
    }
  };

  const routingValue = config.routing as unknown;
  const routing = isRecord(routingValue) ? routingValue : {};
  const tiersValue = routing.tiers;
  const tiers = isRecord(tiersValue) ? tiersValue : {};
  for (const [tier, tierConfig] of Object.entries(tiers)) {
    if (!isRecord(tierConfig)) continue;

    addRouteTargetDiagnostics(
      tier,
      routeTargetFrom(tierConfig.primary),
      'primary',
    );

    if (Array.isArray(tierConfig.fallbacks)) {
      tierConfig.fallbacks.forEach((fallback, idx) =>
        addRouteTargetDiagnostics(
          tier,
          routeTargetFrom(fallback),
          `fallback[${idx}]`,
        ),
      );
    }

    if (Array.isArray(tierConfig.split)) {
      tierConfig.split.forEach((variant, idx) =>
        addRouteTargetDiagnostics(
          tier,
          routeTargetFrom(variant),
          `split[${idx}]`,
        ),
      );
    }

    const targets = tierConfig.targets;
    if (Array.isArray(targets)) {
      targets.forEach((target, idx) =>
        addRouteTargetDiagnostics(
          tier,
          routeTargetFrom(target),
          `targets[${idx}]`,
        ),
      );
    }

    if (
      Array.isArray(tierConfig.split) &&
      tierConfig.split.length > 0 &&
      Array.isArray(targets) &&
      targets.length > 0
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'split_overrides_targets',
        message: `Routing tier "${tier}" defines both split and targets. Split is treated as experiment mode and overrides targets until split is removed.`,
        nodes: targets
          .map((target) => routeTargetFrom(target)?.node)
          .filter(isNonEmptyString),
        tier,
      });
    }
  }

  return diagnostics;
}
