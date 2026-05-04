import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ShadowTrafficStatus = 'sent' | 'failed' | 'skipped';
export type ShadowTrafficKind = 'chat' | 'embeddings';

@Entity('shadow_traffic_results')
@Index(['timestamp'])
@Index(['request_id'])
@Index(['namespace_id'])
@Index(['status'])
@Index(['session_id'])
@Index(['trace_id'])
export class ShadowTrafficResult {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  request_id!: string;

  @Column({ type: 'varchar' })
  kind!: ShadowTrafficKind;

  @Column({ type: 'varchar', nullable: true })
  namespace_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  session_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  trace_id!: string | null;

  @Column({ type: 'varchar' })
  source_format!: string;

  @Column({ type: 'varchar' })
  primary_node!: string;

  @Column({ type: 'varchar' })
  primary_model!: string;

  @Column({ type: 'varchar' })
  shadow_node!: string;

  @Column({ type: 'varchar' })
  shadow_model!: string;

  @Column({ type: 'varchar' })
  status!: ShadowTrafficStatus;

  @Column({ type: 'integer', nullable: true })
  latency_ms!: number | null;

  @Column({ type: 'integer', nullable: true })
  status_code!: number | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'integer', default: 0 })
  input_tokens!: number;

  @Column({ type: 'integer', default: 0 })
  output_tokens!: number;

  @Column({ type: 'text', nullable: true })
  prompt_sample!: string | null;

  @Column({ type: 'text', nullable: true })
  response_sample!: string | null;
}
