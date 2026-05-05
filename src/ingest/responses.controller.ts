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
import {
  attachGatewayApiKeyMetadata,
  gatewayApiKeyFromRequest,
} from '../auth/gateway-api-key-metadata';
import {
  sendPublicErrorResponse,
  sendPublicResponse,
} from '../http/public-contract';
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
      attachGatewayApiKeyMetadata(canonical, gatewayApiKeyFromRequest(req));

      this.logger.log(
        `[responses] ${canonical.messages.length} msg, stream=${canonical.stream}`,
      );

      if (canonical.stream) {
        await this.pipeline.processStream(canonical, res);
      } else {
        const result = await this.pipeline.process(canonical);
        sendPublicResponse(res, result);
      }
    } catch (err) {
      this.logger.error(`[responses] Error: ${(err as Error).message}`);
      if (!res.headersSent) {
        if (err instanceof BudgetExceededError) {
          sendPublicErrorResponse(res, 429, 'openai', err.message, {
            type: 'budget_exceeded',
            code: err.budgetType,
            details: err.toDetails(),
          });
          return;
        }
        sendPublicErrorResponse(res, 500, 'openai', (err as Error).message, {
          type: 'internal_error',
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
