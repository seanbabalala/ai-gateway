import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('call_logs')
@Index(['timestamp'])
@Index(['tier'])
@Index(['node_id'])
@Index(['session_key'])
@Index(['session_id'])
@Index(['trace_id'])
@Index(['experiment_group'])
@Index(['workspace_id'])
@Index(['api_key_name'])
@Index(['api_key_id'])
@Index(['namespace_id'])
@Index(['team_id'])
@Index(['fallback_reason'])
@Index(['agent_connector'])
@Index(['agent_profile_id'])
@Index(['agent_session_id'])
@Index(['agent_repo'])
@Index(['agent_project'])
@Index(['intelligence_optimizer_applied'])
@Index(['quality_gate_status'])
export class CallLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  request_id!: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  source_format!: string; // chat_completions | responses | messages | embeddings | rerank | image_* | audio_* | video_*

  @Column({ type: 'varchar' })
  tier!: string; // simple | standard | complex | reasoning

  @Column({ type: 'real' })
  score!: number;

  @Column({ type: 'varchar' })
  node_id!: string;

  @Column({ type: 'varchar' })
  model!: string;

  @Column({ type: 'integer', default: 0 })
  input_tokens!: number;

  @Column({ type: 'integer', default: 0 })
  output_tokens!: number;

  @Column({ type: 'real', default: 0 })
  cost_usd!: number;

  @Column({ type: 'real', nullable: true, default: null })
  cost_without_cache_usd!: number | null;

  @Column({ type: 'integer', default: 0 })
  latency_ms!: number;

  @Column({ type: 'boolean', default: false })
  stream!: boolean;

  @Column({ type: 'integer', default: 200 })
  status_code!: number;

  @Column({ type: 'boolean', default: false })
  is_fallback!: boolean;

  @Column({ type: 'varchar', nullable: true })
  fallback_reason!: string | null;

  @Column({ type: 'boolean', default: false })
  structured_output_requested!: boolean;

  @Column({ type: 'varchar', nullable: true })
  structured_output_type!: string | null;

  @Column({ type: 'varchar', nullable: true })
  structured_output_strategy!: string | null;

  @Column({ type: 'boolean', nullable: true })
  structured_output_supported!: boolean | null;

  @Column({ type: 'varchar', nullable: true })
  structured_output_schema_name!: string | null;

  @Column({ type: 'boolean', default: false })
  reasoning_requested!: boolean;

  @Column({ type: 'varchar', nullable: true })
  reasoning_effort!: string | null;

  @Column({ type: 'varchar', nullable: true })
  reasoning_strategy!: string | null;

  @Column({ type: 'boolean', nullable: true })
  reasoning_supported!: boolean | null;

  @Column({ type: 'integer', nullable: true })
  reasoning_budget_tokens!: number | null;

  @Column({ type: 'varchar', nullable: true })
  reasoning_source!: string | null;

  @Column({ type: 'text', nullable: true })
  reasoning_reason!: string | null;

  @Column({ type: 'varchar', nullable: true })
  media_type!: string | null;

  @Column({ type: 'varchar', nullable: true })
  media_operation!: string | null;

  @Column({ type: 'boolean', nullable: true })
  media_multipart!: boolean | null;

  @Column({ type: 'integer', nullable: true })
  media_file_count!: number | null;

  @Column({ type: 'integer', nullable: true })
  media_byte_size!: number | null;

  @Column({ type: 'varchar', nullable: true })
  media_requested_format!: string | null;

  @Column({ type: 'varchar', nullable: true })
  media_response_format!: string | null;

  @Column({ type: 'varchar', nullable: true })
  media_provider_response_type!: string | null;

  @Column({ type: 'varchar', nullable: true })
  session_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  session_key!: string | null;

  @Column({ type: 'varchar', nullable: true })
  trace_id!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  namespace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  team_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_connector!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_profile_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_profile_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_virtual_model!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_requested_model!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_session_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_turn_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_repo!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agent_project!: string | null;

  @Column({ type: 'integer', default: 0 })
  retry_count!: number;

  @Column({ type: 'integer', default: 0 })
  cache_creation_input_tokens!: number;

  @Column({ type: 'integer', default: 0 })
  cache_read_input_tokens!: number;

  @Column({ type: 'boolean', default: false })
  semantic_cache_hit!: boolean;

  @Column({ type: 'real', nullable: true })
  semantic_cache_score!: number | null;

  @Column({ type: 'varchar', nullable: true })
  experiment_group!: string | null;

  @Column({ type: 'boolean', default: false })
  intelligence_optimizer_applied!: boolean;

  @Column({ type: 'real', nullable: true })
  intelligence_estimated_cost_usd!: number | null;

  @Column({ type: 'real', nullable: true })
  intelligence_estimated_savings_usd!: number | null;

  @Column({ type: 'varchar', nullable: true })
  token_prediction_risk!: string | null;

  @Column({ type: 'varchar', nullable: true })
  quality_gate_status!: string | null;

  @Column({ type: 'boolean', default: false })
  async_eval_queued!: boolean;
}
