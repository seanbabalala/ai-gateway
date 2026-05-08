import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('route_decisions')
@Index(['timestamp'])
@Index(['source_format'])
@Index(['tier'])
@Index(['selected_node_id'])
@Index(['selected_model'])
@Index(['workspace_id'])
@Index(['api_key_id'])
@Index(['namespace_id'])
@Index(['session_id'])
@Index(['trace_id'])
@Index(['agent_connector'])
@Index(['agent_profile_id'])
@Index(['agent_session_id'])
@Index(['intelligence_optimizer_applied'])
@Index(['quality_gate_status'])
export class RouteDecisionLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  request_id!: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  source_format!: string;

  @Column({ type: 'varchar' })
  tier!: string;

  @Column({ type: 'real' })
  score!: number;

  @Column({ type: 'varchar', nullable: true })
  route_mode!: string | null;

  @Column({ type: 'varchar', nullable: true })
  strategy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  selected_node_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  selected_model!: string | null;

  @Column({ type: 'varchar', nullable: true })
  domain_hint!: string | null;

  @Column({ type: 'integer', default: 0 })
  candidate_count!: number;

  @Column({ type: 'integer', default: 0 })
  filtered_count!: number;

  @Column({ type: 'integer', default: 200 })
  status_code!: number;

  @Column({ type: 'boolean', default: false })
  is_fallback!: boolean;

  @Column({ type: 'varchar', nullable: true })
  fallback_reason!: string | null;

  @Column({ type: 'varchar', nullable: true })
  session_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  trace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  namespace_id!: string | null;

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

  @Column({ type: 'boolean', default: false })
  intelligence_optimizer_applied!: boolean;

  @Column({ type: 'varchar', nullable: true })
  token_prediction_risk!: string | null;

  @Column({ type: 'varchar', nullable: true })
  quality_gate_status!: string | null;

  @Column({ type: 'boolean', default: false })
  async_eval_queued!: boolean;

  @Column({ type: 'text' })
  trace_json!: string;
}
