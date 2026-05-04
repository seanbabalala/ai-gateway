import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response as ExpressResponse } from 'express';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { BudgetExceededError } from '../budget/budget.service';
import { BatchCreateRequestDto, ErrorEnvelopeDto } from '../openapi/openapi.dto';
import { BatchApiProxyService } from './batch-api-proxy.service';
import type { BatchProxyResponse } from './batch.types';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class BatchController {
  private readonly logger = new Logger(BatchController.name);

  constructor(private readonly batches: BatchApiProxyService) {}

  @Post('batches')
  @ApiOperation({
    summary: 'OpenAI-compatible Batch API create proxy',
    description:
      'Creates a provider batch job through a configured upstream. SiftGate stores metadata only and never stores batch input/output file contents.',
  })
  @ApiBody({ type: BatchCreateRequestDto })
  @ApiOkResponse({ description: 'Provider batch create response proxied through SiftGate.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async createBatch(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Res() res: ExpressResponse,
  ) {
    try {
      const response = await this.batches.create({
        req,
        body,
        context: this.batches.buildContext(req, 'create'),
      });
      this.send(res, response);
    } catch (error) {
      this.handleError(res, error, 'batch create');
    }
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get provider batch status through SiftGate' })
  @ApiParam({ name: 'id', description: 'Local request id or provider batch id.' })
  @ApiOkResponse({ description: 'Provider batch metadata/status response.' })
  async retrieveBatch(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: ExpressResponse,
  ) {
    try {
      const response = await this.batches.retrieve({
        id,
        req,
        context: this.batches.buildContext(req, 'retrieve'),
      });
      this.send(res, response);
    } catch (error) {
      this.handleError(res, error, 'batch retrieve');
    }
  }

  @Post('batches/:id/cancel')
  @ApiOperation({ summary: 'Cancel a provider batch job through SiftGate' })
  @ApiParam({ name: 'id', description: 'Local request id or provider batch id.' })
  @ApiOkResponse({ description: 'Provider batch cancel response.' })
  async cancelBatch(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: ExpressResponse,
  ) {
    try {
      const response = await this.batches.cancel({
        id,
        req,
        context: this.batches.buildContext(req, 'cancel'),
      });
      this.send(res, response);
    } catch (error) {
      this.handleError(res, error, 'batch cancel');
    }
  }

  @Get('batches/:id/output')
  @ApiOperation({
    summary: 'Download provider batch output file content through SiftGate',
    description:
      'Streams the provider output file content without persisting it locally. Use /v1/batches/:id/errors for error file content when present.',
  })
  @ApiParam({ name: 'id', description: 'Local request id or provider batch id.' })
  async downloadBatchOutput(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: ExpressResponse,
  ) {
    try {
      const response = await this.batches.download({
        id,
        req,
        fileKind: 'output',
        context: this.batches.buildContext(req, 'output'),
      });
      this.send(res, response);
    } catch (error) {
      this.handleError(res, error, 'batch output download');
    }
  }

  @Get('batches/:id/errors')
  @ApiOperation({
    summary: 'Download provider batch error file content through SiftGate',
    description: 'Streams provider error file content without persisting it locally.',
  })
  @ApiParam({ name: 'id', description: 'Local request id or provider batch id.' })
  async downloadBatchErrors(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: ExpressResponse,
  ) {
    try {
      const response = await this.batches.download({
        id,
        req,
        fileKind: 'error',
        context: this.batches.buildContext(req, 'output'),
      });
      this.send(res, response);
    } catch (error) {
      this.handleError(res, error, 'batch error download');
    }
  }

  private send(res: ExpressResponse, response: BatchProxyResponse): void {
    res.setHeader('x-siftgate-request-id', response.requestId);
    for (const [key, value] of Object.entries(response.headers || {})) {
      res.setHeader(key, value);
    }
    res.status(response.statusCode);
    if (Buffer.isBuffer(response.body)) {
      res.type(response.contentType || 'application/octet-stream').send(response.body);
      return;
    }
    if (response.contentType && !response.contentType.includes('application/json')) {
      res.type(response.contentType).send(response.body);
      return;
    }
    res.json(response.body);
  }

  private handleError(res: ExpressResponse, error: unknown, operation: string): void {
    this.logger.warn(`${operation} failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof BudgetExceededError) {
      res.status(429).json({
        error: {
          message: error.message,
          type: 'budget_exceeded',
          code: error.budgetType,
          details: error.toDetails(),
        },
      });
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const response = error.getResponse();
      res.status(status).json(
        typeof response === 'string'
          ? { error: { message: response, type: status === 404 ? 'not_found' : 'batch_proxy_error' } }
          : response,
      );
      return;
    }
    res.status(500).json({
      error: {
        message: 'Batch proxy request failed.',
        type: 'internal_error',
      },
    });
  }
}
