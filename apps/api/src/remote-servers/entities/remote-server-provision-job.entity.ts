import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('remote_server_provision_jobs')
export class RemoteServerProvisionJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'remote_server_id', type: 'int' })
  remoteServerId!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'running' | 'done' | 'error';

  @Column({ type: 'text', nullable: true })
  log?: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  /** `provision` = install Docker / Swarm / network; `docker_purge` = full Docker removal (conflict cleanup). */
  @Column({ name: 'job_kind', type: 'varchar', length: 24, default: 'provision' })
  jobKind!: 'provision' | 'docker_purge';

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
