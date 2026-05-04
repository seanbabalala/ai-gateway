import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsUrl,
  IsArray,
  IsNumber,
  IsOptional,
  IsObject,
  IsBoolean,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthCheckDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  interval_seconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms?: number;

  @IsOptional()
  @IsString()
  @IsIn(['HEAD', 'GET', 'POST'])
  method?: 'HEAD' | 'GET' | 'POST';

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  lightweight_model?: string;
}

export class CreateNodeDto {
  @ApiProperty({ example: 'openai', description: 'Stable upstream provider, account, deployment, or proxy route id.' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 'OpenAI Main Account' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: ['chat_completions', 'responses', 'messages'], example: 'chat_completions' })
  @IsString()
  @IsIn(['chat_completions', 'responses', 'messages'])
  protocol!: 'chat_completions' | 'responses' | 'messages';

  @ApiProperty({ example: 'https://api.openai.com' })
  @IsString()
  @IsNotEmpty()
  base_url!: string;

  @ApiProperty({ example: '/v1/chat/completions' })
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ApiProperty({
    example: '${OPENAI_API_KEY}',
    format: 'password',
    writeOnly: true,
    description: 'Provider API key or environment reference. Full values are never returned by config APIs.',
  })
  @IsString()
  @IsNotEmpty()
  api_key!: string;

  @ApiProperty({ type: [String], example: ['gpt-4o', 'gpt-4o-mini'] })
  @IsArray()
  @IsString({ each: true })
  models!: string[];

  @ApiPropertyOptional({ type: [String], example: ['text-embedding-3-small'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  embedding_models?: string[];

  @ApiPropertyOptional({ example: '/v1/embeddings' })
  @IsOptional()
  @IsString()
  embeddings_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['rerank-v3.5'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rerank_models?: string[];

  @ApiPropertyOptional({ example: '/v1/rerank' })
  @IsOptional()
  @IsString()
  rerank_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-image-1'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_models?: string[];

  @ApiPropertyOptional({ example: '/v1/images/generations' })
  @IsOptional()
  @IsString()
  images_generations_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/images/edits' })
  @IsOptional()
  @IsString()
  images_edits_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/images/variations' })
  @IsOptional()
  @IsString()
  images_variations_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o-mini-transcribe', 'tts-1'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audio_models?: string[];

  @ApiPropertyOptional({ example: '/v1/audio/transcriptions' })
  @IsOptional()
  @IsString()
  audio_transcriptions_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/audio/translations' })
  @IsOptional()
  @IsString()
  audio_translations_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/audio/speech' })
  @IsOptional()
  @IsString()
  audio_speech_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['veo-3.1-generate-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  video_models?: string[];

  @ApiPropertyOptional({ example: '/v1/videos/generations' })
  @IsOptional()
  @IsString()
  video_generations_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/{id}' })
  @IsOptional()
  @IsString()
  video_status_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o-realtime-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  realtime_models?: string[];

  @ApiPropertyOptional({ example: '/v1/realtime' })
  @IsOptional()
  @IsString()
  realtime_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/generations' })
  @IsOptional()
  @IsString()
  video_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/content' })
  @IsOptional()
  @IsString()
  video_content_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/cancel' })
  @IsOptional()
  @IsString()
  video_cancel_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/batches' })
  @IsOptional()
  @IsString()
  batch_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/batches/:id' })
  @IsOptional()
  @IsString()
  batch_status_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/batches/:id/cancel' })
  @IsOptional()
  @IsString()
  batch_cancel_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/files/:id/content' })
  @IsOptional()
  @IsString()
  batch_result_endpoint?: string;

  @ApiProperty({ example: 60000, minimum: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms!: number;

  @ApiPropertyOptional({ type: [String], example: ['coding', 'reasoning'] })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  max_concurrency?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  queue_timeout_ms?: number;

  @IsOptional()
  @IsString()
  @IsIn(['wait', 'fallback', 'reject'])
  queue_policy?: 'wait' | 'fallback' | 'reject';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['text', 'vision'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modalities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['backend', 'reasoning'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { fast: 'gpt-4o-mini' } })
  @IsOptional()
  @IsObject()
  model_aliases?: Record<string, string>;

  @ApiPropertyOptional({ type: [String], example: ['gpt'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  model_prefixes?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'anthropic-version': '2023-06-01' },
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({
    type: 'object',
    description: 'Optional per-model capability and pricing overrides keyed by model id.',
    additionalProperties: { type: 'object' },
    example: { 'gpt-4o-mini': { pricing: { input: 0.15, output: 0.6 } } },
  })
  @IsOptional()
  @IsObject()
  model_capabilities?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['bearer', 'x-api-key'], example: 'bearer' })
  @IsOptional()
  @IsString()
  @IsIn(['bearer', 'x-api-key'])
  auth_type?: 'bearer' | 'x-api-key';

  @IsOptional()
  @ValidateNested()
  @Type(() => HealthCheckDto)
  health_check?: HealthCheckDto;
}

export class TestNodeDto {
  @ApiProperty({ enum: ['chat_completions', 'responses', 'messages'], example: 'chat_completions' })
  @IsString()
  @IsIn(['chat_completions', 'responses', 'messages'])
  protocol!: 'chat_completions' | 'responses' | 'messages';

  @ApiProperty({ example: 'https://api.openai.com' })
  @IsString()
  @IsNotEmpty()
  base_url!: string;

  @ApiProperty({ example: '/v1/chat/completions' })
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ApiProperty({
    example: '${OPENAI_API_KEY}',
    format: 'password',
    writeOnly: true,
    description: 'Provider API key or environment reference used only for this connectivity test.',
  })
  @IsString()
  @IsNotEmpty()
  api_key!: string;

  @ApiProperty({ example: 'gpt-4o-mini' })
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiPropertyOptional({ enum: ['bearer', 'x-api-key'], example: 'bearer' })
  @IsOptional()
  @IsString()
  @IsIn(['bearer', 'x-api-key'])
  auth_type?: 'bearer' | 'x-api-key';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'anthropic-version': '2023-06-01' },
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({
    type: [String],
    enum: ['chat', 'responses', 'messages', 'embeddings', 'rerank', 'images', 'audio', 'video', 'realtime'],
    description: 'Optional provider capabilities to test. Omit to test the primary protocol capability for unsaved nodes.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(['chat', 'responses', 'messages', 'embeddings', 'rerank', 'images', 'audio', 'video', 'realtime'], { each: true })
  capabilities?: Array<'chat' | 'responses' | 'messages' | 'embeddings' | 'rerank' | 'images' | 'audio' | 'video' | 'realtime'>;

  @ApiPropertyOptional({
    example: false,
    description: 'Must be true before running expensive generation or long-connection compatibility tests.',
  })
  @IsOptional()
  @IsBoolean()
  confirm_expensive?: boolean;
}

export class UpdateNodeDto {
  @ApiPropertyOptional({ example: 'OpenAI Main Account' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: ['chat_completions', 'responses', 'messages'], example: 'chat_completions' })
  @IsOptional()
  @IsString()
  @IsIn(['chat_completions', 'responses', 'messages'])
  protocol?: 'chat_completions' | 'responses' | 'messages';

  @ApiPropertyOptional({ example: 'https://api.openai.com' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  base_url?: string;

  @ApiPropertyOptional({ example: '/v1/chat/completions' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  endpoint?: string;

  @ApiPropertyOptional({
    example: '${OPENAI_API_KEY}',
    format: 'password',
    writeOnly: true,
    description: 'Provider API key or environment reference. Full values are never returned by config APIs.',
  })
  @IsOptional()
  @IsString()
  api_key?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o', 'gpt-4o-mini'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: string[];

  @ApiPropertyOptional({ type: [String], example: ['text-embedding-3-small'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  embedding_models?: string[];

  @ApiPropertyOptional({ example: '/v1/embeddings' })
  @IsOptional()
  @IsString()
  embeddings_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['rerank-v3.5'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rerank_models?: string[];

  @ApiPropertyOptional({ example: '/v1/rerank' })
  @IsOptional()
  @IsString()
  rerank_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-image-1'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_models?: string[];

  @ApiPropertyOptional({ example: '/v1/images/generations' })
  @IsOptional()
  @IsString()
  images_generations_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/images/edits' })
  @IsOptional()
  @IsString()
  images_edits_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/images/variations' })
  @IsOptional()
  @IsString()
  images_variations_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o-mini-transcribe', 'tts-1'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audio_models?: string[];

  @ApiPropertyOptional({ example: '/v1/audio/transcriptions' })
  @IsOptional()
  @IsString()
  audio_transcriptions_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/audio/translations' })
  @IsOptional()
  @IsString()
  audio_translations_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/audio/speech' })
  @IsOptional()
  @IsString()
  audio_speech_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['veo-3.1-generate-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  video_models?: string[];

  @ApiPropertyOptional({ example: '/v1/videos/generations' })
  @IsOptional()
  @IsString()
  video_generations_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/{id}' })
  @IsOptional()
  @IsString()
  video_status_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o-realtime-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  realtime_models?: string[];

  @ApiPropertyOptional({ example: '/v1/realtime' })
  @IsOptional()
  @IsString()
  realtime_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/generations' })
  @IsOptional()
  @IsString()
  video_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/content' })
  @IsOptional()
  @IsString()
  video_content_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/cancel' })
  @IsOptional()
  @IsString()
  video_cancel_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/batches' })
  @IsOptional()
  @IsString()
  batch_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/batches/:id' })
  @IsOptional()
  @IsString()
  batch_status_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/batches/:id/cancel' })
  @IsOptional()
  @IsString()
  batch_cancel_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/files/:id/content' })
  @IsOptional()
  @IsString()
  batch_result_endpoint?: string;

  @ApiPropertyOptional({ example: 60000, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms?: number;

  @ApiPropertyOptional({ type: [String], example: ['coding', 'reasoning'] })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  max_concurrency?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  queue_timeout_ms?: number;

  @IsOptional()
  @IsString()
  @IsIn(['wait', 'fallback', 'reject'])
  queue_policy?: 'wait' | 'fallback' | 'reject';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['text', 'vision'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modalities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['backend', 'reasoning'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { fast: 'gpt-4o-mini' } })
  @IsOptional()
  @IsObject()
  model_aliases?: Record<string, string>;

  @ApiPropertyOptional({ type: [String], example: ['gpt'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  model_prefixes?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'anthropic-version': '2023-06-01' },
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({
    type: 'object',
    description: 'Optional per-model capability and pricing overrides keyed by model id.',
    additionalProperties: { type: 'object' },
    example: { 'gpt-4o-mini': { pricing: { input: 0.15, output: 0.6 } } },
  })
  @IsOptional()
  @IsObject()
  model_capabilities?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['bearer', 'x-api-key'], example: 'bearer' })
  @IsOptional()
  @IsString()
  @IsIn(['bearer', 'x-api-key'])
  auth_type?: 'bearer' | 'x-api-key';

  @IsOptional()
  @ValidateNested()
  @Type(() => HealthCheckDto)
  health_check?: HealthCheckDto;
}
