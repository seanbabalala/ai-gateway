import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  AGENT_PROFILE_BASE_URL_MODES,
  AGENT_PROFILE_CONNECTORS,
  AGENT_PROFILE_STATUSES,
  AgentProfileBaseUrlMode,
  AgentProfileConnector,
  AgentProfileStatus,
} from '../../database/entities/agent-profile.entity';

export class CreateAgentProfileDto {
  @ApiProperty({ example: 'Claude Code local', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: 'Claude Code profile using SiftGate smart routing',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ enum: AGENT_PROFILE_CONNECTORS, example: 'claude_code' })
  @IsIn(AGENT_PROFILE_CONNECTORS)
  connector!: AgentProfileConnector;

  @ApiPropertyOptional({ enum: AGENT_PROFILE_STATUSES, example: 'active' })
  @IsOptional()
  @IsIn(AGENT_PROFILE_STATUSES)
  status?: AgentProfileStatus;

  @ApiPropertyOptional({
    example: 'key_01h...',
    nullable: true,
    description: 'Dashboard-managed Gateway API key id. Plain key material is never stored here.',
  })
  @IsOptional()
  @IsString()
  api_key_id?: string | null;

  @ApiPropertyOptional({
    example: 'team-alpha',
    nullable: true,
    description: 'Optional local OSS namespace binding.',
  })
  @IsOptional()
  @IsString()
  namespace_id?: string | null;

  @ApiPropertyOptional({ example: 'auto', default: 'auto' })
  @IsOptional()
  @IsString()
  default_model?: string;

  @ApiPropertyOptional({
    example: 'claude-siftgate-auto',
    description: 'Connector-facing smart routing model id.',
  })
  @IsOptional()
  @IsString()
  smart_model_id?: string;

  @ApiPropertyOptional({
    enum: AGENT_PROFILE_BASE_URL_MODES,
    example: 'anthropic_v1',
  })
  @IsOptional()
  @IsIn(AGENT_PROFILE_BASE_URL_MODES)
  base_url_mode?: AgentProfileBaseUrlMode;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Advisory routing hints. Policy checks are still enforced.',
  })
  @IsOptional()
  @IsObject()
  routing_hint?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['filesystem', 'git'],
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mcp_server_ids?: string[] | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class UpdateAgentProfileDto {
  @ApiPropertyOptional({ example: 'Claude Code local', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'Updated profile description', nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ enum: AGENT_PROFILE_CONNECTORS, example: 'claude_code' })
  @IsOptional()
  @IsIn(AGENT_PROFILE_CONNECTORS)
  connector?: AgentProfileConnector;

  @ApiPropertyOptional({ enum: AGENT_PROFILE_STATUSES, example: 'active' })
  @IsOptional()
  @IsIn(AGENT_PROFILE_STATUSES)
  status?: AgentProfileStatus;

  @ApiPropertyOptional({ example: 'key_01h...', nullable: true })
  @IsOptional()
  @IsString()
  api_key_id?: string | null;

  @ApiPropertyOptional({ example: 'team-alpha', nullable: true })
  @IsOptional()
  @IsString()
  namespace_id?: string | null;

  @ApiPropertyOptional({ example: 'auto' })
  @IsOptional()
  @IsString()
  default_model?: string;

  @ApiPropertyOptional({ example: 'claude-siftgate-auto' })
  @IsOptional()
  @IsString()
  smart_model_id?: string;

  @ApiPropertyOptional({
    enum: AGENT_PROFILE_BASE_URL_MODES,
    example: 'anthropic_v1',
  })
  @IsOptional()
  @IsIn(AGENT_PROFILE_BASE_URL_MODES)
  base_url_mode?: AgentProfileBaseUrlMode;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  routing_hint?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mcp_server_ids?: string[] | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class RenderAgentProfileDto {
  @ApiPropertyOptional({
    example: 'http://localhost:2099',
    description: 'Optional externally reachable SiftGate base URL used in rendered examples.',
  })
  @IsOptional()
  @IsString()
  gateway_base_url?: string;
}
