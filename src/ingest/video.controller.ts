import { Controller, Get, Post, Req, Res, Param, Logger, UseGuards, Optional } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response as ExpressResponse } from 'express';
import { MediaNormalizer } from '../canonical/normalizers/media.normalizer';
import { PipelineService, PipelineResult } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import {
  attachGatewayApiKeyMetadata,
  gatewayApiKeyFromRequest,
} from '../auth/gateway-api-key-metadata';
import type { GatewayApiKeyContext } from '../auth/gateway-api-key.service';
import { ConfigService } from '../config/config.service';
import { NodeConfig } from '../config/gateway.config';
import { SecretReferenceResolverService } from '../config/secret-reference-resolver.service';
import { VideoJob } from '../database/entities';
import {
  ErrorEnvelopeDto,
  VideoGenerationRequestDto,
} from '../openapi/openapi.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);
  private readonly normalizer = new MediaNormalizer();

  constructor(
    private readonly pipeline: PipelineService,
    private readonly config: ConfigService,
    @InjectRepository(VideoJob)
    private readonly videoJobs: Repository<VideoJob>,
    @Optional()
    private readonly secretResolver?: SecretReferenceResolverService,
  ) {}

  @Post('videos/generations')
  @ApiOperation({
    summary: 'Experimental async video generation preview',
    description: 'OpenAI/common-compatible JSON pass-through for async video generation. SiftGate stores job metadata only; prompt, source image, and video bytes are not persisted.',
  })
  @ApiBody({ type: VideoGenerationRequestDto })
  @ApiOkResponse({ description: 'Provider video job response with local job metadata persisted.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async videoGenerations(@Req() req: Request, @Res() res: ExpressResponse) {
    try {
      const headers = this.extractHeaders(req);
      const canonical = this.normalizer.normalize(req.body, headers, 'video_generation');
      this.applyGatewayKey(req, canonical);

      this.logger.log(
        `[videos/generations] model=${canonical.model || 'auto'}, bytes=${canonical.media.byte_size}`,
      );

      const result = await this.pipeline.processMedia(canonical);
      if (result.statusCode >= 200 && result.statusCode < 300) {
        await this.persistJob(result, canonical);
      }
      this.sendPipelineResult(res, result);
    } catch (err) {
      this.logger.error(`[videos/generations] Error: ${(err as Error).message}`);
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
  }

  @Get('videos/:id')
  @ApiOperation({ summary: 'Get experimental video job status' })
  @ApiOkResponse({ description: 'Local video job metadata, optionally refreshed from provider status endpoint.' })
  async getVideo(@Param('id') id: string, @Req() req: Request, @Res() res: ExpressResponse) {
    const job = await this.findJob(id, req);
    if (!job) {
      res.status(404).json({ error: { message: `Video job "${id}" not found`, type: 'not_found' } });
      return;
    }
    await this.refreshStatus(job).catch((err) => {
      this.logger.warn(`Video status refresh failed for ${id}: ${(err as Error).message}`);
    });
    res.json(this.jobResponse(job));
  }

  @Get('videos/:id/content')
  @ApiOperation({ summary: 'Proxy experimental video job content' })
  async getVideoContent(@Param('id') id: string, @Req() req: Request, @Res() res: ExpressResponse) {
    const job = await this.findJob(id, req);
    if (!job) {
      res.status(404).json({ error: { message: `Video job "${id}" not found`, type: 'not_found' } });
      return;
    }
    const node = this.config.getNode(job.node_id);
    if (!node?.video_content_endpoint) {
      res.status(400).json({
        error: {
          message: 'Video content endpoint is not configured for this node.',
          type: 'unsupported_operation',
        },
      });
      return;
    }
    await this.proxyProvider(node, node.video_content_endpoint, job, 'GET', res);
  }

  @Post('videos/:id/cancel')
  @ApiOperation({ summary: 'Cancel experimental video job when the provider supports it' })
  async cancelVideo(@Param('id') id: string, @Req() req: Request, @Res() res: ExpressResponse) {
    const job = await this.findJob(id, req);
    if (!job) {
      res.status(404).json({ error: { message: `Video job "${id}" not found`, type: 'not_found' } });
      return;
    }
    const node = this.config.getNode(job.node_id);
    if (!node?.video_cancel_endpoint) {
      res.status(400).json({
        error: {
          message: 'Video cancel endpoint is not configured for this node.',
          type: 'unsupported_operation',
        },
      });
      return;
    }
    await this.proxyProvider(node, node.video_cancel_endpoint, job, 'POST', res, async () => {
      job.status = 'cancelled';
      await this.videoJobs.save(job);
    });
  }

  private async persistJob(
    result: PipelineResult,
    canonical: ReturnType<MediaNormalizer['normalize']>,
  ): Promise<void> {
    if (!result.requestId || !result.nodeId || !result.model) return;
    const body =
      result.body && typeof result.body === 'object' && !Buffer.isBuffer(result.body)
        ? (result.body as Record<string, unknown>)
        : {};
    const providerJobId = this.extractProviderJobId(body);
    const status = this.extractStatus(body) || 'queued';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await this.videoJobs.save(
      this.videoJobs.create({
        request_id: result.requestId,
        provider_job_id: providerJobId,
        node_id: result.nodeId,
        model: result.model,
        api_key_id: canonical.metadata.api_key_id || null,
        api_key_name: canonical.metadata.api_key_name || null,
        namespace_id: canonical.metadata.namespace_id || null,
        namespace_name: canonical.metadata.namespace_name || null,
        status,
        error: this.extractError(body),
        expires_at: expiresAt,
      }),
    );

    if (!('id' in body) && result.body && typeof result.body === 'object' && !Buffer.isBuffer(result.body)) {
      (result.body as Record<string, unknown>).id = providerJobId || result.requestId;
    }
  }

  private async findJob(id: string, req: Request): Promise<VideoJob | null> {
    const job = await this.videoJobs.findOne({
      where: [{ request_id: id }, { provider_job_id: id }],
    });
    if (!job) return null;
    return this.canAccessJob(job, req) ? job : null;
  }

  private canAccessJob(job: VideoJob, req: Request): boolean {
    const gatewayKey = (req as unknown as Record<string, unknown>).gatewayApiKey as
      | GatewayApiKeyContext
      | undefined;
    if (!gatewayKey) return false;
    if (job.api_key_id && job.api_key_id !== gatewayKey.id) return false;
    if (job.namespace_id && job.namespace_id !== (gatewayKey.namespace_id || null)) return false;
    return true;
  }

  private async refreshStatus(job: VideoJob): Promise<void> {
    const node = this.config.getNode(job.node_id);
    if (!node?.video_status_endpoint) return;
    const response = await this.fetchProvider(node, node.video_status_endpoint, job, 'GET');
    if (!response.ok) return;
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return;
    job.status = this.extractStatus(body) || job.status;
    job.error = this.extractError(body);
    await this.videoJobs.save(job);
  }

  private async proxyProvider(
    node: NodeConfig,
    endpointTemplate: string,
    job: VideoJob,
    method: 'GET' | 'POST',
    res: ExpressResponse,
    afterSuccess?: () => Promise<void>,
  ): Promise<void> {
    const response = await this.fetchProvider(node, endpointTemplate, job, method);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const body = Buffer.from(await response.arrayBuffer());
    if (response.ok && afterSuccess) await afterSuccess();
    res.status(response.status).type(contentType).send(body);
  }

  private async fetchProvider(
    node: NodeConfig,
    endpointTemplate: string,
    job: VideoJob,
    method: 'GET' | 'POST',
  ): Promise<globalThis.Response> {
    const jobId = encodeURIComponent(job.provider_job_id || job.request_id);
    const endpoint = endpointTemplate.replace(':id', jobId).replace('{id}', jobId);
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${node.base_url.replace(/\/+$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = await this.providerHeaders(node);
    return fetch(url, { method, headers });
  }

  private async providerHeaders(node: NodeConfig): Promise<Record<string, string>> {
    const authType = node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    const headers: Record<string, string> = this.secretResolver
      ? await this.secretResolver.resolveRecord(node.headers, {
          optional: true,
          location: `nodes.${node.id}.headers`,
        })
      : { ...(node.headers || {}) };
    const apiKey = this.secretResolver
      ? await this.secretResolver.resolveString(node.api_key, {
          location: `nodes.${node.id}.api_key`,
        })
      : node.api_key;
    if (authType === 'x-api-key') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] ||= '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private jobResponse(job: VideoJob): Record<string, unknown> {
    return {
      id: job.provider_job_id || job.request_id,
      object: 'video.generation.job',
      request_id: job.request_id,
      status: job.status,
      node: job.node_id,
      model: job.model,
      created_at: job.created_at.toISOString(),
      updated_at: job.updated_at.toISOString(),
      expires_at: job.expires_at,
      error: job.error,
    };
  }

  private extractProviderJobId(body: Record<string, unknown>): string | null {
    const operation = body.operation && typeof body.operation === 'object'
      ? (body.operation as Record<string, unknown>)
      : null;
    const candidates = [
      body.id,
      body.job_id,
      body.video_id,
      body.name,
      operation?.name,
    ];
    return candidates.find((value): value is string => typeof value === 'string' && value.length > 0) || null;
  }

  private extractStatus(body: Record<string, unknown>): string | null {
    const candidates = [body.status, body.state, body.phase];
    return candidates.find((value): value is string => typeof value === 'string' && value.length > 0) || null;
  }

  private extractError(body: Record<string, unknown>): string | null {
    const error = body.error;
    if (!error) return null;
    if (typeof error === 'string') return error.slice(0, 500);
    if (typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string') return message.slice(0, 500);
    }
    return null;
  }

  private applyGatewayKey(
    req: Request,
    canonical: ReturnType<MediaNormalizer['normalize']>,
  ): void {
    attachGatewayApiKeyMetadata(canonical, gatewayApiKeyFromRequest(req));
  }

  private sendPipelineResult(res: ExpressResponse, result: PipelineResult): void {
    res.status(result.statusCode);
    if (Buffer.isBuffer(result.body)) {
      res.type(result.contentType || 'application/octet-stream').send(result.body);
      return;
    }
    if (result.contentType && !result.contentType.includes('application/json')) {
      res.type(result.contentType).send(result.body);
      return;
    }
    res.json(result.body);
  }

  private extractHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
    return headers;
  }
}
