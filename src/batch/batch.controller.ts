import {
  Body,
  Controller,
  Get,
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
import {
  sendMappedPublicErrorResponse,
} from '../http/public-error-handling';
import {
  sendPublicResponse,
} from '../http/public-contract';
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
      this.handleError(req, res, error, 'batch create');
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
      this.handleError(req, res, error, 'batch retrieve');
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
      this.handleError(req, res, error, 'batch cancel');
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
      this.handleError(req, res, error, 'batch output download');
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
      this.handleError(req, res, error, 'batch error download');
    }
  }

  private send(res: ExpressResponse, response: BatchProxyResponse): void {
    for (const [key, value] of Object.entries(response.headers || {})) {
      res.setHeader(key, value);
    }
    sendPublicResponse(res, response);
  }

  private handleError(
    req: Request,
    res: ExpressResponse,
    error: unknown,
    operation: string,
  ): void {
    this.logger.warn(`${operation} failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) {
      sendMappedPublicErrorResponse(res, req, error, {
        fallbackMessage: 'Batch proxy request failed.',
      });
    }
  }
}
