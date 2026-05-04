import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'organization_audit_logs' })
@Index(['organizationId', 'createdAt'])
export class OrganizationAuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({ name: 'actor_user_id', type: 'int' })
  actorUserId!: number;

  /** Stable machine key, e.g. `member.joined`, `org.updated`. */
  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'target_email', type: 'varchar', length: 255, nullable: true })
  targetEmail!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
