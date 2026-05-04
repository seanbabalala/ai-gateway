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
import { EmbeddingsNormalizer } from '../canonical/normalizers/embeddings.normalizer';
import { PipelineService } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import {
  attachGatewayApiKeyMetadata,
  gatewayApiKeyFromRequest,
} from '../auth/gateway-api-key-metadata';
import { EmbeddingsRequestDto, ErrorEnvelopeDto } from '../openapi/openapi.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class EmbeddingsController {
  private readonly logger = new Logger(EmbeddingsController.name);
  private readonly normalizer = new EmbeddingsNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('embeddings')
  @ApiOperation({
    summary: 'OpenAI Embeddings compatible ingress',
    description: 'Routes OpenAI-compatible embeddings requests through SiftGate embedding-capable nodes.',
  })
  @ApiBody({ type: EmbeddingsRequestDto })
  @ApiOkResponse({ description: 'OpenAI-compatible embeddings response.' })
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
        `[embeddings] model=${canonical.model || 'auto'}, dimensions=${canonical.dimensions ?? 'default'}`,
      );

      const result = await this.pipeline.processEmbeddings(canonical, {
        signal: abortController.signal,
      });
      res.status(result.statusCode).json(result.body);
    } catch (err) {
      this.logger.error(`[embeddings] Error: ${(err as Error).message}`);
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
