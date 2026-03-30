import { Injectable } from '@nestjs/common';

@Injectable()
export class DatabaseGeneratorService {
  /** Default when the user does not specify an image — keep in sync with frontend `POSTGRES_DOCKER_IMAGE`. */
  static readonly POSTGRES_DOCKER_IMAGE = 'postgres:18-alpine';

  /** Conservative Docker image ref (name[:tag] or registry/path). */
  static readonly POSTGRES_IMAGE_REF_PATTERN =
    /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,127}$/;

  /**
   * Resolves image for YAML: empty/whitespace → default; otherwise must match {@link POSTGRES_IMAGE_REF_PATTERN}.
   */
  normalizePostgresImage(raw?: string | null): string {
    const s = (raw ?? '').trim();
    if (!s) return DatabaseGeneratorService.POSTGRES_DOCKER_IMAGE;
    if (!DatabaseGeneratorService.POSTGRES_IMAGE_REF_PATTERN.test(s)) {
      throw new Error('Invalid Postgres image reference');
    }
    return s;
  }

  /** Reads `image:` from generated stack YAML (quoted or unquoted). */
  static parsePostgresImageFromYaml(yaml: string): string | null {
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

  /**
   * Swarm-style stack file for Postgres (`docker stack deploy -c …`).
   * Credentials are not embedded: `POSTGRES_*` are substituted from the host env at deploy time
   * (Weehawk service **Environment** tab → `docker stack deploy` inherits them).
   */
  /**
   * @param publishPort If set (1–65535), publishes Postgres on host `publishPort` → container 5432.
   * If omitted, no `ports` section (service is not reachable from outside the Swarm overlay unless routed).
   */
  generatePostgresCompose(
    dbName: string,
    replicas: number = 1,
    imageRefNormalized: string,
    publishPort?: number | null,
  ): string {
    const safe = this.sanitizeDbName(dbName);
    const rep = Math.min(10, Math.max(1, Math.floor(replicas)));
    const expose =
      publishPort != null &&
      Number.isFinite(publishPort) &&
      publishPort >= 1 &&
      publishPort <= 65535
        ? `    ports:\n      - "${publishPort}:5432"\n`
        : '';

    return `
version: '3.8'

services:
  ${safe}:
    image: ${imageRefNormalized}
    restart: unless-stopped
${expose}    deploy:
      replicas: ${rep}
      restart_policy:
        condition: on-failure
    environment:
      POSTGRES_DB: \${POSTGRES_DB}
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - ${safe}-data:/var/lib/postgresql/data

volumes:
  ${safe}-data:
    driver: local
`.trim();
  }

  private buildPostgresHeader(imageForComment: string): string {
    return `# weehawk database service
# engine: postgres
# image: ${imageForComment}
`;
  }

  buildPostgresDockerConfig(
    dbName: string,
    replicas?: number,
    publishPort?: number | null,
    imageRef?: string | null,
  ): string {
    const img = this.normalizePostgresImage(imageRef);
    return (
      this.buildPostgresHeader(img) +
      this.generatePostgresCompose(dbName, replicas ?? 1, img, publishPort)
    );
  }
}
