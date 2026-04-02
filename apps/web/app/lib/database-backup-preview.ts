/** Mirrors API `DatabaseBackupEngine` / backup format IDs. */
export type DatabaseBackupEngine =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mongodb"
  | "redis";

export type DatabaseBackupFormatId =
  | "postgres_sql_gzip"
  | "postgres_custom_gzip"
  | "postgres_tar_gzip"
  | "mysql_sql_gzip"
  | "mysql_sql_extended_gzip"
  | "mariadb_sql_gzip"
  | "mariadb_sql_extended_gzip"
  | "mongodb_archive_gzip"
  | "mongodb_archive_plain"
  | "redis_rdb";

export const DEFAULT_BACKUP_FORMAT: Record<DatabaseBackupEngine, DatabaseBackupFormatId> = {
  postgres: "postgres_sql_gzip",
  mysql: "mysql_sql_gzip",
  mariadb: "mariadb_sql_gzip",
  mongodb: "mongodb_archive_gzip",
  redis: "redis_rdb",
};

export function defaultBackupFormatForEngine(
  engine: DatabaseBackupEngine,
): DatabaseBackupFormatId {
  return DEFAULT_BACKUP_FORMAT[engine];
}

/** UI labels for backup format selects (per engine). */
export function backupFormatOptionsForEngine(
  engine: DatabaseBackupEngine,
): { value: DatabaseBackupFormatId; label: string }[] {
  switch (engine) {
    case "postgres":
      return [
        { value: "postgres_sql_gzip", label: "SQL (.sql.gz) — default" },
        { value: "postgres_custom_gzip", label: "Custom (.dump.gz)" },
        { value: "postgres_tar_gzip", label: "Tar (.tar.gz)" },
      ];
    case "mysql":
      return [
        { value: "mysql_sql_gzip", label: "SQL dump (gzip) — default" },
        {
          value: "mysql_sql_extended_gzip",
          label: "SQL + routines, triggers, events (InnoDB-safe dump)",
        },
      ];
    case "mariadb":
      return [
        { value: "mariadb_sql_gzip", label: "SQL dump (gzip) — default" },
        {
          value: "mariadb_sql_extended_gzip",
          label: "SQL + routines, triggers, events",
        },
      ];
    case "mongodb":
      return [
        { value: "mongodb_archive_gzip", label: "Single archive (gzip) — default" },
        { value: "mongodb_archive_plain", label: "Single archive (uncompressed stream)" },
      ];
    case "redis":
      return [{ value: "redis_rdb", label: "RDB snapshot — default" }];
    default:
      return [];
  }
}

export function resolveBackupFormat(
  engine: DatabaseBackupEngine,
  raw?: string | null,
): DatabaseBackupFormatId {
  const d = defaultBackupFormatForEngine(engine);
  if (raw == null || String(raw).trim() === "") return d;
  const s = String(raw).trim() as DatabaseBackupFormatId;
  if (isValidBackupFormatForEngine(engine, s)) return s;
  return d;
}

export function isValidBackupFormatForEngine(
  engine: DatabaseBackupEngine,
  format: unknown,
): boolean {
  if (format == null || format === "") return true;
  const f = String(format).trim();
  switch (engine) {
    case "postgres":
      return (
        f === "postgres_sql_gzip" ||
        f === "postgres_custom_gzip" ||
        f === "postgres_tar_gzip"
      );
    case "mysql":
      return f === "mysql_sql_gzip" || f === "mysql_sql_extended_gzip";
    case "mariadb":
      return f === "mariadb_sql_gzip" || f === "mariadb_sql_extended_gzip";
    case "mongodb":
      return f === "mongodb_archive_gzip" || f === "mongodb_archive_plain";
    case "redis":
      return f === "redis_rdb";
    default:
      return false;
  }
}

export type DatabaseBackupFormValues = {
  engine: DatabaseBackupEngine;
  composeService: string;
  databaseName: string;
  dbUser: string;
  /** Omitted = server default for engine */
  backupFormat?: string;
};

/** API shape for `databaseBackupConfig` on webhooks / cron jobs. */
export type DatabaseBackupConfig = {
  engine: DatabaseBackupEngine;
  composeService: string;
  databaseName?: string;
  dbUser?: string;
  backupFormat?: DatabaseBackupFormatId;
};

export function describeDatabaseBackupPreview(c: {
  engine: DatabaseBackupEngine;
  composeService: string;
  databaseName?: string;
  dbUser?: string;
  backupFormat?: string | null;
}): string {
  const svc = c.composeService.trim();
  const user = (c.dbUser ?? "").trim();
  const db = (c.databaseName ?? "").trim() || "…";
  const fmt = resolveBackupFormat(c.engine, c.backupFormat);
  switch (c.engine) {
    case "postgres": {
      const u = user || "postgres";
      if (fmt === "postgres_custom_gzip") {
        return `docker compose exec -T ${svc} pg_dump -U ${u} -Fc -f - ${db} → gzip → .dump.gz`;
      }
      if (fmt === "postgres_tar_gzip") {
        return `docker compose exec -T ${svc} pg_dump -U ${u} -Ft -f - ${db} → gzip → .tar.gz`;
      }
      return `docker compose exec -T ${svc} pg_dump -U ${u} ${db} → gzip → .sql.gz`;
    }
    case "mysql": {
      const ext =
        fmt === "mysql_sql_extended_gzip"
          ? " (+ --single-transaction --routines --triggers --events)"
          : "";
      return `docker compose exec -T ${svc} → mysqldump${ext} (user ${user || "root"}, DB ${db}; MYSQL_ROOT_PASSWORD)`;
    }
    case "mariadb": {
      const ext =
        fmt === "mariadb_sql_extended_gzip"
          ? " (+ --single-transaction --routines --triggers --events)"
          : "";
      return `docker compose exec -T ${svc} → mysqldump${ext} (user ${user || "root"}, DB ${db}; MARIADB_ROOT_PASSWORD)`;
    }
    case "mongodb":
      if (fmt === "mongodb_archive_plain") {
        return `docker compose exec -T ${svc} mongodump --db=${db} --archive`;
      }
      return `docker compose exec -T ${svc} mongodump --db=${db} --archive --gzip`;
    case "redis":
      return `docker compose exec -T ${svc} redis-cli --rdb -`;
    default:
      return "";
  }
}

const COMPOSE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DB_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function validateDatabaseBackupForm(
  v: DatabaseBackupFormValues,
): { ok: true } | { ok: false; message: string } {
  const svc = v.composeService.trim();
  if (!svc || !COMPOSE_RE.test(svc)) {
    return {
      ok: false,
      message: "Compose service name must match letters, numbers, dots, dashes, underscores (e.g. postgres, db-1).",
    };
  }
  if (v.engine === "redis") {
    return { ok: true };
  }
  const db = v.databaseName.trim();
  if (!db || !DB_ID_RE.test(db)) {
    return {
      ok: false,
      message: "Database name is required and must use letters, numbers, dashes, underscores.",
    };
  }
  const fmt = v.backupFormat?.trim() || "";
  if (fmt && !isValidBackupFormatForEngine(v.engine, fmt)) {
    return { ok: false, message: "Invalid backup format for this engine." };
  }
  return { ok: true };
}
