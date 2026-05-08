import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type WorkspaceStatus = 'active' | 'disabled';

@Entity('workspaces')
@Index(['organization_id'])
@Index(['organization_id', 'slug'], { unique: true })
@Index(['status'])
@Index(['is_default'])
export class Workspace {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar' })
  organization_id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  slug!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: WorkspaceStatus;

  @Column({ type: 'boolean', default: false })
  is_default!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
