import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';

/**
 * Saved S3-compatible destination profiles; connection tests use @aws-sdk/client-s3.
 * `secretAccessKey` is stored encrypted at rest using app-level AES-GCM.
 */
@Entity('s3_profiles')
@Index(['workspaceKey', 'name'], { unique: true })
export class S3Profile {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  /** `o:<organizationId>` (internal id). */
  @Column({ name: 'workspace_key', type: 'varchar', length: 96 })
  workspaceKey!: string;

  @Column({ type: 'varchar', length: 191 })
  name!: string;

  @Column({ type: 'varchar', length: 512 })
  endpoint!: string;

  @Column({ type: 'varchar', length: 128 })
  region!: string;

  @Column({ type: 'varchar', length: 255 })
  bucket!: string;

  @Column({ type: 'varchar', length: 255 })
  accessKeyId!: string;

  @Column({ type: 'text' })
  secretAccessKey!: string;

  @Column({ type: 'boolean', default: false })
  forcePathStyle!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicIdAndWorkspace() {
    if (!this.publicId) this.publicId = generatePublicId('s3');
    this.workspaceKey = `o:${this.organizationId}`;
  }
}
