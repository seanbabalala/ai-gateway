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
  ArrayMinSize,
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
  @ArrayMinSize(1)
  models!: string[];

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o-realtime-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  realtime_models?: string[];

  @ApiPropertyOptional({ example: '/v1/realtime' })
  @IsOptional()
  @IsString()
  realtime_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['veo-3-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  video_models?: string[];

  @ApiPropertyOptional({ example: '/v1/videos/generations' })
  @IsOptional()
  @IsString()
  video_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id' })
  @IsOptional()
  @IsString()
  video_status_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/content' })
  @IsOptional()
  @IsString()
  video_content_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/cancel' })
  @IsOptional()
  @IsString()
  video_cancel_endpoint?: string;

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
  @ArrayMinSize(1)
  models?: string[];

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o-realtime-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  realtime_models?: string[];

  @ApiPropertyOptional({ example: '/v1/realtime' })
  @IsOptional()
  @IsString()
  realtime_endpoint?: string;

  @ApiPropertyOptional({ type: [String], example: ['veo-3-preview'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  video_models?: string[];

  @ApiPropertyOptional({ example: '/v1/videos/generations' })
  @IsOptional()
  @IsString()
  video_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id' })
  @IsOptional()
  @IsString()
  video_status_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/content' })
  @IsOptional()
  @IsString()
  video_content_endpoint?: string;

  @ApiPropertyOptional({ example: '/v1/videos/:id/cancel' })
  @IsOptional()
  @IsString()
  video_cancel_endpoint?: string;

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
