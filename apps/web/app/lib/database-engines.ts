import { z } from "zod";

export const databaseEngineIdSchema = z.enum([
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
]);

export type DatabaseEngineId = z.infer<typeof databaseEngineIdSchema>;

/** Docker image for generated Postgres stacks — keep in sync with backend `DatabaseGeneratorService.POSTGRES_DOCKER_IMAGE`. */
export const POSTGRES_DOCKER_IMAGE = "postgres:18-alpine";
export const MYSQL_DOCKER_IMAGE = "mysql:8.4";
export const MARIADB_DOCKER_IMAGE = "mariadb:11.4";
export const MONGODB_DOCKER_IMAGE = "mongo:8.0";
export const REDIS_DOCKER_IMAGE = "redis:7.4";

export function defaultDatabaseImage(engine: DatabaseEngineId): string {
  if (engine === "postgres") return POSTGRES_DOCKER_IMAGE;
  if (engine === "mysql") return MYSQL_DOCKER_IMAGE;
  if (engine === "mariadb") return MARIADB_DOCKER_IMAGE;
  if (engine === "mongodb") return MONGODB_DOCKER_IMAGE;
  return REDIS_DOCKER_IMAGE;
}

export function defaultDatabaseVolumePath(engine: DatabaseEngineId): string {
  if (engine === "postgres") return "/var/lib/postgresql/data";
  if (engine === "mysql" || engine === "mariadb") return "/var/lib/mysql";
  if (engine === "mongodb") return "/data/db";
  return "/data";
}

export const DATABASE_ENGINES: {
  id: DatabaseEngineId;
  name: string;
  description: string;
  /** Served from `public/database-logos/` */
  logoSrc: string;
}[] = [
  {
    id: "postgres",
    name: "Postgres",
    description:
      "Robust, SQL-compliant and highly reliable. You can choose the container image when creating the service.",
    logoSrc: "/database-logos/postgres.png",
  },
  {
    id: "mysql",
    name: "MySQL",
    description: "Widely used relational database known for its performance and flexibility.",
    logoSrc: "/database-logos/mysql.png",
  },
  {
    id: "mariadb",
    name: "MariaDB",
    description: "A fork of MySQL with additional features and improved performance.",
    logoSrc: "/database-logos/mariadb.png",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description: "A NoSQL database known for its high scalability and flexibility.",
    logoSrc: "/database-logos/mongodb.png",
  },
  {
    id: "redis",
    name: "Redis",
    description: "An in-memory key-value store often used as a database, cache, and message broker.",
    logoSrc: "/database-logos/redis.png",
  },
];

export function getDatabaseEngineById(id: string) {
  return DATABASE_ENGINES.find((e) => e.id === id);
}

/**
 * Some vendor PNGs ship with a solid black rectangle behind the mark. On dark UI
 * we use `mix-blend-screen` so black pixels pick up the backdrop (transparent look).
 * On light backgrounds, screen blending washes out light-colored marks — only apply in `.dark`.
 */
const ENGINE_LOGO_SCREEN_BLEND: readonly DatabaseEngineId[] = ["mysql", "mariadb", "redis"];

export function databaseLogoBlendClass(engineId: DatabaseEngineId): string {
  return ENGINE_LOGO_SCREEN_BLEND.includes(engineId) ? "dark:mix-blend-screen" : "";
}

/** Reads `# engine: postgres` (etc.) from stored service `config` / `dockerConfig`. */
export function parseDatabaseEngineFromConfig(config: string): DatabaseEngineId | undefined {
  for (const line of config.split(/\r?\n/)) {
    const m = line.match(/^\s*#\s*engine:\s*(\w+)\s*$/);
    if (!m?.[1]) continue;
    const parsed = databaseEngineIdSchema.safeParse(m[1]);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}
