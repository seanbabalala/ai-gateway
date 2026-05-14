import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PROVIDER_PROTOCOLS = ['chat_completions', 'responses', 'messages', 'gemini'] as const;
const PROVIDER_AUTH_TYPES = ['bearer', 'x-api-key', 'custom-header', 'none'] as const;

export class ProviderTemplatePricingRowDto {
  @ApiProperty({ example: 'custom-chat-model' })
  @IsString()
  model!: string;

  @ApiPropertyOptional({ example: 0.25 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  input_per_1m_tokens?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  output_per_1m_tokens?: number;

  @ApiPropertyOptional({ example: 'https://provider.example/pricing' })
  @IsOptional()
  @IsString()
  source_url?: string;

  @ApiPropertyOptional({ example: 'operator_review' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class ProviderHealthProbeConfigDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ['HEAD', 'GET', 'POST'], example: 'HEAD' })
  @IsOptional()
  @IsString()
  @IsIn(['HEAD', 'GET', 'POST'])
  method?: 'HEAD' | 'GET' | 'POST';

  @ApiPropertyOptional({ example: '/health' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ example: 'custom-fast-model' })
  @IsOptional()
  @IsString()
  lightweight_model?: string;
}

export class CustomProviderTemplatePreviewDto {
  @ApiProperty({ example: 'custom-acme' })
  @IsString()
  provider_id!: string;

  @ApiProperty({ example: 'Acme AI' })
  @IsString()
  provider_name!: string;

  @ApiProperty({ example: 'https://api.acme.ai' })
  @IsString()
  base_url!: string;

  @ApiProperty({ enum: PROVIDER_PROTOCOLS, example: 'chat_completions' })
  @IsString()
  @IsIn(PROVIDER_PROTOCOLS)
  protocol!: (typeof PROVIDER_PROTOCOLS)[number];

  @ApiPropertyOptional({ enum: PROVIDER_AUTH_TYPES, example: 'custom-header' })
  @IsOptional()
  @IsString()
  @IsIn(PROVIDER_AUTH_TYPES)
  auth_type?: (typeof PROVIDER_AUTH_TYPES)[number];

  @ApiPropertyOptional({ example: 'api-key' })
  @IsOptional()
  @IsString()
  auth_header_name?: string;

  @ApiPropertyOptional({ example: 'Bearer' })
  @IsOptional()
  @IsString()
  auth_header_prefix?: string;

  @ApiPropertyOptional({
    example: {
      chat_completions: '/v1/chat/completions',
      embeddings: '/v1/embeddings',
    },
  })
  @IsOptional()
  @IsObject()
  endpoints?: Record<string, string>;

  @ApiProperty({ type: [String], example: ['custom-chat-model'] })
  @IsArray()
  @IsString({ each: true })
  models!: string[];

  @ApiPropertyOptional({ type: [String], example: ['openai_compatible'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compatibility_profiles?: string[];

  @ApiPropertyOptional({ type: [String], example: ['coding', 'fast'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['custom', 'internal'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [ProviderTemplatePricingRowDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProviderTemplatePricingRowDto)
  pricing?: ProviderTemplatePricingRowDto[];

  @ApiPropertyOptional({ type: ProviderHealthProbeConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderHealthProbeConfigDto)
  health_probe?: ProviderHealthProbeConfigDto;
}

export class ProviderSdkGeneratorDto extends CustomProviderTemplatePreviewDto {
  @ApiPropertyOptional({ example: 'typescript' })
  @IsOptional()
  @IsString()
  @IsIn(['typescript'])
  language?: 'typescript';
}
