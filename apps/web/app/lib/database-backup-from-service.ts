import type { Service } from "./schema";
import { parseDatabaseEngineFromConfig } from "./database-engines";
import type {
  DatabaseBackupConfig,
  DatabaseBackupEngine,
  DatabaseBackupFormValues,
} from "./database-backup-preview";
import {
  defaultBackupFormatForEngine,
  resolveBackupFormat,
} from "./database-backup-preview";

function parseDotEnv(env: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of env.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/** Top-level keys under `services:` (Docker Compose / stack YAML). */
export function parseComposeServiceKeys(config: string): string[] {
  const keys: string[] = [];
  const lines = config.split(/\r?\n/);
  let inServices = false;
  for (const line of lines) {
    if (!inServices) {
      if (/^services:\s*$/.test(line.trim())) inServices = true;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = line.match(/^  ([a-zA-Z0-9][a-zA-Z0-9_.-]*):\s*$/);
    if (m?.[1]) {
      keys.push(m[1]);
      continue;
    }
    if (trimmed && !line.startsWith("  ")) break;
  }
  return keys;
}

function headerDbName(config: string): string | undefined {
  const m = config.match(/^\s*#\s*dbName:\s*(.+)$/m);
  return m?.[1]?.trim() || undefined;
}

function resolveDatabaseName(
  engine: DatabaseBackupEngine,
  env: Record<string, string>,
  header: string | undefined,
  composeKey: string,
): string | undefined {
  if (engine === "redis") return undefined;
  if (header) return header;
  if (engine === "postgres") return env.POSTGRES_DB || composeKey;
  if (engine === "mysql") return env.MYSQL_DATABASE || composeKey;
  if (engine === "mariadb") return env.MARIADB_DATABASE || composeKey;
  if (engine === "mongodb") return env.MONGO_INITDB_DATABASE || composeKey;
  return composeKey;
}

function resolveDbUser(engine: DatabaseBackupEngine, env: Record<string, string>): string {
  if (engine === "postgres") return env.POSTGRES_USER ?? "";
  if (engine === "mysql") return env.MYSQL_USER ?? "";
  if (engine === "mariadb") return env.MARIADB_USER ?? "";
  return "";
}

export function formsEqual(a: DatabaseBackupFormValues, b: DatabaseBackupFormValues): boolean {
  const fa = resolveBackupFormat(a.engine, a.backupFormat);
  const fb = resolveBackupFormat(b.engine, b.backupFormat);
  return (
    a.engine === b.engine &&
    a.composeService.trim() === b.composeService.trim() &&
    a.databaseName.trim() === b.databaseName.trim() &&
    a.dbUser.trim() === b.dbUser.trim() &&
    fa === fb
  );
}

export type DatabaseBackupPickOption = {
  form: DatabaseBackupFormValues;
  config: DatabaseBackupConfig;
  label: string;
};

/**
 * Builds backup targets from a **database-type** service (compose YAML + env).
 * Aligned with weehawk `DatabaseGeneratorService` headers and env keys.
 */
export function listDatabaseBackupOptions(
  service: Service | null | undefined,
  serviceDisplayName?: string,
): DatabaseBackupPickOption[] {
  if (!service || service.type !== "databases") return [];
  const yaml = service.config || "";
  const engineRaw = parseDatabaseEngineFromConfig(yaml);
  if (!engineRaw) return [];
  const engine = engineRaw as DatabaseBackupEngine;
  const env = parseDotEnv(service.env || "");
  const keys = parseComposeServiceKeys(yaml);
  const hDb = headerDbName(yaml);
  if (keys.length === 0) return [];

  const name = serviceDisplayName ?? service.name;
  const out: DatabaseBackupPickOption[] = [];

  for (const composeService of keys) {
    const databaseName = resolveDatabaseName(engine, env, hDb, composeService);
    const dbUser = resolveDbUser(engine, env);
    const backupFormat = defaultBackupFormatForEngine(engine);
    const form: DatabaseBackupFormValues = {
      engine,
      composeService,
      databaseName: databaseName ?? "",
      dbUser,
      backupFormat,
    };
    const cfg: DatabaseBackupConfig = {
      engine,
      composeService,
      ...(engine !== "redis" && databaseName ? { databaseName } : {}),
      ...(dbUser.trim() ? { dbUser: dbUser.trim() } : {}),
      backupFormat,
    };
    const dbLabel = databaseName || composeService;
    const label =
      keys.length === 1
        ? `${dbLabel} (${engine})`
        : `${name}: ${dbLabel} — ${composeService} (${engine})`;
    out.push({ form, config: cfg, label });
  }
  return out;
}
