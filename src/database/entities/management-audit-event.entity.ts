import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ManagementAuditResult = 'success' | 'failure' | 'denied';

@Entity('management_audit_events')
@Index(['event_id'], { unique: true })
@Index(['organization_id'])
@Index(['workspace_id'])
@Index(['timestamp'])
@Index(['actor_id'])
@Index(['action'])
@Index(['resource_type'])
@Index(['resource_id'])
@Index(['result'])
export class ManagementAuditEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  event_id!: string;

  @Column({ type: 'varchar', nullable: true })
  organization_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  actor_type!: string;

  @Column({ type: 'varchar' })
  actor_id!: string;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar' })
  resource_type!: string;

  @Column({ type: 'varchar', nullable: true })
  resource_id!: string | null;

  @Column({ type: 'text', nullable: true })
  before_summary_json!: string | null;

  @Column({ type: 'text', nullable: true })
  after_summary_json!: string | null;

  @Column({ type: 'varchar' })
  result!: ManagementAuditResult;

  @Column({ type: 'text', nullable: true })
  failure_reason!: string | null;

  @Column({ type: 'varchar', nullable: true })
  request_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  source!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata_json!: string | null;

  @Column({ type: 'varchar', nullable: true })
  previous_hash!: string | null;

  @Column({ type: 'varchar' })
  event_hash!: string;

  @Column({ type: 'integer', default: 1 })
  schema_version!: number;
}
