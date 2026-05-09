import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type RouteFeedbackValue = 'up' | 'down';

@Entity('route_feedback')
@Index(['workspace_id'])
@Index(['request_id'])
@Index(['api_key_id'])
@Index(['team_id'])
@Index(['value'])
@Index(['created_at'])
export class RouteFeedback {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'varchar' })
  request_id!: string;

  @Column({ type: 'varchar', nullable: true })
  route_decision_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  team_id!: string | null;

  @Column({ type: 'varchar' })
  value!: RouteFeedbackValue;

  @Column({ type: 'varchar', nullable: true })
  reason_code!: string | null;

  @Column({ type: 'varchar', default: 'gateway_api' })
  source!: string;

  @Column({ type: 'text', nullable: true })
  route_weight_evidence_json!: string | null;

  @CreateDateColumn()
  created_at!: Date;
}
