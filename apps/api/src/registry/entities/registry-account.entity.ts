import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Platform registry login (Dokploy-style: stored encrypted, used for push without relying on host ~/.docker only). */
@Entity('registry_accounts')
@Index(['userId', 'providerUrl'], { unique: true })
export class RegistryAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

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
}
