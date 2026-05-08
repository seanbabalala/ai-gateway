import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import {
  AgentProfile,
  AGENT_PROFILE_BASE_URL_MODES,
  AGENT_PROFILE_CONNECTORS,
  AGENT_PROFILE_STATUSES,
  AgentProfileBaseUrlMode,
  AgentProfileConnector,
  AgentProfileStatus,
} from '../database/entities/agent-profile.entity';
import {
  GatewayApiKeyService,
  GatewayApiKeySummary,
} from '../auth/gateway-api-key.service';
import {
  CreateAgentProfileDto,
  RenderAgentProfileDto,
  UpdateAgentProfileDto,
} from './dto/agent-profile.dto';

export const CLAUDE_AGENT_SMART_MODEL_ID = 'claude-siftgate-auto';

const ANTHROPIC_SMART_CONNECTORS = new Set<AgentProfileConnector>([
  'claude_code',
  'generic_anthropic',
]);

export interface AgentProfileSummary {
  id: string;
  name: string;
  description: string | null;
  connector: AgentProfileConnector;
  status: AgentProfileStatus;
  api_key_id: string | null;
  api_key: AgentProfileGatewayKeySummary | null;
  namespace_id: string | null;
  namespace_name: string | null;
  default_model: string;
  smart_model_id: string;
  base_url_mode: AgentProfileBaseUrlMode;
  routing_hint: Record<string, unknown> | null;
  mcp_server_ids: string[];
  metadata: Record<string, unknown> | null;
  last_generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AgentProfileGatewayKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
  allow_auto: boolean;
  allow_direct: boolean;
  allowed_models: string[];
  namespace_id: string | null;
  namespace_name: string | null;
}

export interface AgentProfileRenderedConfig {
  connector: AgentProfileConnector;
  connector_label: string;
  profile_id: string;
  profile_name: string;
  status: AgentProfileStatus;
  base_url: string;
  base_url_mode: AgentProfileBaseUrlMode;
  smart_model_id: string;
  default_model: string;
  gateway_api_key: {
    placeholder: string;
    key_prefix: string | null;
    name: string | null;
    status: string | null;
  };
  secrets_redacted: true;
  routing_hint: Record<string, unknown> | null;
  mcp_server_ids: string[];
  cards: AgentProfileRenderedCard[];
}

export interface AgentProfileRenderedCard {
  id: string;
  title: string;
  protocol: 'openai' | 'anthropic' | 'root';
  fields: Record<string, string | string[] | Record<string, unknown> | null>;
  env: Record<string, string>;
  snippet: string;
  notes: string[];
}

export interface AgentVirtualModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: 'siftgate';
  description: string;
  agent_profile_id: string;
  agent_profile_name: string;
  agent_connector: AgentProfileConnector;
  agent_virtual_model: string;
  is_agent_profile_model: true;
}

export interface AgentVirtualModelMatch {
  profile: AgentProfileSummary;
  virtual_model: string;
  requested_model: string;
  internal_model: 'auto';
}

@Injectable()
export class AgentProfileService {
  constructor(
    private readonly config: ConfigService,
    private readonly gatewayApiKeys: GatewayApiKeyService,
    @InjectRepository(AgentProfile)
    private readonly profileRepo: Repository<AgentProfile>,
  ) {}

  async list(): Promise<AgentProfileSummary[]> {
    const profiles = await this.profileRepo.find({
      order: { created_at: 'DESC' },
    });
    return Promise.all(profiles.map((profile) => this.toSummary(profile)));
  }

  async create(dto: CreateAgentProfileDto): Promise<AgentProfileSummary> {
    const normalized = await this.normalizeCreateDto(dto);
    await this.assertUniqueName(normalized.name);
    const entity = this.profileRepo.create(normalized);
    const saved = await this.profileRepo.save(entity);
    return this.toSummary(saved);
  }

  async update(
    id: string,
    dto: UpdateAgentProfileDto,
  ): Promise<AgentProfileSummary> {
    const entity = await this.getById(id);
    const normalized = await this.normalizeUpdateDto(dto, entity);
    if (normalized.name && normalized.name !== entity.name) {
      await this.assertUniqueName(normalized.name, id);
    }
    Object.assign(entity, normalized);
    const saved = await this.profileRepo.save(entity);
    return this.toSummary(saved);
  }

  async remove(id: string): Promise<void> {
    const entity = await this.getById(id);
    await this.profileRepo.remove(entity);
  }

  async render(
    id: string,
    dto: RenderAgentProfileDto = {},
  ): Promise<AgentProfileRenderedConfig> {
    const entity = await this.getById(id);
    const summary = await this.toSummary(entity);
    entity.last_generated_at = new Date();
    const saved = await this.profileRepo.save(entity);
    summary.last_generated_at = saved.last_generated_at;
    return this.renderSummary(summary, dto.gateway_base_url);
  }

  async listVirtualModelsForApiKey(
    apiKeyId: string | undefined,
    permissions?: {
      allow_auto: boolean;
      allowed_models: string[];
    },
  ): Promise<AgentVirtualModel[]> {
    if (!apiKeyId || permissions?.allow_auto === false) return [];
    const profiles = await this.profileRepo.find({
      where: { status: 'active', api_key_id: apiKeyId },
      order: { created_at: 'DESC' },
    });
    const models: AgentVirtualModel[] = [];
    const seen = new Set<string>();
    for (const profile of profiles) {
      const summary = await this.toSummary(profile);
      if (!this.virtualModelAllowed(summary.smart_model_id, permissions)) {
        continue;
      }
      if (seen.has(summary.smart_model_id)) continue;
      seen.add(summary.smart_model_id);
      models.push({
        id: summary.smart_model_id,
        object: 'model',
        created: 0,
        owned_by: 'siftgate',
        description:
          'SiftGate Agent Profile smart routing model scoped to this Gateway API key.',
        agent_profile_id: summary.id,
        agent_profile_name: summary.name,
        agent_connector: summary.connector,
        agent_virtual_model: summary.smart_model_id,
        is_agent_profile_model: true,
      });
    }
    return models;
  }

  async hasActiveProfileForApiKey(apiKeyId: string | undefined): Promise<boolean> {
    if (!apiKeyId) return false;
    const count = await this.profileRepo.count({
      where: { status: 'active', api_key_id: apiKeyId },
    });
    return count > 0;
  }

  async matchVirtualModel(
    apiKeyId: string | undefined,
    requestedModel: string | undefined,
  ): Promise<AgentVirtualModelMatch | null> {
    const normalizedModel = (requestedModel || '').trim();
    if (!apiKeyId || !normalizedModel) return null;
    const profile = await this.profileRepo.findOne({
      where: {
        status: 'active',
        api_key_id: apiKeyId,
        smart_model_id: normalizedModel,
      },
      order: { updated_at: 'DESC' },
    });
    if (!profile) return null;
    const summary = await this.toSummary(profile);
    return {
      profile: summary,
      virtual_model: summary.smart_model_id,
      requested_model: normalizedModel,
      internal_model: 'auto',
    };
  }

  private async normalizeCreateDto(
    dto: CreateAgentProfileDto,
  ): Promise<Partial<AgentProfile> & { name: string; connector: AgentProfileConnector }> {
    const connector = this.normalizeConnector(dto.connector);
    const baseUrlMode = this.normalizeBaseUrlMode(
      dto.base_url_mode,
      connector,
    );
    return {
      name: this.normalizeName(dto.name),
      description: this.normalizeNullableString(dto.description),
      connector,
      status: this.normalizeStatus(dto.status || 'active'),
      api_key_id: await this.normalizeApiKeyId(dto.api_key_id),
      namespace_id: this.normalizeNamespaceId(dto.namespace_id),
      default_model: this.normalizeModelId(dto.default_model, 'auto'),
      smart_model_id: this.normalizeModelId(
        dto.smart_model_id,
        this.defaultSmartModelId(connector),
      ),
      base_url_mode: baseUrlMode,
      routing_hint: this.normalizeObject(dto.routing_hint, 'routing_hint'),
      mcp_server_ids: this.normalizeStringArray(dto.mcp_server_ids),
      metadata: this.normalizeObject(dto.metadata, 'metadata'),
    };
  }

  private async normalizeUpdateDto(
    dto: UpdateAgentProfileDto,
    current: AgentProfile,
  ): Promise<Partial<AgentProfile>> {
    const normalized: Partial<AgentProfile> = {};
    const connector =
      dto.connector !== undefined
        ? this.normalizeConnector(dto.connector)
        : current.connector;

    if (dto.name !== undefined) normalized.name = this.normalizeName(dto.name);
    if (dto.description !== undefined) {
      normalized.description = this.normalizeNullableString(dto.description);
    }
    if (dto.connector !== undefined) normalized.connector = connector;
    if (dto.status !== undefined) normalized.status = this.normalizeStatus(dto.status);
    if (dto.api_key_id !== undefined) {
      normalized.api_key_id = await this.normalizeApiKeyId(dto.api_key_id);
    }
    if (dto.namespace_id !== undefined) {
      normalized.namespace_id = this.normalizeNamespaceId(dto.namespace_id);
    }
    if (dto.default_model !== undefined) {
      normalized.default_model = this.normalizeModelId(dto.default_model, 'auto');
    }
    if (dto.smart_model_id !== undefined || dto.connector !== undefined) {
      normalized.smart_model_id = this.normalizeModelId(
        dto.smart_model_id,
        dto.smart_model_id === undefined
          ? current.smart_model_id || this.defaultSmartModelId(connector)
          : this.defaultSmartModelId(connector),
      );
    }
    if (dto.base_url_mode !== undefined || dto.connector !== undefined) {
      normalized.base_url_mode = this.normalizeBaseUrlMode(
        dto.base_url_mode,
        connector,
        current.base_url_mode,
      );
    }
    if (dto.routing_hint !== undefined) {
      normalized.routing_hint = this.normalizeObject(
        dto.routing_hint,
        'routing_hint',
      );
    }
    if (dto.mcp_server_ids !== undefined) {
      normalized.mcp_server_ids = this.normalizeStringArray(dto.mcp_server_ids);
    }
    if (dto.metadata !== undefined) {
      normalized.metadata = this.normalizeObject(dto.metadata, 'metadata');
    }
    return normalized;
  }

  private async toSummary(profile: AgentProfile): Promise<AgentProfileSummary> {
    const apiKey = profile.api_key_id
      ? await this.getApiKeySummary(profile.api_key_id)
      : null;
    const namespace = this.config.getNamespace(profile.namespace_id);
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description || null,
      connector: profile.connector,
      status: profile.status,
      api_key_id: profile.api_key_id || null,
      api_key: apiKey,
      namespace_id: profile.namespace_id || null,
      namespace_name: namespace?.name || null,
      default_model: profile.default_model || 'auto',
      smart_model_id:
        profile.smart_model_id || this.defaultSmartModelId(profile.connector),
      base_url_mode:
        profile.base_url_mode || this.defaultBaseUrlMode(profile.connector),
      routing_hint: profile.routing_hint || null,
      mcp_server_ids: profile.mcp_server_ids || [],
      metadata: profile.metadata || null,
      last_generated_at: profile.last_generated_at || null,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    };
  }

  private renderSummary(
    profile: AgentProfileSummary,
    requestedGatewayBaseUrl?: string,
  ): AgentProfileRenderedConfig {
    const baseUrl = this.baseUrlForMode(
      this.normalizeGatewayBaseUrl(requestedGatewayBaseUrl),
      profile.base_url_mode,
    );
    const gatewayKey = {
      placeholder: '<SIFTGATE_GATEWAY_API_KEY>',
      key_prefix: profile.api_key?.key_prefix || null,
      name: profile.api_key?.name || null,
      status: profile.api_key?.status || null,
    };
    return {
      connector: profile.connector,
      connector_label: this.connectorLabel(profile.connector),
      profile_id: profile.id,
      profile_name: profile.name,
      status: profile.status,
      base_url: baseUrl,
      base_url_mode: profile.base_url_mode,
      smart_model_id: profile.smart_model_id,
      default_model: profile.default_model,
      gateway_api_key: gatewayKey,
      secrets_redacted: true,
      routing_hint: profile.routing_hint,
      mcp_server_ids: profile.mcp_server_ids,
      cards: this.renderCards(profile, baseUrl),
    };
  }

  private renderCards(
    profile: AgentProfileSummary,
    baseUrl: string,
  ): AgentProfileRenderedCard[] {
    const label = this.connectorLabel(profile.connector);
    const env = {
      SIFTGATE_BASE_URL: baseUrl,
      SIFTGATE_API_KEY: '<SIFTGATE_GATEWAY_API_KEY>',
      SIFTGATE_MODEL: profile.smart_model_id,
    };

    switch (profile.connector) {
      case 'claude_code':
      case 'generic_anthropic':
        return [
          {
            id: `${profile.connector}-anthropic`,
            title: `${label} Anthropic-compatible config`,
            protocol: 'anthropic',
            fields: {
              base_url: baseUrl,
              api_key: '<SIFTGATE_GATEWAY_API_KEY>',
              model: profile.smart_model_id,
              default_model: profile.default_model,
            },
            env,
            snippet: [
              `export ANTHROPIC_BASE_URL="${baseUrl}"`,
              'export ANTHROPIC_AUTH_TOKEN="<SIFTGATE_GATEWAY_API_KEY>"',
              `export ANTHROPIC_MODEL="${profile.smart_model_id}"`,
            ].join('\n'),
            notes: [
              'Uses a Dashboard-generated Gateway API key placeholder only.',
              'The virtual model maps to SiftGate auto routing inside this profile scope.',
            ],
          },
        ];
      case 'cherry_studio':
        return [
          this.openAiCard(profile, baseUrl, label, {
            id: 'cherry-studio-openai',
            title: 'Cherry Studio OpenAI-compatible config',
            notes: [
              'Set provider type to OpenAI Compatible.',
              'Use the Gateway API key placeholder, never a provider key.',
            ],
          }),
          this.anthropicCard(profile, baseUrl, label, {
            id: 'cherry-studio-anthropic',
            title: 'Cherry Studio Anthropic-compatible config',
            notes: [
              'Use this card when selecting Anthropic-compatible mode.',
              'The Gateway API key remains the only client-facing secret.',
            ],
          }),
        ];
      case 'codex':
      case 'hermes':
      case 'openclaw':
      case 'generic_openai':
      default:
        return [
          this.openAiCard(profile, baseUrl, label, {
            id: `${profile.connector}-openai`,
            title: `${label} OpenAI-compatible config`,
            notes: [
              'Use the SiftGate /v1 OpenAI-compatible endpoint.',
              'Routing hints are advisory and never bypass policy.',
            ],
          }),
        ];
    }
  }

  private openAiCard(
    profile: AgentProfileSummary,
    baseUrl: string,
    _label: string,
    options: { id: string; title: string; notes: string[] },
  ): AgentProfileRenderedCard {
    return {
      id: options.id,
      title: options.title,
      protocol: 'openai',
      fields: {
        base_url: baseUrl,
        api_key: '<SIFTGATE_GATEWAY_API_KEY>',
        model: profile.smart_model_id,
        default_model: profile.default_model,
      },
      env: {
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: '<SIFTGATE_GATEWAY_API_KEY>',
        OPENAI_MODEL: profile.smart_model_id,
      },
      snippet: [
        `export OPENAI_BASE_URL="${baseUrl}"`,
        'export OPENAI_API_KEY="<SIFTGATE_GATEWAY_API_KEY>"',
        `export OPENAI_MODEL="${profile.smart_model_id}"`,
      ].join('\n'),
      notes: options.notes,
    };
  }

  private anthropicCard(
    profile: AgentProfileSummary,
    baseUrl: string,
    _label: string,
    options: { id: string; title: string; notes: string[] },
  ): AgentProfileRenderedCard {
    return {
      id: options.id,
      title: options.title,
      protocol: 'anthropic',
      fields: {
        base_url: baseUrl,
        api_key: '<SIFTGATE_GATEWAY_API_KEY>',
        model: profile.smart_model_id,
        default_model: profile.default_model,
      },
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: '<SIFTGATE_GATEWAY_API_KEY>',
        ANTHROPIC_MODEL: profile.smart_model_id,
      },
      snippet: [
        `export ANTHROPIC_BASE_URL="${baseUrl}"`,
        'export ANTHROPIC_AUTH_TOKEN="<SIFTGATE_GATEWAY_API_KEY>"',
        `export ANTHROPIC_MODEL="${profile.smart_model_id}"`,
      ].join('\n'),
      notes: options.notes,
    };
  }

  private virtualModelAllowed(
    modelId: string,
    permissions?: { allowed_models: string[] },
  ): boolean {
    const allowedModels = permissions?.allowed_models || [];
    return (
      allowedModels.length === 0 ||
      allowedModels.includes(modelId) ||
      allowedModels.includes('auto')
    );
  }

  private async getById(id: string): Promise<AgentProfile> {
    const entity = await this.profileRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Agent profile not found: ${id}`);
    return entity;
  }

  private async assertUniqueName(name: string, exceptId?: string): Promise<void> {
    const where = exceptId ? { name, id: Not(exceptId) } : { name };
    const existing = await this.profileRepo.findOne({ where });
    if (existing) {
      throw new BadRequestException(`Agent profile name already exists: ${name}`);
    }
  }

  private normalizeName(name: string | undefined): string {
    const normalized = (name || '').trim();
    if (!normalized) throw new BadRequestException('name is required');
    if (normalized.length > 80) {
      throw new BadRequestException('name must be 80 characters or fewer');
    }
    return normalized;
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    const normalized = (value || '').trim();
    return normalized ? normalized : null;
  }

  private normalizeConnector(value: unknown): AgentProfileConnector {
    if (
      typeof value !== 'string' ||
      !AGENT_PROFILE_CONNECTORS.includes(value as AgentProfileConnector)
    ) {
      throw new BadRequestException(
        `connector must be one of: ${AGENT_PROFILE_CONNECTORS.join(', ')}`,
      );
    }
    return value as AgentProfileConnector;
  }

  private normalizeStatus(value: unknown): AgentProfileStatus {
    if (
      typeof value !== 'string' ||
      !AGENT_PROFILE_STATUSES.includes(value as AgentProfileStatus)
    ) {
      throw new BadRequestException(
        `status must be one of: ${AGENT_PROFILE_STATUSES.join(', ')}`,
      );
    }
    return value as AgentProfileStatus;
  }

  private normalizeBaseUrlMode(
    value: AgentProfileBaseUrlMode | undefined,
    connector: AgentProfileConnector,
    fallback?: AgentProfileBaseUrlMode,
  ): AgentProfileBaseUrlMode {
    const mode = value || fallback || this.defaultBaseUrlMode(connector);
    if (!AGENT_PROFILE_BASE_URL_MODES.includes(mode)) {
      throw new BadRequestException(
        `base_url_mode must be one of: ${AGENT_PROFILE_BASE_URL_MODES.join(', ')}`,
      );
    }
    return mode;
  }

  private normalizeModelId(value: string | undefined, fallback: string): string {
    const normalized = (value || fallback || '').trim();
    if (!normalized) throw new BadRequestException('model id is required');
    return normalized;
  }

  private async normalizeApiKeyId(
    value: string | null | undefined,
  ): Promise<string | null> {
    const normalized = (value || '').trim();
    if (!normalized) return null;
    await this.getApiKeySummary(normalized, true);
    return normalized;
  }

  private normalizeNamespaceId(value: string | null | undefined): string | null {
    const normalized = (value || '').trim();
    if (!normalized) return null;
    if (!this.config.getNamespace(normalized)) {
      throw new BadRequestException(`Unknown namespace_id: ${normalized}`);
    }
    return normalized;
  }

  private normalizeObject(
    value: Record<string, unknown> | null | undefined,
    field: string,
  ): Record<string, unknown> | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value) || typeof value !== 'object') {
      throw new BadRequestException(`${field} must be an object`);
    }
    return value;
  }

  private normalizeStringArray(values: string[] | null | undefined): string[] | null {
    if (values === null || values === undefined) return null;
    if (!Array.isArray(values)) {
      throw new BadRequestException('mcp_server_ids must be an array');
    }
    return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  }

  private async getApiKeySummary(
    id: string,
    strict = false,
  ): Promise<AgentProfileGatewayKeySummary | null> {
    try {
      return this.toGatewayKeySummary(await this.gatewayApiKeys.getSummary(id));
    } catch (error) {
      if (strict) {
        throw new BadRequestException(`Unknown api_key_id: ${id}`);
      }
      return null;
    }
  }

  private toGatewayKeySummary(
    summary: GatewayApiKeySummary,
  ): AgentProfileGatewayKeySummary {
    return {
      id: summary.id,
      name: summary.name,
      key_prefix: summary.key_prefix,
      status: summary.status,
      allow_auto: summary.allow_auto,
      allow_direct: summary.allow_direct,
      allowed_models: summary.allowed_models,
      namespace_id: summary.namespace_id,
      namespace_name: summary.namespace_name,
    };
  }

  private defaultSmartModelId(connector: AgentProfileConnector): string {
    return ANTHROPIC_SMART_CONNECTORS.has(connector)
      ? CLAUDE_AGENT_SMART_MODEL_ID
      : 'auto';
  }

  private defaultBaseUrlMode(
    connector: AgentProfileConnector,
  ): AgentProfileBaseUrlMode {
    return ANTHROPIC_SMART_CONNECTORS.has(connector)
      ? 'anthropic_v1'
      : 'openai_v1';
  }

  private normalizeGatewayBaseUrl(value: string | undefined): string {
    const configured =
      typeof value === 'string' && value.trim()
        ? value.trim()
        : `http://localhost:${this.config.server?.port || 2099}`;
    return configured.replace(/\/+$/, '');
  }

  private baseUrlForMode(
    gatewayBaseUrl: string,
    mode: AgentProfileBaseUrlMode,
  ): string {
    if (mode === 'root') return gatewayBaseUrl;
    if (mode === 'anthropic_v1') return gatewayBaseUrl;
    return `${gatewayBaseUrl}/v1`;
  }

  private connectorLabel(connector: AgentProfileConnector): string {
    switch (connector) {
      case 'codex':
        return 'Codex';
      case 'claude_code':
        return 'Claude Code';
      case 'cherry_studio':
        return 'Cherry Studio';
      case 'hermes':
        return 'Hermes';
      case 'openclaw':
        return 'OpenClaw';
      case 'generic_openai':
        return 'Generic OpenAI';
      case 'generic_anthropic':
        return 'Generic Anthropic';
    }
  }
}
