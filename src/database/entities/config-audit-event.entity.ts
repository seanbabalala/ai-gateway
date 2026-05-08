import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ConfigAuditResult = 'success' | 'failure';

@Entity('config_audit_events')
@Index(['event_id'], { unique: true })
@Index(['workspace_id'])
@Index(['timestamp'])
@Index(['action'])
@Index(['target'])
@Index(['result'])
export class ConfigAuditEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  event_id!: string;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  actor!: string;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar' })
  target!: string;

  @Column({ type: 'text', nullable: true })
  before_summary_json!: string | null;

  @Column({ type: 'text', nullable: true })
  after_summary_json!: string | null;

  @Column({ type: 'varchar' })
  result!: ConfigAuditResult;

  @Column({ type: 'text', nullable: true })
  failure_reason!: string | null;

  @Column({ type: 'varchar', nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', nullable: true })
  version_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  previous_version_id!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata_json!: string | null;
}
