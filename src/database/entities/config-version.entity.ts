import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('config_versions')
@Index(['created_at'])
@Index(['checksum'])
@Index(['action'])
export class ConfigVersion {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  actor_type!: string | null;

  @Column({ type: 'varchar', nullable: true })
  actor_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  reason!: string | null;

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
  summary_json!: string;

  @Column({ type: 'text' })
  snapshot_yaml!: string;
}
