import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '../config/config.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { gatewayApiKeyFromRequest } from '../auth/gateway-api-key-metadata';
import { ErrorEnvelopeDto, ModelListResponseDto } from '../openapi/openapi.dto';
import { AgentProfileService } from '../agent-profiles/agent-profile.service';
import type { Request } from 'express';

/**
 * GET /v1/models — OpenAI-compatible model listing endpoint.
 * Returns all available models, aliases, and the special "auto" model.
 */
@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('Models')
@ApiBearerAuth('gatewayApiKey')
export class ModelsController {
  private readonly logger = new Logger(ModelsController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly agentProfiles: AgentProfileService,
  ) {}

  @Get('models')
  @ApiOperation({ summary: 'List OpenAI-compatible models and SiftGate aliases' })
  @ApiOkResponse({ type: ModelListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  async list(@Req() req?: Request) {
    const gatewayKey = gatewayApiKeyFromRequest(req);
    if (
      gatewayKey?.allowed_endpoints.length &&
      !gatewayKey.allowed_endpoints.includes('models')
    ) {
      throw new ForbiddenException('This API key is not allowed to use /v1/models.');
    }
    const models = this.config.listModels().filter((model) => {
      const nodeAllowed =
        !gatewayKey?.allowed_nodes.length ||
        gatewayKey.allowed_nodes.includes(model.node);
      const modelAllowed =
        !gatewayKey?.allowed_models.length ||
        gatewayKey.allowed_models.includes(model.id) ||
        model.aliases.some((alias) => gatewayKey.allowed_models.includes(alias));
      return nodeAllowed && modelAllowed;
    });

    // Build OpenAI-compatible response
    const profileModels = await this.agentProfiles.listVirtualModelsForApiKey(
      gatewayKey?.id,
      gatewayKey
        ? {
            allow_auto: gatewayKey.allow_auto,
            allowed_models: gatewayKey.allowed_models,
          }
        : undefined,
    );

    const data: Record<string, unknown>[] = [
      // "auto" — the gateway's smart routing model
      ...(gatewayKey?.allow_auto === false
        ? []
        : [{
            id: 'auto',
            object: 'model',
            created: 0,
            owned_by: 'siftgate',
            description: 'Automatic routing — gateway scores request complexity and picks the best node.',
          }]),
      // Real models
      ...models.map((m) => ({
        id: m.id,
        object: 'model',
        created: 0,
        owned_by: m.node,
        node_name: m.nodeName,
        aliases: m.aliases,
      })),
      // Alias entries (so clients can discover shortcuts)
      ...this.buildAliasEntries(models),
    ];

    const seenIds = new Set(data.map((item) => String(item.id)));
    for (const profileModel of profileModels) {
      if (!seenIds.has(profileModel.id)) {
        seenIds.add(profileModel.id);
        data.push({ ...profileModel });
      }
    }

    return {
      object: 'list',
      data,
    };
  }

  private buildAliasEntries(models: ReturnType<ConfigService['listModels']>) {
    const seen = new Set<string>();
    const entries: Record<string, unknown>[] = [];

    for (const m of models) {
      for (const alias of m.aliases) {
        if (!seen.has(alias)) {
          seen.add(alias);
          entries.push({
            id: alias,
            object: 'model',
            created: 0,
            owned_by: m.node,
            resolves_to: m.id,
            is_alias: true,
          });
        }
      }
    }

    return entries;
  }
}
