import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('budget_rules')
export class BudgetRule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  type!: string; // daily_tokens | daily_cost | monthly_cost

  @Column({ type: 'real' })
  limit_value!: number;

  @Column({ type: 'real', default: 0.8 })
  alert_threshold!: number;

  @Column({ type: 'real', default: 0 })
  current_value!: number;

  @CreateDateColumn()
  period_start!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'varchar', nullable: true, default: null })
  api_key_name!: string | null;  // NULL = global rule, non-null = per-key rule
}
