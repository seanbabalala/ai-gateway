import { Controller, Post, Req, Res, Logger, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ResponsesNormalizer } from '../canonical/normalizers/responses.normalizer';
import { PipelineService } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class ResponsesController {
  private readonly logger = new Logger(ResponsesController.name);
  private readonly normalizer = new ResponsesNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('responses')
  async handle(@Req() req: Request, @Res() res: Response) {
    try {
      const headers = this.extractHeaders(req);
      const canonical = this.normalizer.normalize(req.body, headers);
      canonical.metadata.api_key_name = (req as unknown as Record<string, unknown>).apiKeyName as string | undefined;

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
        res.status(status).json({
          error: {
            message: (err as Error).message,
            type: status === 429 ? 'budget_exceeded' : 'internal_error',
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
