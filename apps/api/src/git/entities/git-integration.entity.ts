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
 * Secrets are stored in plaintext like other integration entities; encrypt at rest later if needed.
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
