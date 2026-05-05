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

/** Platform registry login (Dokploy-style: stored encrypted, used for push without relying on host ~/.docker only). */
@Entity('registry_accounts')
@Index(['organizationId', 'providerUrl'], { unique: true })
export class RegistryAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Stable external id for APIs and audit logs (not the numeric primary key). */
  @Column({ name: 'public_id', type: 'varchar', length: 40, unique: true })
  publicId!: string;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** Registry hostname, e.g. ghcr.io, docker.io, registry.gitlab.com */
  @Column({ type: 'varchar', length: 255 })
  providerUrl!: string;

  @Column({ type: 'varchar', length: 256 })
  username!: string;

  /** AES-GCM ciphertext (see ssh-key-crypto). */
  @Column({ type: 'text', name: 'password_encrypted' })
  passwordEncrypted!: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_verified_at' })
  lastVerifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  ensurePublicId(): void {
    if (!this.publicId?.trim()) {
      this.publicId = generatePublicId('reg');
    }
  }
}
