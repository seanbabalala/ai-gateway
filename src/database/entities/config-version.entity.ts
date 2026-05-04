import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ConfigVersionSource =
  | 'dashboard'
  | 'cli'
  | 'reload'
  | 'rollback'
  | 'system';

@Entity('config_versions')
@Index(['version_id'], { unique: true })
@Index(['created_at'])
@Index(['source'])
@Index(['checksum'])
export class ConfigVersion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  version_id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ type: 'varchar' })
  created_by!: string;

  @Column({ type: 'varchar' })
  source!: ConfigVersionSource;

  @Column({ type: 'varchar' })
  checksum!: string;

  @Column({ type: 'varchar' })
  config_path!: string;

  @Column({ type: 'integer', default: 0 })
  runtime_version!: number;

  @Column({ type: 'integer', default: 0 })
  node_count!: number;

  @Column({ type: 'text' })
  node_ids_json!: string;

  @Column({ type: 'text' })
  route_tiers_json!: string;

  @Column({ type: 'text' })
  sanitized_summary_json!: string;

  @Column({ type: 'text' })
  config_yaml!: string;
}
