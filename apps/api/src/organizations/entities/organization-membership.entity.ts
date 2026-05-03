import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  ORGANIZATION_MEMBER_ROLE,
  type OrganizationMemberRole,
} from '../organization-member-role';

@Entity({ name: 'organization_memberships' })
@Index(['userId', 'organizationId'], { unique: true })
export class OrganizationMembership {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({
    type: 'varchar',
    length: 16,
    default: ORGANIZATION_MEMBER_ROLE.MEMBER,
  })
  role!: OrganizationMemberRole;

  /**
   * Explicit `false` values block workspace areas for non-owners; owners ignore this map.
   * Omitted keys mean allowed.
   */
  @Column({ name: 'permissions', type: 'json', nullable: true })
  permissions!: Record<string, boolean> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
