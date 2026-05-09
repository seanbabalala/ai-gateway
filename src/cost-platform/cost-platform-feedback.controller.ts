import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { GatewayApiKeyContext } from '../auth/gateway-api-key.service';
import { CostPlatformService } from './cost-platform.service';

interface FeedbackRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
  workspaceId?: string;
  gatewayApiKey?: GatewayApiKeyContext;
}

@Controller('v1/feedback')
@UseGuards(ApiKeyGuard)
@ApiTags('Cost Platform')
@ApiBearerAuth('gatewayApiKey')
export class CostPlatformFeedbackController {
  constructor(private readonly costPlatform: CostPlatformService) {}

  @Post()
  @ApiOperation({
    summary:
      'Record metadata-only thumbs up/down route feedback for a gateway request',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['request_id', 'value'],
      additionalProperties: false,
      properties: {
        request_id: {
          type: 'string',
          example: 'req_01HY...',
        },
        value: {
          type: 'string',
          enum: ['up', 'down', 'thumbs_up', 'thumbs_down'],
          example: 'up',
        },
        reason_code: {
          type: 'string',
          example: 'helpful',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Feedback metadata was stored. Prompts, responses, diffs, tool payloads, raw headers, provider keys, media bytes, and hidden reasoning text are never accepted or returned.',
  })
  record(
    @Req() request: FeedbackRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.costPlatform.recordFeedback({
      request_id: firstString(body?.request_id),
      value: firstString(body?.value),
      reason_code: firstString(body?.reason_code),
      source: 'gateway_api',
      api_key_id: request.apiKeyId || request.gatewayApiKey?.id || null,
      api_key_name: request.apiKeyName || request.gatewayApiKey?.name || null,
      workspace_id: request.workspaceId || request.gatewayApiKey?.workspace_id || null,
    });
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}
