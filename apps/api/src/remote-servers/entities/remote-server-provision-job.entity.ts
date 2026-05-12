import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('remote_server_provision_jobs')
export class RemoteServerProvisionJob {
  /**
   * Opaque primary key: DB-generated UUID (not a serial). Avoids predictable IDs if a row is
   * ever addressed without a full access check; APIs should still enforce org/workspace auth.
   */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'remote_server_id', type: 'int' })
  remoteServerId!: number;

  /** Organization scope (mirrors `remote_servers.organization_id`). */
  @Column({ name: 'organization_id', type: 'int' })
  organizationId!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'running' | 'done' | 'error';

  @Column({ type: 'text', nullable: true })
  log?: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  /**
   * `provision` = full install; `docker_purge` = remove Docker;
   * `nixpacks_install` = install Nixpacks CLI only (host already provisioned);
   * `traefik_redeploy` = rewrite Traefik config + stack deploy (no Docker/Swarm changes).
   */
  @Column({
    name: 'job_kind',
    type: 'varchar',
    length: 24,
    default: 'provision',
  })
  jobKind!: 'provision' | 'docker_purge' | 'nixpacks_install' | 'traefik_redeploy';

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
