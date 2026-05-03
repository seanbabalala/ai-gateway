import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('config_audit_events')
@Index(['timestamp'])
@Index(['action'])
@Index(['target_type', 'target_id'])
@Index(['success'])
export class ConfigAuditEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  target_type!: string | null;

  @Column({ type: 'varchar', nullable: true })
  target_id!: string | null;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'varchar', nullable: true })
  actor_type!: string | null;

  @Column({ type: 'varchar', nullable: true })
  actor_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  source!: string | null;

  @Column({ type: 'integer', nullable: true })
  version_id!: number | null;

  @Column({ type: 'integer', nullable: true })
  previous_version_id!: number | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata_json!: string | null;
}
