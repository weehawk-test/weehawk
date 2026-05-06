import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';

/**
 * Git source integration (GitHub App, GitLab token) scoped to one organization.
 * Secrets are stored encrypted at rest using app-level AES-GCM.
 */
@Entity('git_integration_settings')
@Index(['organizationId', 'provider'])
export class GitIntegrationSettings {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    name: 'public_id',
    type: 'varchar',
    length: 40,
    unique: true,
    nullable: true,
  })
  publicId!: string | null;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({ type: 'varchar', length: 16, default: 'gitlab' })
  provider!: 'github' | 'gitlab';

  @Column({ type: 'varchar', length: 120, default: 'Default account', nullable: true })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  githubAppId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  githubClientId!: string | null;

  /** URL slug from GitHub (e.g. `my-app` → install at /apps/my-app/installations/new). */
  @Column({
    name: 'github_app_slug',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  githubAppSlug!: string | null;

  @Column({ type: 'text', nullable: true })
  githubClientSecret!: string | null;

  @Column({ type: 'text', nullable: true })
  githubPrivateKey!: string | null;

  @Column({ type: 'text', nullable: true })
  githubWebhookSecret!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  gitlabBaseUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  gitlabApplicationId!: string | null;

  @Column({ type: 'text', nullable: true })
  gitlabApplicationSecret!: string | null;

  @Column({ type: 'text', nullable: true })
  gitlabGroupAccessToken!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  ensurePublicId(): void {
    if (!this.publicId?.trim()) {
      this.publicId = generatePublicId('git');
    }
  }
}
