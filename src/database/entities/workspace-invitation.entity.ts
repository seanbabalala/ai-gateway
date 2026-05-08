import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { WorkspaceMembershipRole } from './workspace-membership.entity';

export type WorkspaceInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked';

@Entity('workspace_invitations')
@Index(['workspace_id'])
@Index(['status'])
@Index(['token_hash'], { unique: true })
export class WorkspaceInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  organization_id!: string;

  @Column({ type: 'varchar' })
  workspace_id!: string;

  @Column({ type: 'varchar' })
  role!: WorkspaceMembershipRole;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', unique: true })
  token_hash!: string;

  @Column({ type: 'varchar', default: 'pending' })
  status!: WorkspaceInvitationStatus;

  @Column({ type: 'text' })
  expires_at!: string;

  @Column({ type: 'text', nullable: true })
  accepted_at!: string | null;

  @Column({ type: 'varchar', nullable: true })
  accepted_by_user_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  created_by_user_id!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
