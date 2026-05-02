import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type GatewayApiKeyStatus = 'active' | 'disabled';

@Entity('gateway_api_keys')
@Index(['key_hash'], { unique: true })
@Index(['name'], { unique: true })
@Index(['status'])
export class GatewayApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar' })
  key_hash!: string;

  @Column({ type: 'varchar' })
  key_prefix!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: GatewayApiKeyStatus;

  @Column({ type: 'boolean', default: true })
  allow_auto!: boolean;

  @Column({ type: 'boolean', default: false })
  allow_direct!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  allowed_nodes!: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  allowed_models!: string[] | null;

  @Column({ type: 'real', nullable: true })
  daily_token_limit!: number | null;

  @Column({ type: 'real', nullable: true })
  daily_cost_limit!: number | null;

  @Column({ type: 'integer', nullable: true })
  rate_limit_per_minute!: number | null;

  @Column({ nullable: true })
  last_used_at?: Date;

  @Column({ type: 'varchar', nullable: true })
  last_used_ip!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
