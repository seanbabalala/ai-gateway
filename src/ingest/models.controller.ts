import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
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
import { ErrorEnvelopeDto, ModelListResponseDto } from '../openapi/openapi.dto';

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

  constructor(private readonly config: ConfigService) {}

  @Get('models')
  @ApiOperation({ summary: 'List OpenAI-compatible models and SiftGate aliases' })
  @ApiOkResponse({ type: ModelListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  list() {
    const models = this.config.listModels();

    // Build OpenAI-compatible response
    const data = [
      // "auto" — the gateway's smart routing model
      {
        id: 'auto',
        object: 'model',
        created: 0,
        owned_by: 'siftgate',
        description: 'Automatic routing — gateway scores request complexity and picks the best node.',
      },
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
