import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiProperty({ example: 'Invalid API key' })
  message!: string;

  @ApiPropertyOptional({ example: 'invalid_request_error' })
  type?: string;

  @ApiPropertyOptional({ example: 'budget_exceeded' })
  code?: string;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ type: ErrorDetailDto })
  error!: ErrorDetailDto;
}

export class ActionResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Operation completed' })
  message!: string;
}

export class LoginRequestDto {
  @ApiProperty({
    example: 'dashboard-password',
    format: 'password',
    writeOnly: true,
  })
  password!: string;
}

export class LoginResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.redacted',
    description: 'Dashboard session JWT. Example is redacted.',
  })
  token!: string;
}

export class AuthStatusResponseDto {
  @ApiProperty({ example: true })
  authRequired!: boolean;
}

export class ChatCompletionsRequestDto {
  @ApiProperty({ example: 'auto', description: 'Use "auto" for SiftGate smart routing or a direct model/node name.' })
  model!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ role: 'user', content: 'Hello from SiftGate' }],
  })
  messages!: unknown[];

  @ApiPropertyOptional({ example: false })
  stream?: boolean;

  @ApiPropertyOptional({ example: 512 })
  max_tokens?: number;

  @ApiPropertyOptional({ example: 0.7 })
  temperature?: number;

  @ApiPropertyOptional({ example: 1 })
  top_p?: number;

  @ApiPropertyOptional({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['END'],
  })
  stop?: string | string[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object' },
    description: 'OpenAI-compatible tool definitions.',
  })
  tools?: unknown[];

  @ApiPropertyOptional({
    oneOf: [{ type: 'string' }, { type: 'object' }],
    example: 'auto',
  })
  tool_choice?: unknown;
}

export class ResponsesRequestDto {
  @ApiProperty({ example: 'auto' })
  model!: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
    example: 'Summarize this request.',
  })
  input!: string | unknown[];

  @ApiPropertyOptional({ example: 'You are concise.' })
  instructions?: string;

  @ApiPropertyOptional({ example: false })
  stream?: boolean;

  @ApiPropertyOptional({ example: 512 })
  max_output_tokens?: number;

  @ApiPropertyOptional({ example: 0.7 })
  temperature?: number;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object' },
    description: 'OpenAI Responses tool definitions.',
  })
  tools?: unknown[];
}

export class AnthropicMessagesRequestDto {
  @ApiProperty({ example: 'auto' })
  model!: string;

  @ApiPropertyOptional({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
    example: 'You are concise.',
  })
  system?: string | unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ role: 'user', content: 'Hello from SiftGate' }],
  })
  messages!: unknown[];

  @ApiProperty({ example: 1024 })
  max_tokens!: number;

  @ApiPropertyOptional({ example: false })
  stream?: boolean;

  @ApiPropertyOptional({ example: 0.7 })
  temperature?: number;

  @ApiPropertyOptional({ type: [String], example: ['END'] })
  stop_sequences?: string[];
}

export class EmbeddingsRequestDto {
  @ApiProperty({ example: 'auto', description: 'Use "auto" for cost-aware embedding routing or a configured embedding model.' })
  model!: string;

  @ApiProperty({
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
      { type: 'array', items: { type: 'number' } },
      { type: 'array', items: { type: 'array', items: { type: 'number' } } },
    ],
    example: ['SiftGate routes AI traffic.', 'Embeddings are useful for search.'],
  })
  input!: string | string[] | number[] | number[][];

  @ApiPropertyOptional({ example: 1536 })
  dimensions?: number;

  @ApiPropertyOptional({ example: 'float' })
  encoding_format?: string;

  @ApiPropertyOptional({ example: 'user-123' })
  user?: string;
}

export class RerankRequestDto {
  @ApiProperty({ example: 'auto', description: 'Use "auto" for cost-aware rerank routing or a configured rerank model.' })
  model!: string;

  @ApiProperty({ example: 'What is SiftGate?' })
  query!: string;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { type: 'string' },
        { type: 'object' },
      ],
    },
    example: [
      'SiftGate is a self-hosted AI traffic gateway.',
      'A database migration tool moves SQLite data into PostgreSQL.',
    ],
  })
  documents!: Array<string | Record<string, unknown>>;

  @ApiPropertyOptional({ example: 3 })
  top_n?: number;

  @ApiPropertyOptional({ example: true })
  return_documents?: boolean;
}

export class ModelItemDto {
  @ApiProperty({ example: 'gpt-4o' })
  id!: string;

  @ApiProperty({ example: 'model' })
  object!: string;

  @ApiProperty({ example: 0 })
  created!: number;

  @ApiProperty({ example: 'openai' })
  owned_by!: string;

  @ApiPropertyOptional({ example: 'OpenAI Main Account' })
  node_name?: string;

  @ApiPropertyOptional({ type: [String], example: ['gpt4'] })
  aliases?: string[];

  @ApiPropertyOptional({ example: true })
  is_alias?: boolean;

  @ApiPropertyOptional({ example: 'gpt-4o' })
  resolves_to?: string;
}

export class ModelListResponseDto {
  @ApiProperty({ example: 'list' })
  object!: string;

  @ApiProperty({ type: [ModelItemDto] })
  data!: ModelItemDto[];
}

export class HealthModelCircuitDto {
  @ApiProperty({ example: 'CLOSED' })
  state!: string;

  @ApiProperty({ example: 0 })
  consecutiveFailures!: number;

  @ApiProperty({ example: null, nullable: true })
  lastFailureAt!: string | null;
}

export class HealthNodeDto {
  @ApiProperty({ example: 'openai' })
  id!: string;

  @ApiProperty({ example: 'OpenAI' })
  name!: string;

  @ApiProperty({ example: 'chat_completions' })
  protocol!: string;

  @ApiProperty({ example: 'CLOSED' })
  circuit!: string;

  @ApiProperty({ example: 0 })
  consecutiveFailures!: number;

  @ApiProperty({ example: null, nullable: true })
  lastFailureAt!: string | null;

  @ApiProperty({ example: true })
  healthy!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/HealthModelCircuitDto' },
  })
  models!: Record<string, HealthModelCircuitDto>;
}

export class HealthBudgetDto {
  @ApiProperty({ example: 'daily_tokens' })
  type!: string;

  @ApiProperty({ example: 1200 })
  current!: number;

  @ApiProperty({ example: 5000000 })
  limit!: number;

  @ApiProperty({ example: 12.4 })
  percentage!: number;

  @ApiProperty({ example: false })
  exceeded!: boolean;

  @ApiProperty({ example: false })
  alert!: boolean;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['healthy', 'degraded'], example: 'healthy' })
  status!: 'healthy' | 'degraded';

  @ApiProperty({ example: 12345 })
  uptime_ms!: number;

  @ApiProperty({ example: '12s' })
  uptime_human!: string;

  @ApiProperty({ example: '2026-05-02T04:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: [HealthNodeDto] })
  nodes!: HealthNodeDto[];

  @ApiProperty({ type: [HealthBudgetDto] })
  budget!: HealthBudgetDto[];
}

export class SanitizedNodeConfigDto {
  @ApiProperty({ example: 'openai' })
  id!: string;

  @ApiProperty({ example: 'OpenAI' })
  name!: string;

  @ApiProperty({ example: 'chat_completions' })
  protocol!: string;

  @ApiProperty({ example: 'https://api.openai.com' })
  base_url!: string;

  @ApiProperty({ example: '/v1/chat/completions' })
  endpoint!: string;

  @ApiProperty({
    example: 'sk-live...',
    description: 'Masked provider key. The full provider API key is never returned.',
    readOnly: true,
  })
  api_key!: string;

  @ApiProperty({ type: [String], example: ['gpt-4o', 'gpt-4o-mini'] })
  models!: string[];
}

export class SanitizedConfigResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true, example: { port: 2099, host: '0.0.0.0' } })
  server!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { type: 'sqlite' } })
  database!: { type: string };

  @ApiProperty({ type: 'object', additionalProperties: true, example: { api_keys: [], managed_in_dashboard: true } })
  auth!: Record<string, unknown>;

  @ApiProperty({ type: [SanitizedNodeConfigDto] })
  nodes!: SanitizedNodeConfigDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  routing!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  budget!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  models_pricing!: Record<string, unknown>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  diagnostics!: unknown[];
}

export class GatewayApiKeyTodayDto {
  @ApiProperty({ example: 10 })
  calls!: number;

  @ApiProperty({ example: 0.123456 })
  cost_usd!: number;

  @ApiProperty({ example: 1200 })
  input_tokens!: number;

  @ApiProperty({ example: 400 })
  output_tokens!: number;
}

export class GatewayApiKeySummaryDto {
  @ApiProperty({ example: 'key_01h...' })
  id!: string;

  @ApiProperty({ example: 'production-app' })
  name!: string;

  @ApiProperty({ example: null, nullable: true })
  description!: string | null;

  @ApiProperty({ example: 'gw_sk_live_abcd...wxyz' })
  key_prefix!: string;

  @ApiProperty({ enum: ['active', 'disabled'], example: 'active' })
  status!: string;

  @ApiProperty({ example: true })
  allow_auto!: boolean;

  @ApiProperty({ example: false })
  allow_direct!: boolean;

  @ApiProperty({ type: [String], example: [] })
  allowed_nodes!: string[];

  @ApiProperty({ type: [String], example: [] })
  allowed_models!: string[];

  @ApiProperty({ example: null, nullable: true })
  namespace_id!: string | null;

  @ApiProperty({ example: null, nullable: true })
  namespace_name!: string | null;

  @ApiProperty({ example: null, nullable: true })
  daily_token_limit!: number | null;

  @ApiProperty({ example: null, nullable: true })
  daily_cost_limit!: number | null;

  @ApiProperty({ example: null, nullable: true })
  rate_limit_per_minute!: number | null;

  @ApiProperty({ type: GatewayApiKeyTodayDto })
  today!: GatewayApiKeyTodayDto;
}

export class GatewayApiKeyListResponseDto {
  @ApiProperty({ type: [String], example: ['production-app'] })
  keys!: string[];

  @ApiProperty({ type: [GatewayApiKeySummaryDto] })
  items!: GatewayApiKeySummaryDto[];
}

export class GatewayApiKeyMutationResponseDto extends ActionResponseDto {
  @ApiProperty({ type: GatewayApiKeySummaryDto })
  item!: GatewayApiKeySummaryDto;
}

export class GatewayApiKeyCreatedResponseDto extends GatewayApiKeyMutationResponseDto {
  @ApiProperty({
    example: 'gw_sk_live_example_redacted',
    description: 'Plain Gateway API key returned once. Example is redacted.',
  })
  key!: string;
}
