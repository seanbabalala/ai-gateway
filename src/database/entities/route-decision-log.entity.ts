import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('route_decisions')
@Index(['timestamp'])
@Index(['source_format'])
@Index(['tier'])
@Index(['selected_node_id'])
@Index(['selected_model'])
@Index(['api_key_id'])
@Index(['namespace_id'])
@Index(['session_id'])
@Index(['trace_id'])
export class RouteDecisionLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  request_id!: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  source_format!: string;

  @Column({ type: 'varchar' })
  tier!: string;

  @Column({ type: 'real' })
  score!: number;

  @Column({ type: 'varchar', nullable: true })
  route_mode!: string | null;

  @Column({ type: 'varchar', nullable: true })
  strategy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  selected_node_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  selected_model!: string | null;

  @Column({ type: 'varchar', nullable: true })
  domain_hint!: string | null;

  @Column({ type: 'integer', default: 0 })
  candidate_count!: number;

  @Column({ type: 'integer', default: 0 })
  filtered_count!: number;

  @Column({ type: 'integer', default: 200 })
  status_code!: number;

  @Column({ type: 'boolean', default: false })
  is_fallback!: boolean;

  @Column({ type: 'varchar', nullable: true })
  fallback_reason!: string | null;

  @Column({ type: 'varchar', nullable: true })
  session_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  trace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  namespace_id!: string | null;

  @Column({ type: 'text' })
  trace_json!: string;
}
