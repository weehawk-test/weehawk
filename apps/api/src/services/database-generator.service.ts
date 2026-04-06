import { Injectable } from '@nestjs/common';

export type DatabaseEngine =
  | 'postgres'
  | 'mysql'
  | 'mariadb'
  | 'mongodb'
  | 'redis';

@Injectable()
export class DatabaseGeneratorService {
  /** Default when the user does not specify an image. */
  static readonly POSTGRES_DOCKER_IMAGE = 'postgres:18-alpine';
  static readonly MYSQL_DOCKER_IMAGE = 'mysql:8.4';
  static readonly MARIADB_DOCKER_IMAGE = 'mariadb:11.4';
  static readonly MONGODB_DOCKER_IMAGE = 'mongo:8.0';
  static readonly REDIS_DOCKER_IMAGE = 'redis:7.4';

  /** Conservative Docker image ref (name[:tag] or registry/path). */
  static readonly IMAGE_REF_PATTERN =
    /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,127}$/;

  private defaultImage(engine: DatabaseEngine): string {
    if (engine === 'postgres') return DatabaseGeneratorService.POSTGRES_DOCKER_IMAGE;
    if (engine === 'mysql') return DatabaseGeneratorService.MYSQL_DOCKER_IMAGE;
    if (engine === 'mariadb') return DatabaseGeneratorService.MARIADB_DOCKER_IMAGE;
    if (engine === 'mongodb') return DatabaseGeneratorService.MONGODB_DOCKER_IMAGE;
    return DatabaseGeneratorService.REDIS_DOCKER_IMAGE;
  }

  private containerPort(engine: DatabaseEngine): number {
    if (engine === 'postgres') return 5432;
    if (engine === 'mysql' || engine === 'mariadb') return 3306;
    if (engine === 'mongodb') return 27017;
    return 6379;
  }

  normalizeImage(engine: DatabaseEngine, raw?: string | null): string {
    const s = (raw ?? '').trim();
    if (!s) return this.defaultImage(engine);
    if (!DatabaseGeneratorService.IMAGE_REF_PATTERN.test(s)) {
      throw new Error(`Invalid ${engine} image reference`);
    }
    return s;
  }

  /** Reads `image:` from generated stack YAML (quoted or unquoted). */
  static parseImageFromYaml(yaml: string): string | null {
    const m = yaml.match(/^\s*image:\s*(.+)$/m);
    if (!m) return null;
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v || null;
  }

  /**
   * Sanitize compose service / volume name: lowercase, [a-z0-9_-], starts with letter.
   */
  sanitizeDbName(raw: string): string {
    let s = raw
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/--+/g, '-');
    if (!s) s = 'db';
    if (!/^[a-z]/.test(s)) s = `a${s}`;
    return s.slice(0, 63);
  }

  private buildPortExpose(
    publishPort: number | null | undefined,
    containerPort: number,
  ): string {
    return publishPort != null &&
      Number.isFinite(publishPort) &&
      publishPort >= 1 &&
      publishPort <= 65535
      ? `    ports:\n      - "${publishPort}:${containerPort}"\n`
      : '';
  }

  /** Stack `environment:` uses `${VAR}` placeholders; values come from the service env on deploy. */
  private buildEnvSection(
    engine: DatabaseEngine,
    plainEnvKeys: string[],
  ): string {
    const lines: string[] = [];
    for (const key of plainEnvKeys) {
      lines.push(`      ${key}: \${${key}}`);
    }
    if (!lines.length) return '';
    return `    environment:\n${lines.join('\n')}\n`;
  }

  private buildRedisCommand(plainEnvKeys: string[]): string {
    if (plainEnvKeys.includes('REDIS_PASSWORD')) {
      return `    command: ["sh", "-c", "redis-server --appendonly yes --requirepass $$REDIS_PASSWORD"]\n`;
    }
    return '';
  }

  defaultDataMount(engine: DatabaseEngine): string {
    if (engine === 'postgres') return '/var/lib/postgresql/data';
    if (engine === 'mysql' || engine === 'mariadb') return '/var/lib/mysql';
    if (engine === 'mongodb') return '/data/db';
    return '/data';
  }

  generateDatabaseCompose(
    engine: DatabaseEngine,
    dbName: string,
    replicas: number = 1,
    imageRefNormalized?: string,
    publishPort?: number | null,
    volumePath?: string,
    plainEnvKeys?: string[],
  ): string {
    const safe = this.sanitizeDbName(dbName);
    const rep = Math.min(10, Math.max(1, Math.floor(replicas)));
    const image = imageRefNormalized ?? this.defaultImage(engine);
    const expose = this.buildPortExpose(publishPort, this.containerPort(engine));
    const envKeys = plainEnvKeys ?? [];
    const env = this.buildEnvSection(engine, envKeys);
    const mount = (volumePath ?? '').trim() || this.defaultDataMount(engine);
    const redisCmd = this.buildRedisCommand(envKeys);
    const commandSection = redisCmd;

    return `
version: '3.8'

services:
  ${safe}:
    image: ${image}
${expose}    deploy:
      replicas: ${rep}
      restart_policy:
        condition: on-failure
      placement:
        constraints:
          - node.role == manager
${commandSection}${env}    volumes:
      - ${safe}-data:${mount}
    networks:
      - ${safe}-network

volumes:
  ${safe}-data:
    driver: local

networks:
  ${safe}-network:
    driver: overlay
    internal: true
    attachable: true
`.trim();
  }

  private buildDatabaseHeader(
    engine: DatabaseEngine,
    imageForComment: string,
    dbName: string,
    volumePath: string,
  ): string {
    return `# weehawk database service
# engine: ${engine}
# image: ${imageForComment}
# dbName: ${dbName}
# volumePath: ${volumePath}
`;
  }

  buildDatabaseDockerConfig(
    engine: DatabaseEngine,
    dbName: string,
    replicas?: number,
    publishPort?: number | null,
    imageRef?: string | null,
    volumePath?: string | null,
    plainEnvKeys?: string[],
  ): string {
    const img = this.normalizeImage(engine, imageRef);
    const mount = (volumePath ?? '').trim() || this.defaultDataMount(engine);
    return (
      this.buildDatabaseHeader(engine, img, dbName, mount) +
      this.generateDatabaseCompose(
        engine,
        dbName,
        replicas ?? 1,
        img,
        publishPort,
        mount,
        plainEnvKeys,
      )
    );
  }

  // Backward-compat wrappers for existing call sites.
  normalizePostgresImage(raw?: string | null): string {
    return this.normalizeImage('postgres', raw);
  }
  static parsePostgresImageFromYaml(yaml: string): string | null {
    return DatabaseGeneratorService.parseImageFromYaml(yaml);
  }
  generatePostgresCompose(
    dbName: string,
    replicas: number = 1,
    imageRefNormalized: string,
    publishPort?: number | null,
    volumePath?: string | null,
    plainEnvKeys?: string[],
  ): string {
    return this.generateDatabaseCompose(
      'postgres',
      dbName,
      replicas,
      imageRefNormalized,
      publishPort,
      volumePath ?? undefined,
      plainEnvKeys,
    );
  }
  buildPostgresDockerConfig(
    dbName: string,
    replicas?: number,
    publishPort?: number | null,
    imageRef?: string | null,
    volumePath?: string | null,
    plainEnvKeys?: string[],
  ): string {
    return this.buildDatabaseDockerConfig(
      'postgres',
      dbName,
      replicas,
      publishPort,
      imageRef,
      volumePath,
      plainEnvKeys,
    );
  }
}
