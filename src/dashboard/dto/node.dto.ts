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

export class CreateNodeDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsIn(['chat_completions', 'responses', 'messages'])
  protocol!: 'chat_completions' | 'responses' | 'messages';

  @IsString()
  @IsNotEmpty()
  base_url!: string;

  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  api_key!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  models!: string[];

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  model_aliases?: Record<string, string>;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsString()
  @IsIn(['bearer', 'x-api-key'])
  auth_type?: 'bearer' | 'x-api-key';
}

export class TestNodeDto {
  @IsString()
  @IsIn(['chat_completions', 'responses', 'messages'])
  protocol!: 'chat_completions' | 'responses' | 'messages';

  @IsString()
  @IsNotEmpty()
  base_url!: string;

  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  api_key!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsOptional()
  @IsString()
  @IsIn(['bearer', 'x-api-key'])
  auth_type?: 'bearer' | 'x-api-key';

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

export class UpdateNodeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['chat_completions', 'responses', 'messages'])
  protocol?: 'chat_completions' | 'responses' | 'messages';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  base_url?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  endpoint?: string;

  @IsOptional()
  @IsString()
  api_key?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  models?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  timeout_ms?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  model_aliases?: Record<string, string>;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsString()
  @IsIn(['bearer', 'x-api-key'])
  auth_type?: 'bearer' | 'x-api-key';
}
