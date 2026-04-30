import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TraefikSettings } from './entities/traefik-settings.entity';
import type { UpdateTraefikSettingsDto } from './dto/update-traefik-settings.dto';
import {
  WEEHAWK_PLATFORM_UI_HOST_PORT,
  WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH,
  WEEHAWK_TRAEFIK_EXTERNAL_NETWORK,
} from './traefik.constants';

@Injectable()
export class TraefikService {
  constructor(
    @InjectRepository(TraefikSettings)
    private readonly repo: Repository<TraefikSettings>,
  ) {}

  // SYSTEM-LEVEL BYPASS: Required for tenant-keyed Traefik settings row reads.
  private async _internal_system_findOneTraefik(
    options: Parameters<Repository<TraefikSettings>['findOne']>[0],
  ): Promise<TraefikSettings | null> {
    return this.repo.findOne(options);
  }

  // SYSTEM-LEVEL BYPASS: Required for tenant-keyed Traefik settings row writes.
  private async _internal_system_saveTraefik(
    row: TraefikSettings,
  ): Promise<TraefikSettings> {
    return this.repo.save(row);
  }

  private requireTraefikUserId(userId: unknown): number {
    const n = typeof userId === 'number' ? userId : Number(userId);
    if (!Number.isFinite(n) || n < 1) {
      throw new InternalServerErrorException(
        'Traefik settings require a valid user id (signed-in account).',
      );
    }
    return Math.trunc(n);
  }

  async getSettings(userId: number): Promise<TraefikSettings> {
    const uid = this.requireTraefikUserId(userId);
    let row = await this._internal_system_findOneTraefik({ where: { userId: uid } });
    if (!row) {
      row = this.repo.create({
        id: uid,
        userId: uid,
        acmeEmail: 'admin@example.com',
        platformDomain: null,
        acmeStorageHostPath: '/var/www/weehawk/traefik/data/acme.json',
        dockerNetwork: WEEHAWK_TRAEFIK_EXTERNAL_NETWORK,
        traefikImage: 'traefik:v2.11',
        certResolverName: 'letsencrypt',
        httpEntrypoint: 'web',
        httpsEntrypoint: 'websecure',
        redirectHttpToHttps: true,
        dashboardEnabled: false,
        swarmMode: true,
        staticConfigOverride: null,
      });
      await this._internal_system_saveTraefik(row);
    } else if (row.dockerNetwork !== WEEHAWK_TRAEFIK_EXTERNAL_NETWORK) {
      row.dockerNetwork = WEEHAWK_TRAEFIK_EXTERNAL_NETWORK;
      await this._internal_system_saveTraefik(row);
    }
    return row;
  }

  async updateSettings(
    userId: number,
    dto: UpdateTraefikSettingsDto,
  ): Promise<TraefikSettings> {
    const current = await this.getSettings(userId);
    if (dto.acmeEmail !== undefined) current.acmeEmail = dto.acmeEmail.trim();
    if (dto.platformDomain !== undefined) {
      const t = dto.platformDomain.trim();
      current.platformDomain = t === '' ? null : t;
    }
    if (dto.acmeStorageHostPath !== undefined) {
      current.acmeStorageHostPath = dto.acmeStorageHostPath.trim();
    }
    if (dto.traefikImage !== undefined)
      current.traefikImage = dto.traefikImage.trim();
    if (dto.certResolverName !== undefined) {
      current.certResolverName = dto.certResolverName.trim();
    }
    if (dto.httpEntrypoint !== undefined) {
      current.httpEntrypoint = dto.httpEntrypoint.trim();
    }
    if (dto.httpsEntrypoint !== undefined) {
      current.httpsEntrypoint = dto.httpsEntrypoint.trim();
    }
    if (dto.redirectHttpToHttps !== undefined) {
      current.redirectHttpToHttps = dto.redirectHttpToHttps;
    }
    if (dto.dashboardEnabled !== undefined) {
      current.dashboardEnabled = dto.dashboardEnabled;
    }
    if (dto.swarmMode !== undefined) current.swarmMode = dto.swarmMode;
    if (dto.staticConfigOverride !== undefined) {
      const raw = dto.staticConfigOverride;
      current.staticConfigOverride = raw.trim() === '' ? null : raw;
    }
    return await this._internal_system_saveTraefik(current);
  }

  /** Normalized hostname for Traefik Host() or null if unset/invalid. */
  private sanitizePlatformDomain(
    raw: string | null | undefined,
  ): string | null {
    if (raw == null || typeof raw !== 'string') return null;
    const host =
      raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.trim() ?? '';
    if (!host || host.length > 253) return null;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
    return host;
  }

  buildStackComposeYaml(s: TraefikSettings): string {
    const net = WEEHAWK_TRAEFIK_EXTERNAL_NETWORK;
    const swarmFlag = s.swarmMode !== false ? 'true' : 'false';
    const platformHost = this.sanitizePlatformDomain(s.platformDomain);
    const lines: string[] = [
      'services:',
      '  traefik:',
      `    image: ${s.traefikImage}`,
    ];
    if (platformHost) {
      lines.push(
        '    extra_hosts:',
        '      - "host.docker.internal:host-gateway"',
      );
    }
    lines.push(
      '    command:',
      '      - "--providers.docker=true"',
      `      - "--providers.docker.swarmMode=${swarmFlag}"`,
      '      - "--providers.docker.exposedByDefault=false"',
      `      - "--providers.docker.network=${net}"`,
    );
    if (platformHost) {
      lines.push(
        '      - "--providers.file.directory=/etc/traefik/dynamic"',
        '      - "--providers.file.watch=true"',
      );
    }
    lines.push(
      `      - "--entrypoints.${s.httpEntrypoint}.address=:80"`,
      `      - "--entrypoints.${s.httpsEntrypoint}.address=:443"`,
    );
    if (s.redirectHttpToHttps !== false) {
      lines.push(
        `      - "--entrypoints.${s.httpEntrypoint}.http.redirections.entryPoint.to=${s.httpsEntrypoint}"`,
        `      - "--entrypoints.${s.httpEntrypoint}.http.redirections.entryPoint.scheme=https"`,
      );
    }
    lines.push(
      `      - "--certificatesresolvers.${s.certResolverName}.acme.email=${s.acmeEmail}"`,
      `      - "--certificatesresolvers.${s.certResolverName}.acme.storage=/acme.json"`,
      `      - "--certificatesresolvers.${s.certResolverName}.acme.httpChallenge.entryPoint=${s.httpEntrypoint}"`,
      '    ports:',
      '      - "80:80"',
      '      - "443:443"',
      '    volumes:',
      '      - /var/run/docker.sock:/var/run/docker.sock:ro',
      `      - ${s.acmeStorageHostPath}:/acme.json`,
    );
    if (platformHost) {
      lines.push(
        `      - ${WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH}:/etc/traefik/dynamic`,
      );
    }
    lines.push(
      '    networks:',
      `      - ${net}`,
      '    deploy:',
      '      placement:',
      '        constraints:',
      '          - node.role == manager',
      '',
      'networks:',
      `  ${net}:`,
      '    external: true',
    );
    return lines.join('\n');
  }

  /**
   * File-provider fragment: save as e.g. `weehawk-platform.yml` under the dynamic host path.
   * Empty string when no platform domain.
   */
  buildPlatformDynamicYaml(s: TraefikSettings): string {
    const host = this.sanitizePlatformDomain(s.platformDomain);
    if (!host) return '';
    const cr = s.certResolverName;
    const ep = s.httpsEntrypoint;
    const port = WEEHAWK_PLATFORM_UI_HOST_PORT;
    return `# Place this file in: ${WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH}/weehawk-platform.yml
# Weehawk UI listens on the Traefik host at port ${port} (e.g. next start -p ${port}).
http:
  routers:
    weehawk-ui:
      rule: "Host(\`${host}\`)"
      entryPoints:
        - ${ep}
      service: weehawk-ui
      tls:
        certResolver: ${cr}
  services:
    weehawk-ui:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:${port}"
`;
  }

  buildStaticConfigYaml(s: TraefikSettings): string {
    if (s.staticConfigOverride?.trim()) {
      return s.staticConfigOverride.trim();
    }
    const dash = s.dashboardEnabled ? 'true' : 'false';
    const redirectBlock =
      s.redirectHttpToHttps !== false
        ? `    http:
      redirections:
        entryPoint:
          to: ${s.httpsEntrypoint}
          scheme: https
`
        : '';
    return `api:
  dashboard: ${dash}

entryPoints:
  ${s.httpEntrypoint}:
    address: ":80"
${redirectBlock}  ${s.httpsEntrypoint}:
    address: ":443"

certificatesResolvers:
  ${s.certResolverName}:
    acme:
      email: ${s.acmeEmail}
      storage: /acme.json
      httpChallenge:
        entryPoint: ${s.httpEntrypoint}

providers:
  docker:
    exposedByDefault: false
    swarmMode: ${s.swarmMode !== false ? 'true' : 'false'}
`;
  }

  async getResponsePayload(userId: number) {
    const s = await this.getSettings(userId);
    return {
      ...this.toPlain(s),
      generatedStackCompose: this.buildStackComposeYaml(s),
      generatedStaticConfig: this.buildStaticConfigYaml(s),
      generatedPlatformDynamicConfig: this.buildPlatformDynamicYaml(s),
    };
  }

  private toPlain(s: TraefikSettings) {
    return {
      id: s.id,
      acmeEmail: s.acmeEmail,
      platformDomain: s.platformDomain,
      acmeStorageHostPath: s.acmeStorageHostPath,
      dockerNetwork: WEEHAWK_TRAEFIK_EXTERNAL_NETWORK,
      traefikImage: s.traefikImage,
      certResolverName: s.certResolverName,
      httpEntrypoint: s.httpEntrypoint,
      httpsEntrypoint: s.httpsEntrypoint,
      redirectHttpToHttps: s.redirectHttpToHttps,
      dashboardEnabled: s.dashboardEnabled,
      swarmMode: s.swarmMode,
      staticConfigOverride: s.staticConfigOverride,
      updatedAt: s.updatedAt?.toISOString?.() ?? null,
    };
  }
}
