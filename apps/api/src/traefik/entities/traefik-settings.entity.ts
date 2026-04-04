import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik.constants';

/** Singleton row (`id` = 1): Traefik / ACME defaults for generated compose snippets and app labels. */
@Entity('traefik_settings')
export class TraefikSettings {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'varchar', length: 254, default: 'admin@example.com' })
  acmeEmail!: string;

  /** Public hostname for the Weehawk UI (Traefik routes to host:3000). */
  @Column({ type: 'varchar', length: 253, nullable: true })
  platformDomain!: string | null;

  /** Host path bound to `/acme.json` in the Traefik service (Let’s Encrypt storage). */
  @Column({ type: 'varchar', length: 512, default: '/var/www/weehawk/traefik/data/acme.json' })
  acmeStorageHostPath!: string;

  /** Matches `--providers.docker.network` and external overlay name services should attach to. */
  /** Synced to WEEHAWK_TRAEFIK_EXTERNAL_NETWORK; not exposed for editing. */
  @Column({ type: 'varchar', length: 128, default: WEEHAWK_TRAEFIK_EXTERNAL_NETWORK })
  dockerNetwork!: string;

  @Column({ type: 'varchar', length: 128, default: 'traefik:v2.11' })
  traefikImage!: string;

  @Column({ type: 'varchar', length: 64, default: 'letsencrypt' })
  certResolverName!: string;

  @Column({ type: 'varchar', length: 64, default: 'web' })
  httpEntrypoint!: string;

  @Column({ type: 'varchar', length: 64, default: 'websecure' })
  httpsEntrypoint!: string;

  @Column({ type: 'boolean', default: true })
  redirectHttpToHttps!: boolean;

  @Column({ type: 'boolean', default: false })
  dashboardEnabled!: boolean;

  @Column({ type: 'boolean', default: true })
  swarmMode!: boolean;

  /** When set, API returns this as `generatedStaticConfig` instead of building YAML from fields. */
  @Column({ type: 'text', nullable: true })
  staticConfigOverride!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
