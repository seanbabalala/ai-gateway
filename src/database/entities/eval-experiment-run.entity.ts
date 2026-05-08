import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EvalExperimentStatus = 'queued' | 'running' | 'completed' | 'failed';

@Entity('eval_experiment_runs')
@Index(['workspace_id'])
@Index(['dataset_id'])
@Index(['status'])
@Index(['created_at'])
@Index(['primary_node_id'])
@Index(['candidate_node_id'])
export class EvalExperimentRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  dataset_id!: string | null;

  @Column({ type: 'varchar' })
  dataset_name!: string;

  @Column({ type: 'varchar', nullable: true })
  judge_node_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  judge_model!: string | null;

  @Column({ type: 'varchar', nullable: true })
  primary_node_id!: string | null;

  @Column({ type: 'varchar' })
  primary_model!: string;

  @Column({ type: 'varchar', nullable: true })
  candidate_node_id!: string | null;

  @Column({ type: 'varchar' })
  candidate_model!: string;

  @Column({ type: 'varchar', default: 'queued' })
  status!: EvalExperimentStatus;

  @Column({ type: 'integer', default: 0 })
  sample_count!: number;

  @Column({ type: 'real', default: 0 })
  primary_success_rate!: number;

  @Column({ type: 'real', default: 0 })
  candidate_success_rate!: number;

  @Column({ type: 'real', default: 0 })
  primary_avg_latency_ms!: number;

  @Column({ type: 'real', default: 0 })
  candidate_avg_latency_ms!: number;

  @Column({ type: 'real', default: 0 })
  primary_total_cost_usd!: number;

  @Column({ type: 'real', default: 0 })
  candidate_total_cost_usd!: number;

  @Column({ type: 'real', default: 0 })
  primary_fallback_rate!: number;

  @Column({ type: 'real', default: 0 })
  candidate_fallback_rate!: number;

  @Column({ type: 'real', nullable: true })
  avg_judge_score!: number | null;

  @Column({ type: 'varchar', nullable: true })
  winner!: 'primary' | 'candidate' | 'tie' | null;

  @Column({ type: 'text', nullable: true })
  summary_json!: string | null;

  @Column({ type: 'text', nullable: true })
  judge_config_json!: string | null;

  @Column({ type: 'text', nullable: true })
  privacy_json!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'text', nullable: true })
  started_at!: string | null;

  @Column({ type: 'text', nullable: true })
  completed_at!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
