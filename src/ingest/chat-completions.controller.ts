import { Controller, Post, Req, Res, Logger, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChatCompletionsNormalizer } from '../canonical/normalizers/chat-completions.normalizer';
import { PipelineService } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { ChatCompletionsRequestDto, ErrorEnvelopeDto } from '../openapi/openapi.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class ChatCompletionsController {
  private readonly logger = new Logger(ChatCompletionsController.name);
  private readonly normalizer = new ChatCompletionsNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('chat/completions')
  @ApiOperation({
    summary: 'OpenAI Chat Completions compatible ingress',
    description: 'Routes OpenAI-compatible chat requests through SiftGate. When stream=true, the response is Server-Sent Events.',
  })
  @ApiBody({ type: ChatCompletionsRequestDto })
  @ApiOkResponse({ description: 'OpenAI-compatible chat completion response or SSE stream.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async handle(@Req() req: Request, @Res() res: Response) {
    try {
      const headers = this.extractHeaders(req);
      const canonical = this.normalizer.normalize(req.body, headers);
      const gatewayKey = (req as unknown as Record<string, unknown>).gatewayApiKey as
        | {
            id: string;
            name: string;
            allow_auto: boolean;
            allow_direct: boolean;
            allowed_nodes: string[];
            allowed_models: string[];
            namespace_id?: string | null;
            namespace_name?: string | null;
          }
        | undefined;
      canonical.metadata.api_key_name = gatewayKey?.name;
      canonical.metadata.api_key_id = gatewayKey?.id;
      canonical.metadata.namespace_id = gatewayKey?.namespace_id || null;
      canonical.metadata.namespace_name = gatewayKey?.namespace_name || null;
      canonical.metadata.api_key_permissions = gatewayKey
        ? {
            allow_auto: gatewayKey.allow_auto,
            allow_direct: gatewayKey.allow_direct,
            allowed_nodes: gatewayKey.allowed_nodes,
            allowed_models: gatewayKey.allowed_models,
          }
        : undefined;

      this.logger.log(
        `[chat/completions] ${canonical.messages.length} msg, stream=${canonical.stream}`,
      );

      if (canonical.stream) {
        await this.pipeline.processStream(canonical, res);
      } else {
        const result = await this.pipeline.process(canonical);
        res.status(result.statusCode).json(result.body);
      }
    } catch (err) {
      this.logger.error(`[chat/completions] Error: ${(err as Error).message}`);
      if (!res.headersSent) {
        const status = err instanceof BudgetExceededError ? 429 : 500;
        if (err instanceof BudgetExceededError) {
          res.status(429).json({
            error: {
              message: err.message,
              type: 'budget_exceeded',
              code: err.budgetType,
              details: err.toDetails(),
            },
          });
          return;
        }
        res.status(status).json({
          error: {
            message: (err as Error).message,
            type: 'internal_error',
          },
        });
      }
    }
  }

  private extractHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
    return headers;
  }
}
