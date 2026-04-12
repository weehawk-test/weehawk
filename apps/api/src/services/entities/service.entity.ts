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

  @Column({ type: 'simple-enum', enum: composeType, default: composeType.COMPOSE })
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
  @Column({ type: 'datetime', nullable: true })
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

  /**
   * When true, `docker build` runs on the API host’s local daemon (no DOCKER_HOST), even if deploy uses a remote SSH host.
   * Requires a registry image so the remote can pull after push.
   */
  @Column({ type: 'boolean', default: false })
  buildOnLocalDockerHost!: boolean;

  /** When true, pushes to {@link autoDeployBranch} trigger clone + generate + deploy automatically. */
  @Column({ type: 'boolean', default: false })
  autoDeployEnabled!: boolean;

  /** Branch that triggers auto-deploy (default `main`). */
  @Column({ type: 'varchar', length: 255, default: 'main' })
  autoDeployBranch!: string;

  /** Git source provider: `"github"` or `"gitlab"`. */
  @Column({ type: 'varchar', length: 24, nullable: true })
  autoDeployGitProvider?: string | null;

  /**
   * Provider-specific repo identifier.
   * GitHub: `"installationId:owner/repo"`, GitLab: project id or HTTPS URL.
   */
  @Column({ type: 'varchar', length: 512, nullable: true })
  autoDeployRepoId?: string | null;

  /** GitHub repo hook id (auto-registered for push → remote server webhook agent). */
  @Column({ type: 'int', nullable: true })
  autoDeployGithubHookId?: number | null;

  /** GitLab project hook id (auto-registered for push → remote server webhook agent). */
  @Column({ type: 'int', nullable: true })
  autoDeployGitlabHookId?: number | null;

  /** GitLab project id that {@link autoDeployGitlabHookId} belongs to (for DELETE). */
  @Column({ type: 'int', nullable: true })
  autoDeployGitlabHookProjectId?: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
