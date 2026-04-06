import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/auth/entities/user.entity';

@Entity('remote_servers')
export class RemoteServer {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Owner; null only for rows created before per-user isolation (hidden from API until migrated). */
  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId!: number | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  host!: string;

  /** SSH port (default 22). */
  @Column({ type: 'int', default: 22 })
  port!: number;

  @Column({ type: 'varchar', length: 64 })
  sshUser!: string;

  /**
   * `deploy` = run containers / stack deploy (default). `build` = dedicated image build host (Dokploy-style).
   */
  @Column({ type: 'varchar', length: 16, default: 'deploy' })
  serverRole!: 'deploy' | 'build';

  /**
   * Optional: absolute path to a private key on the API host (legacy).
   * Prefer {@link privateKeyEncrypted} for new entries.
   */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  privateKeyPath?: string | null;

  /**
   * AES-256-GCM encrypted OpenSSH PEM (see ssh-key-crypto). Requires WEEHAWK_ENCRYPTION_KEY.
   */
  @Column({ type: 'text', nullable: true })
  privateKeyEncrypted?: string | null;

  /**
   * Extra arguments appended to DOCKER_SSH_OPTS (e.g. `-o IdentityAgent=none`).
   */
  @Column({ type: 'text', nullable: true })
  extraSshOptions?: string | null;

  /**
   * Public IPv4 for Magic Traefik.me hostnames (`*.x.x.x.x.traefik.me`).
   * Falls back to `WEEHAWK_MAGIC_TRAEFIK_ME_PUBLIC_IP` when unset.
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  publicIpv4?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
