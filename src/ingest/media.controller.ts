import { Controller, Post, Req, Res, Logger, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { MediaNormalizer } from '../canonical/normalizers/media.normalizer';
import { CanonicalMediaSourceFormat } from '../canonical/canonical.types';
import { PipelineService, PipelineResult } from '../pipeline/pipeline.service';
import { BudgetExceededError } from '../budget/budget.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import {
  AudioSpeechRequestDto,
  AudioTranscriptionRequestDto,
  ErrorEnvelopeDto,
  ImageEditRequestDto,
  ImageGenerationRequestDto,
} from '../openapi/openapi.dto';

interface GatewayKeyContext {
  id: string;
  name: string;
  allow_auto: boolean;
  allow_direct: boolean;
  allowed_nodes: string[];
  allowed_models: string[];
  namespace_id?: string | null;
  namespace_name?: string | null;
}

@Controller('v1')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('AI Proxy')
@ApiBearerAuth('gatewayApiKey')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);
  private readonly normalizer = new MediaNormalizer();

  constructor(private readonly pipeline: PipelineService) {}

  @Post('images/generations')
  @ApiOperation({
    summary: 'OpenAI Images generation compatible ingress',
    description: 'Passes OpenAI-compatible image generation requests through SiftGate image-capable nodes.',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({ type: ImageGenerationRequestDto })
  @ApiOkResponse({ description: 'OpenAI-compatible image generation response.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async imageGenerations(@Req() req: Request, @Res() res: Response) {
    await this.handleMedia(req, res, 'image_generation');
  }

  @Post('images/edits')
  @ApiOperation({
    summary: 'OpenAI Images edits compatible ingress',
    description: 'Passes OpenAI-compatible image edit requests through SiftGate image-capable nodes. Multipart file contents are not inspected or transformed.',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({ type: ImageEditRequestDto })
  @ApiOkResponse({ description: 'OpenAI-compatible image edit response.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async imageEdits(@Req() req: Request, @Res() res: Response) {
    await this.handleMedia(req, res, 'image_edit');
  }

  @Post('audio/transcriptions')
  @ApiOperation({
    summary: 'OpenAI Audio transcription compatible ingress',
    description: 'Passes OpenAI-compatible audio transcription requests through SiftGate audio-capable nodes. Multipart file contents are not inspected or transformed.',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({ type: AudioTranscriptionRequestDto })
  @ApiOkResponse({ description: 'OpenAI-compatible transcription response.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async audioTranscriptions(@Req() req: Request, @Res() res: Response) {
    await this.handleMedia(req, res, 'audio_transcription');
  }

  @Post('audio/speech')
  @ApiOperation({
    summary: 'OpenAI Audio speech compatible ingress',
    description: 'Passes OpenAI-compatible text-to-speech requests through SiftGate audio-capable nodes. Binary audio responses are streamed back as returned by the provider.',
  })
  @ApiConsumes('application/json')
  @ApiBody({ type: AudioSpeechRequestDto })
  @ApiOkResponse({ description: 'OpenAI-compatible speech audio or JSON response.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async audioSpeech(@Req() req: Request, @Res() res: Response) {
    await this.handleMedia(req, res, 'audio_speech');
  }

  private async handleMedia(
    req: Request,
    res: Response,
    sourceFormat: CanonicalMediaSourceFormat,
  ): Promise<void> {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    const abortOnResponseClose = () => {
      if (!res.writableEnded) abort();
    };
    req.on?.('aborted', abort);
    res.on?.('close', abortOnResponseClose);

    try {
      const headers = this.extractHeaders(req);
      const canonical = this.normalizer.normalize(req.body, headers, sourceFormat);
      this.applyGatewayKey(req, canonical);

      this.logger.log(
        `[${this.sourcePath(sourceFormat)}] model=${canonical.model || 'auto'}, multipart=${canonical.is_multipart}`,
      );

      const result = await this.pipeline.processMedia(canonical, {
        signal: abortController.signal,
      });
      this.sendPipelineResult(res, result);
    } catch (err) {
      this.logger.error(`[${this.sourcePath(sourceFormat)}] Error: ${(err as Error).message}`);
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

  private applyGatewayKey(
    req: Request,
    canonical: ReturnType<MediaNormalizer['normalize']>,
  ): void {
    const gatewayKey = (req as unknown as Record<string, unknown>).gatewayApiKey as
      | GatewayKeyContext
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
  }

  private sendPipelineResult(res: Response, result: PipelineResult): void {
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

  private sourcePath(sourceFormat: CanonicalMediaSourceFormat): string {
    switch (sourceFormat) {
      case 'image_generation':
        return 'images/generations';
      case 'image_edit':
        return 'images/edits';
      case 'audio_transcription':
        return 'audio/transcriptions';
      case 'audio_speech':
        return 'audio/speech';
      default:
        return sourceFormat;
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
