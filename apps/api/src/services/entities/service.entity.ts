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

  /**
   * When set (6 hex chars), user opted in via “roll dice” — include Magic traefik.me host in Traefik labels.
   * Not generated automatically for every service.
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  magicTraefikMeNonce?: string | null;

  /**
   * User-supplied IPv4 embedded in the Magic traefik.me hostname (e.g. public IP or 127.0.0.1).
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  magicTraefikMeIpv4?: string | null;

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
