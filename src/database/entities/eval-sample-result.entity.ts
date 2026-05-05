import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('eval_sample_results')
@Index(['run_id'])
@Index(['sample_hash'])
@Index(['primary_request_id'])
@Index(['candidate_request_id'])
@Index(['judge_request_id'])
export class EvalSampleResult {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  run_id!: string;

  @Column({ type: 'varchar', nullable: true })
  sample_id!: string | null;

  @Column({ type: 'varchar' })
  sample_hash!: string;

  @Column({ type: 'varchar', nullable: true })
  primary_request_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  candidate_request_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  judge_request_id!: string | null;

  @Column({ type: 'integer', nullable: true })
  primary_status_code!: number | null;

  @Column({ type: 'integer', nullable: true })
  candidate_status_code!: number | null;

  @Column({ type: 'boolean', default: false })
  primary_success!: boolean;

  @Column({ type: 'boolean', default: false })
  candidate_success!: boolean;

  @Column({ type: 'integer', default: 0 })
  primary_latency_ms!: number;

  @Column({ type: 'integer', default: 0 })
  candidate_latency_ms!: number;

  @Column({ type: 'real', default: 0 })
  primary_cost_usd!: number;

  @Column({ type: 'real', default: 0 })
  candidate_cost_usd!: number;

  @Column({ type: 'boolean', default: false })
  primary_fallback!: boolean;

  @Column({ type: 'boolean', default: false })
  candidate_fallback!: boolean;

  @Column({ type: 'real', nullable: true })
  judge_score!: number | null;

  @Column({ type: 'varchar', nullable: true })
  judge_label!: string | null;

  @Column({ type: 'text', nullable: true })
  judge_reason_summary!: string | null;

  @Column({ type: 'varchar', nullable: true })
  error_type!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata_json!: string | null;

  @CreateDateColumn()
  created_at!: Date;
}
