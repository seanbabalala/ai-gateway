import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LocalTeamStatus = 'active' | 'disabled';

@Entity('local_teams')
@Index(['workspace_id', 'name'], { unique: true })
@Index(['status'])
@Index(['workspace_id'])
@Index(['namespace_id'])
export class LocalTeam {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', default: 'active' })
  status!: LocalTeamStatus;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  namespace_id!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  allowed_nodes!: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  allowed_models!: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  allowed_endpoints!: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  allowed_modalities!: string[] | null;

  @Column({ type: 'real', nullable: true })
  daily_token_limit!: number | null;

  @Column({ type: 'real', nullable: true })
  daily_cost_limit!: number | null;

  @Column({ type: 'integer', nullable: true })
  rate_limit_per_minute!: number | null;

  @Column({ nullable: true })
  last_used_at?: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
