import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsUrl,
  IsArray,
  IsNumber,
  IsOptional,
  IsObject,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({ example: 60000, minimum: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms!: number;

  @ApiPropertyOptional({ type: [String], example: ['coding', 'reasoning'] })
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

  @ApiPropertyOptional({ example: 60000, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms?: number;

  @ApiPropertyOptional({ type: [String], example: ['coding', 'reasoning'] })
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
}
