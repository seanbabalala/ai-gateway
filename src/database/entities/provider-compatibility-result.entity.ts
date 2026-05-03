import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProviderCompatibilityCapability =
  | 'chat'
  | 'responses'
  | 'messages'
  | 'embeddings'
  | 'rerank'
  | 'images'
  | 'audio'
  | 'video'
  | 'realtime';

export type ProviderCompatibilityStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'skipped';

@Entity('provider_compatibility_results')
@Index(['node_id'])
@Index(['capability'])
@Index(['node_id', 'capability'], { unique: true })
export class ProviderCompatibilityResult {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  node_id!: string;

  @Column({ type: 'varchar' })
  capability!: ProviderCompatibilityCapability;

  @Column({ type: 'boolean', default: false })
  configured!: boolean;

  @Column({ type: 'boolean', default: false })
  tested!: boolean;

  @Column({ type: 'varchar', nullable: true })
  last_status!: ProviderCompatibilityStatus | null;

  @Column({ type: 'text', nullable: true })
  last_checked_at!: string | null;

  @Column({ type: 'text', nullable: true })
  failure_reason!: string | null;

  @Column({ type: 'integer', nullable: true })
  latency_ms!: number | null;

  @Column({ type: 'integer', nullable: true })
  status_code!: number | null;

  @Column({ type: 'varchar', nullable: true })
  test_mode!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
