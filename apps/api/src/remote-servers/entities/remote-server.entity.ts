import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generatePublicId } from '../../common/public-id';

@Entity('remote_servers')
export class RemoteServer {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  publicId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

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
   * OpenSSH SHA256 host key fingerprint from the first successful connection (`SHA256:…`, same as `ssh-keygen -lf -E sha256`).
   * Cleared when host or port changes. Used to prevent MITM on subsequent connects.
   */
  @Column({ name: 'ssh_host_key_sha256', type: 'varchar', length: 128, nullable: true })
  sshHostKeySha256?: string | null;

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

  /**
   * Optional JSON string: domain names / metadata per deploy server (for UI notes and tooling).
   * Example: `["app.example.com","api.example.com"]` or `{"domains":["a.com"],"notes":"prod"}`.
   */
  @Column({ type: 'text', nullable: true })
  domainsJson?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  ensurePublicId() {
    if (!this.publicId) this.publicId = generatePublicId('rsv');
  }
}
