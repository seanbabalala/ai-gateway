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
import { RerankNormalizer } from '../canonical/normalizers/rerank.normalizer';
import { PipelineService } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import {
  attachGatewayApiKeyMetadata,
  gatewayApiKeyFromRequest,
} from '../auth/gateway-api-key-metadata';
import { ErrorEnvelopeDto, RerankRequestDto } from '../openapi/openapi.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class RerankController {
  private readonly logger = new Logger(RerankController.name);
  private readonly normalizer = new RerankNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('rerank')
  @ApiOperation({
    summary: 'OpenAI/common-compatible rerank ingress',
    description: 'Routes rerank requests through SiftGate rerank-capable nodes.',
  })
  @ApiBody({ type: RerankRequestDto })
  @ApiOkResponse({ description: 'Rerank response with ranked document indexes and scores.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async handle(@Req() req: Request, @Res() res: Response) {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    const abortOnResponseClose = () => {
      if (!res.writableEnded) abort();
    };
    req.on?.('aborted', abort);
    res.on?.('close', abortOnResponseClose);

    try {
      const headers = this.extractHeaders(req);
      const canonical = this.normalizer.normalize(req.body, headers);
      attachGatewayApiKeyMetadata(canonical, gatewayApiKeyFromRequest(req));

      this.logger.log(
        `[rerank] model=${canonical.model || 'auto'}, documents=${canonical.documents.length}`,
      );

      const result = await this.pipeline.processRerank(canonical, {
        signal: abortController.signal,
      });
      res.status(result.statusCode).json(result.body);
    } catch (err) {
      this.logger.error(`[rerank] Error: ${(err as Error).message}`);
      if (!res.headersSent) {
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
        res.status(500).json({
          error: {
            message: (err as Error).message,
            type: 'internal_error',
          },
        });
      }
    } finally {
      req.off?.('aborted', abort);
      res.off?.('close', abortOnResponseClose);
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
