import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('batch_jobs')
@Index(['request_id'], { unique: true })
@Index(['provider_batch_id'])
@Index(['status'])
@Index(['workspace_id'])
@Index(['api_key_id'])
@Index(['namespace_id'])
export class BatchJob {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  request_id!: string;

  @Column({ type: 'varchar', nullable: true })
  provider_batch_id!: string | null;

  @Column({ type: 'varchar' })
  node_id!: string;

  @Column({ type: 'varchar', default: 'batch' })
  model!: string;

  @Column({ type: 'varchar', nullable: true })
  endpoint!: string | null;

  @Column({ type: 'varchar', nullable: true })
  input_file_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  output_file_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  error_file_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  completion_window!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata_keys_json!: string | null;

  @Column({ type: 'integer', default: 0 })
  request_counts_total!: number;

  @Column({ type: 'integer', default: 0 })
  request_counts_completed!: number;

  @Column({ type: 'integer', default: 0 })
  request_counts_failed!: number;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  namespace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  namespace_name!: string | null;

  @Column({ type: 'varchar', default: 'validating' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'text', nullable: true })
  expires_at!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
