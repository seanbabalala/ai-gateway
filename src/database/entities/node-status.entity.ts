import { Entity, Column, PrimaryColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('node_status')
@Index(['workspace_id'])
export class NodeStatus {
  @PrimaryColumn({ type: 'varchar' })
  node_id!: string;

  @Column({ type: 'varchar', nullable: true })
  workspace_id!: string | null;

  @Column({ type: 'boolean', default: true })
  is_healthy!: boolean;

  @UpdateDateColumn()
  last_check!: Date;

  @Column({ type: 'integer', default: 0 })
  consecutive_failures!: number;

  @Column({ type: 'real', default: 0 })
  avg_latency_ms!: number;

  @Column({ type: 'varchar', default: 'CLOSED' })
  circuit_state!: string; // CLOSED | OPEN | HALF_OPEN

  @Column({ type: 'integer', nullable: true })
  circuit_opened_at!: number | null; // timestamp ms when circuit opened
}
