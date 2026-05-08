import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OrganizationStatus = 'active' | 'disabled';

@Entity('organizations')
@Index(['slug'], { unique: true })
@Index(['status'])
export class Organization {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  slug!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: OrganizationStatus;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
