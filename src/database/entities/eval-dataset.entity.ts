import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('eval_datasets')
@Index(['workspace_id'])
@Index(['name'])
@Index(['source'])
export class EvalDataset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', default: 'local' })
  source!: string;

  @Column({ type: 'integer', default: 0 })
  sample_count!: number;

  @Column({ type: 'text', nullable: true })
  metadata_json!: string | null;

  @Column({ type: 'boolean', default: false })
  sample_storage_enabled!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
