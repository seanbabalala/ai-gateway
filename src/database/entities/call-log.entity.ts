import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('call_logs')
@Index(['timestamp'])
@Index(['tier'])
@Index(['node_id'])
@Index(['session_key'])
@Index(['experiment_group'])
@Index(['api_key_name'])
export class CallLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  request_id!: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'varchar' })
  source_format!: string; // chat_completions | responses | messages

  @Column({ type: 'varchar' })
  tier!: string; // simple | standard | complex | reasoning

  @Column({ type: 'real' })
  score!: number;

  @Column({ type: 'varchar' })
  node_id!: string;

  @Column({ type: 'varchar' })
  model!: string;

  @Column({ type: 'integer', default: 0 })
  input_tokens!: number;

  @Column({ type: 'integer', default: 0 })
  output_tokens!: number;

  @Column({ type: 'real', default: 0 })
  cost_usd!: number;

  @Column({ type: 'integer', default: 0 })
  latency_ms!: number;

  @Column({ type: 'integer', default: 200 })
  status_code!: number;

  @Column({ type: 'boolean', default: false })
  is_fallback!: boolean;

  @Column({ type: 'varchar', nullable: true })
  session_key!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', nullable: true })
  api_key_name!: string | null;

  @Column({ type: 'integer', default: 0 })
  retry_count!: number;

  @Column({ type: 'integer', default: 0 })
  cache_creation_input_tokens!: number;

  @Column({ type: 'integer', default: 0 })
  cache_read_input_tokens!: number;

  @Column({ type: 'varchar', nullable: true })
  experiment_group!: string | null;
}
