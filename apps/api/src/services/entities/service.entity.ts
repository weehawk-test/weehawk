import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  RelationId,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { composeType } from './composeType.enum';
import { Project } from 'src/projects/entities/project.entity';
import { RemoteServer } from 'src/remote-servers/entities/remote-server.entity';
import type { ServiceTraefikRoute } from './service-traefik-route.types';

@Entity('services')
export class Service {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  appName!: string;

  @Column({ type: 'enum', enum: composeType, default: composeType.COMPOSE })
  composeType!: composeType;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  dockerConfig!: string;

  @Column({ type: 'text', nullable: true })
  env?: string;

  @Column({ type: 'simple-json', nullable: true })
  domains?: string[];

  /** Traefik Swarm labels: routers with Host / PathPrefix / port. When set, takes precedence over `domains`. */
  @Column({ type: 'simple-json', nullable: true })
  traefikRoutes?: ServiceTraefikRoute[];

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** Set when `POST .../execute` completes successfully (Docker deploy ran). */
  @Column({ type: 'timestamptz', nullable: true })
  lastDeployedAt?: Date | null;

  @ManyToOne(() => Project, (project) => project.services, {
    onDelete: 'CASCADE',
  })
  project!: Project;

  /** When set, Docker CLI uses DOCKER_HOST=ssh://… so deploy/compose/stack run on this host. */
  @ManyToOne(() => RemoteServer, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'remoteServerId' })
  remoteServer?: RemoteServer | null;

  @RelationId((s: Service) => s.remoteServer)
  remoteServerId?: number | null;

  /** When set, application image builds (`docker build` over SSH) use this host; deploy still uses {@link remoteServerId}. */
  @ManyToOne(() => RemoteServer, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'buildRemoteServerId' })
  buildRemoteServer?: RemoteServer | null;

  @RelationId((s: Service) => s.buildRemoteServer)
  buildRemoteServerId?: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
