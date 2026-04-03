import type { Service } from "./schema";
import type { DatabaseEngineId } from "./database-engines";
import { parseDatabaseEngineFromConfig } from "./database-engines";
import { parseComposeServiceKeys } from "./database-backup-from-service";
import { parseServiceEnvLines } from "./env-utils";

/** When the password lives in Docker Secrets only, the URL uses this literal for the user to replace. */
export const DB_URL_PASSWORD_PLACEHOLDER = "<db-password>";

export type DatabaseInternalUrlResult = {
  /** Shown in UI (password masked when only in Docker secret) */
  displayUrl: string;
  /** Clipboard: full URL when password is in env; otherwise same as display */
  copyUrl: string;
  host: string;
  engine: DatabaseEngineId;
  /** True when `displayUrl` contains {@link DB_URL_PASSWORD_PLACEHOLDER} (secret-only password). */
  passwordPlaceholder: boolean;
};

function headerDbName(config: string): string | undefined {
  const m = config.match(/^\s*#\s*dbName:\s*(.+)$/m);
  return m?.[1]?.trim() || undefined;
}

function readStoreMode(config: string, key: string): "env" | "secret" | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*#\\s*store\\.${escaped}:\\s*(env|secret)\\s*$`, "m");
  const m = config.match(re);
  if (!m?.[1]) return undefined;
  return m[1] as "env" | "secret";
}

function dbPort(engine: DatabaseEngineId): number {
  if (engine === "postgres") return 5432;
  if (engine === "mysql" || engine === "mariadb") return 3306;
  if (engine === "mongodb") return 27017;
  return 6379;
}

function resolveUser(engine: DatabaseEngineId, env: Record<string, string>): string {
  if (engine === "postgres") return env.POSTGRES_USER?.trim() || "postgres";
  if (engine === "mysql") return env.MYSQL_USER?.trim() || "root";
  if (engine === "mariadb") return env.MARIADB_USER?.trim() || "root";
  if (engine === "mongodb") return env.MONGO_INITDB_ROOT_USERNAME?.trim() || "root";
  return "";
}

function resolveDbName(
  engine: DatabaseEngineId,
  env: Record<string, string>,
  header: string | undefined,
  composeKey: string,
): string {
  if (engine === "redis") return "";
  if (header) return header;
  if (engine === "postgres") return env.POSTGRES_DB?.trim() || composeKey;
  if (engine === "mysql") return env.MYSQL_DATABASE?.trim() || composeKey;
  if (engine === "mariadb") return env.MARIADB_DATABASE?.trim() || composeKey;
  if (engine === "mongodb") return env.MONGO_INITDB_DATABASE?.trim() || "admin";
  return composeKey;
}

function passKey(engine: DatabaseEngineId): string {
  if (engine === "postgres") return "POSTGRES_PASSWORD";
  if (engine === "mysql") return "MYSQL_PASSWORD";
  if (engine === "mariadb") return "MARIADB_PASSWORD";
  if (engine === "mongodb") return "MONGO_INITDB_ROOT_PASSWORD";
  return "REDIS_PASSWORD";
}

/**
 * Docker Swarm service DNS: `stackName_composeServiceKey` (same pattern as `docker stack deploy` stack name + YAML service key).
 * Use from other stacks after attaching this stack’s overlay network (e.g. application “Connections”).
 */
export function buildDatabaseInternalConnectionUrl(service: Service): DatabaseInternalUrlResult | null {
  if (service.type !== "databases") return null;
  const config = service.config ?? "";
  const engine = parseDatabaseEngineFromConfig(config);
  if (!engine) return null;
  const composeKeys = parseComposeServiceKeys(config);
  if (composeKeys.length === 0) return null;
  const composeKey = composeKeys[0]!;
  const appName = (service.appName ?? "").trim();
  const host = appName ? `${appName}_${composeKey}` : composeKey;
  const env = parseServiceEnvLines(service.env ?? "");
  const pk = passKey(engine);
  const passMode = readStoreMode(config, pk);
  const rawPass = env[pk] ?? "";
  const hasPasswordInEnv = rawPass.length > 0;
  const passwordIsSecretOnly = passMode === "secret" && !hasPasswordInEnv;

  const user = resolveUser(engine, env);
  const dbName = resolveDbName(engine, env, headerDbName(config), composeKey);
  const port = dbPort(engine);

  const enc = (s: string) => encodeURIComponent(s);

  const authPart = (pwd: string, mask: boolean) => {
    const u = enc(user);
    if (mask) return `${u}:${DB_URL_PASSWORD_PLACEHOLDER}`;
    if (pwd) return `${u}:${enc(pwd)}`;
    return u;
  };

  if (engine === "redis") {
    const base = `${host}:${port}/0`;
    if (passwordIsSecretOnly) {
      const displayUrl = `redis://:${DB_URL_PASSWORD_PLACEHOLDER}@${base}`;
      return {
        displayUrl,
        copyUrl: displayUrl,
        host,
        engine,
        passwordPlaceholder: true,
      };
    }
    if (hasPasswordInEnv) {
      const u = `redis://:${enc(rawPass)}@${base}`;
      return { displayUrl: u, copyUrl: u, host, engine, passwordPlaceholder: false };
    }
    const u = `redis://${base}`;
    return { displayUrl: u, copyUrl: u, host, engine, passwordPlaceholder: false };
  }

  if (engine === "postgres") {
    const mask = passwordIsSecretOnly;
    const pwd = hasPasswordInEnv ? rawPass : "";
    const auth = authPart(pwd, mask);
    const path = `/${enc(dbName)}`;
    const displayUrl = `postgresql://${auth}@${host}:${port}${path}`;
    const copyUrl = mask ? displayUrl : `postgresql://${authPart(pwd, false)}@${host}:${port}${path}`;
    return { displayUrl, copyUrl, host, engine, passwordPlaceholder: mask };
  }

  if (engine === "mysql" || engine === "mariadb") {
    const mask = passwordIsSecretOnly;
    const pwd = hasPasswordInEnv ? rawPass : "";
    const auth = authPart(pwd, mask);
    const path = `/${enc(dbName)}`;
    const displayUrl = `mysql://${auth}@${host}:${port}${path}`;
    const copyUrl = mask ? displayUrl : `mysql://${authPart(pwd, false)}@${host}:${port}${path}`;
    return { displayUrl, copyUrl, host, engine, passwordPlaceholder: mask };
  }

  if (engine === "mongodb") {
    const mask = passwordIsSecretOnly;
    const pwd = hasPasswordInEnv ? rawPass : "";
    const auth = authPart(pwd, mask);
    const path = dbName ? `/${enc(dbName)}` : "";
    const qs = "?authSource=admin";
    const displayUrl = `mongodb://${auth}@${host}:${port}${path}${qs}`;
    const copyUrl = mask ? displayUrl : `mongodb://${authPart(pwd, false)}@${host}:${port}${path}${qs}`;
    return { displayUrl, copyUrl, host, engine, passwordPlaceholder: mask };
  }

  return null;
}
