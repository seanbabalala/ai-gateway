import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('video_jobs')
@Index(['request_id'], { unique: true })
@Index(['provider_job_id'])
@Index(['status'])
@Index(['workspace_id'])
export class VideoJob {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  request_id!: string;

  @Column({ type: 'varchar', nullable: true })
  provider_job_id!: string | null;

  @Column({ type: 'varchar' })
  node_id!: string;

  @Column({ type: 'varchar' })
  model!: string;

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

  @Column({ type: 'varchar', default: 'queued' })
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
