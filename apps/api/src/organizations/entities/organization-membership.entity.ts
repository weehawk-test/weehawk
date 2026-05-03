import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'organization_memberships' })
@Index(['userId', 'organizationId'], { unique: true })
export class OrganizationMembership {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
