import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const WORKSPACE_MEMBERSHIP_ROLES = [
  'admin',
  'operator',
  'viewer',
] as const;

export type WorkspaceMembershipRole =
  (typeof WORKSPACE_MEMBERSHIP_ROLES)[number];

export type WorkspaceMembershipStatus = 'active' | 'disabled';

@Entity('workspace_memberships')
@Index(['workspace_id', 'user_id'], { unique: true })
@Index(['organization_id'])
@Index(['workspace_id'])
@Index(['role'])
@Index(['status'])
export class WorkspaceMembership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  user_id!: string;

  @Column({ type: 'varchar' })
  organization_id!: string;

  @Column({ type: 'varchar' })
  workspace_id!: string;

  @Column({ type: 'varchar', default: 'viewer' })
  role!: WorkspaceMembershipRole;

  @Column({ type: 'varchar', default: 'active' })
  status!: WorkspaceMembershipStatus;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
