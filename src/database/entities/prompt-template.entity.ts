import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PromptTemplateStatus = 'active' | 'archived';

@Entity('prompt_templates')
@Index(['workspace_id', 'prompt_key', 'version'], { unique: true })
@Index(['workspace_id'])
@Index(['prompt_key'])
@Index(['status'])
@Index(['route_policy_id'])
export class PromptTemplate {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar' })
  prompt_key!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', default: 'active' })
  status!: PromptTemplateStatus;

  @Column({ type: 'text', nullable: true })
  template_content!: string | null;

  @Column({ type: 'varchar' })
  template_hash!: string;

  @Column({ type: 'text', nullable: true })
  variables_json!: string | null;

  @Column({ type: 'varchar', nullable: true })
  route_policy_id!: string | null;

  @Column({ type: 'text', nullable: true })
  ab_metadata_json!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata_json!: string | null;

  @Column({ type: 'boolean', default: false })
  content_storage_enabled!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
