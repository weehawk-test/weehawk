import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Singleton row (id = 1) for platform-wide Git source integration (GitHub App, GitLab token).
 * Secrets are stored encrypted at rest using app-level AES-GCM.
 */
@Entity('git_integration_settings')
@Index(['userId'], { unique: true })
export class GitIntegrationSettings {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  githubAppId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  githubClientId!: string | null;

  /** URL slug from GitHub (e.g. `my-app` → install at /apps/my-app/installations/new). */
  @Column({ name: 'github_app_slug', type: 'varchar', length: 255, nullable: true })
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
}
