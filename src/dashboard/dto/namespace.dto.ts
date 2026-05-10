import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NamespaceBudgetDto {
  @ApiPropertyOptional({ example: 1000000, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  daily_token_limit?: number;

  @ApiPropertyOptional({ example: 25, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  daily_cost_limit?: number;

  @ApiPropertyOptional({ example: 0.8, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  alert_threshold?: number;
}

export class NamespaceRateLimitDto {
  @ApiPropertyOptional({ example: 120, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  requests_per_minute?: number;
}

export class CreateNamespaceDto {
  @ApiProperty({ example: 'team-a', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  id!: string;

  @ApiPropertyOptional({ example: 'Team A', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ type: [String], example: ['openai', 'anthropic'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_nodes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o', 'claude-sonnet-4-20250514'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_models?: string[];

  @ApiPropertyOptional({ type: NamespaceBudgetDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => NamespaceBudgetDto)
  budget?: NamespaceBudgetDto | null;

  @ApiPropertyOptional({ type: NamespaceRateLimitDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => NamespaceRateLimitDto)
  rate_limit?: NamespaceRateLimitDto | null;
}

export class UpdateNamespaceDto {
  @ApiPropertyOptional({ example: 'Team A', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ type: [String], example: ['openai', 'anthropic'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_nodes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['gpt-4o'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_models?: string[];

  @ApiPropertyOptional({ type: NamespaceBudgetDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => NamespaceBudgetDto)
  budget?: NamespaceBudgetDto | null;

  @ApiPropertyOptional({ type: NamespaceRateLimitDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => NamespaceRateLimitDto)
  rate_limit?: NamespaceRateLimitDto | null;
}

export class DeleteNamespaceDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Required when API keys or teams are bound to this Policy Namespace.',
  })
  @IsOptional()
  @IsBoolean()
  confirm_impact?: boolean;
}
