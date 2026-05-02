import { Controller, Post, Req, Res, Logger, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { MessagesNormalizer } from '../canonical/normalizers/messages.normalizer';
import { PipelineService } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);
  private readonly normalizer = new MessagesNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('messages')
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
        `[messages] ${canonical.messages.length} msg, stream=${canonical.stream}`,
      );

      if (canonical.stream) {
        await this.pipeline.processStream(canonical, res);
      } else {
        const result = await this.pipeline.process(canonical);
        res.status(result.statusCode).json(result.body);
      }
    } catch (err) {
      this.logger.error(`[messages] Error: ${(err as Error).message}`);
      if (!res.headersSent) {
        const status = err instanceof BudgetExceededError ? 429 : 500;
        if (err instanceof BudgetExceededError) {
          res.status(429).json({
            type: 'error',
            error: {
              type: 'budget_exceeded',
              message: err.message,
              details: err.toDetails(),
            },
          });
        } else {
          res.status(500).json({
            type: 'error',
            error: { type: 'internal_error', message: (err as Error).message },
          });
        }
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
