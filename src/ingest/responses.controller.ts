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
import { ResponsesNormalizer } from '../canonical/normalizers/responses.normalizer';
import { PipelineService } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { ErrorEnvelopeDto, ResponsesRequestDto } from '../openapi/openapi.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class ResponsesController {
  private readonly logger = new Logger(ResponsesController.name);
  private readonly normalizer = new ResponsesNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('responses')
  @ApiOperation({
    summary: 'OpenAI Responses compatible ingress',
    description: 'Routes OpenAI Responses requests through SiftGate. When stream=true, the response is Server-Sent Events.',
  })
  @ApiBody({ type: ResponsesRequestDto })
  @ApiOkResponse({ description: 'OpenAI Responses-compatible response or SSE stream.' })
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
          }
        | undefined;
      canonical.metadata.api_key_name = gatewayKey?.name;
      canonical.metadata.api_key_id = gatewayKey?.id;
      canonical.metadata.api_key_permissions = gatewayKey
        ? {
            allow_auto: gatewayKey.allow_auto,
            allow_direct: gatewayKey.allow_direct,
            allowed_nodes: gatewayKey.allowed_nodes,
            allowed_models: gatewayKey.allowed_models,
          }
        : undefined;

      this.logger.log(
        `[responses] ${canonical.messages.length} msg, stream=${canonical.stream}`,
      );

      if (canonical.stream) {
        await this.pipeline.processStream(canonical, res);
      } else {
        const result = await this.pipeline.process(canonical);
        res.status(result.statusCode).json(result.body);
      }
    } catch (err) {
      this.logger.error(`[responses] Error: ${(err as Error).message}`);
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
