import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { gzipSync } from 'zlib';
import type { DatabaseBackupConfig } from '../backup/database-backup.types';
import {
  assertSafeComposeService,
  assertSafeDbIdentifier,
  resolveBackupFormat,
} from '../backup/database-backup.types';
import { stderrIndicatesDockerFailure } from './executor-docker';

function safeSqlUser(raw: string, fallback: string): string {
  const s = (raw ?? '').trim() || fallback;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) {
    throw new Error('Invalid database user.');
  }
  return s;
}

function dockerExecArgs(containerId: string, remoteArgs: string[]): string[] {
  return ['exec', containerId, ...remoteArgs];
}

function shQuoteSingle(raw: string): string {
  return raw.replace(/'/g, `'\\''`);
}

const PG_CONTAINER_PASSWORD_SETUP =
  'if [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -z "${POSTGRES_PASSWORD:-}" ]; then ' +
  'export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE}")"; ' +
  'elif [ -n "${POSTGRES_PASSWORD:-}" ]; then export PGPASSWORD="${POSTGRES_PASSWORD}"; fi; ';

function formatEmptyStdout(tool: string, stderr: string): string {
  const se = stderr.trim();
  const hint = `${tool} wrote nothing to stdout.`;
  if (se) {
    return [se, hint].join('\n');
  }
  return `${hint} Check database name and DB user match the cluster. For password auth, ensure POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is set in the database container.`;
}

function formatRunError(e: unknown): string {
  const err = e as Error & { stderr?: string };
  let msg = e instanceof Error ? e.message : String(e);
  const stderr = typeof err.stderr === 'string' ? err.stderr : '';
  if (stderr.trim()) {
    msg = `${msg}\n${stderr.trim()}`;
  }
  return msg;
}

export async function runStructuredDatabaseBackup(
  config: DatabaseBackupConfig,
  destDir: string,
  appNameForFile: string,
  runDocker: (argv: string[]) => Promise<{ stdout: Buffer; stderr: string }>,
  containerId: string,
): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
  assertSafeComposeService(config.composeService);

  await fs.mkdir(destDir, { recursive: true });
  const outDir = path.resolve(destDir);
  const ts = Date.now();

  try {
    switch (config.engine) {
      case 'postgres': {
        const fmt = resolveBackupFormat('postgres', config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'postgres');
        const u = shQuoteSingle(user);
        const d = shQuoteSingle(db);

        let dumpCmd = `pg_dump -w -U '${u}'`;
        if (fmt === 'postgres_custom_gzip') {
          dumpCmd += ` -Fc`;
        } else if (fmt === 'postgres_tar_gzip') {
          dumpCmd += ` -Ft`;
        }
        dumpCmd += ` '${d}'`;

        const inner = PG_CONTAINER_PASSWORD_SETUP + `exec ${dumpCmd}`;
        const argv = dockerExecArgs(containerId, ['sh', '-c', inner]);

        const r = await runDocker(argv);
        const stdout = r.stdout;
        const stderr = r.stderr ?? '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return {
            success: false,
            output: [stderr].filter(Boolean).join('\n'),
          };
        }

        if (!stdout || stdout.length === 0) {
          return {
            success: false,
            output: formatEmptyStdout('pg_dump', stderr),
          };
        }

        const ext =
          fmt === 'postgres_sql_gzip'
            ? 'sql.gz'
            : fmt === 'postgres_custom_gzip'
              ? 'dump.gz'
              : 'tar.gz';

        const archiveBasename = `db-${appNameForFile}-${ts}.${ext}`;
        const fullPath = path.join(outDir, archiveBasename);

        if (fmt === 'postgres_sql_gzip') {
          await fs.writeFile(fullPath, gzipSync(stdout));
        } else {
          await fs.writeFile(fullPath, stdout);
        }

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      case 'mysql':
      case 'mariadb': {
        const isMaria = config.engine === 'mariadb';
        const fmt = resolveBackupFormat(config.engine, config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'root');
        const passEnv = isMaria
          ? 'MARIADB_ROOT_PASSWORD'
          : 'MYSQL_ROOT_PASSWORD';

        const extra =
          fmt === 'mysql_sql_extended_gzip' ||
          fmt === 'mariadb_sql_extended_gzip'
            ? ' --single-transaction --routines --triggers --events'
            : '';

        const inner = `mysqldump -u ${user} -p"$\{${passEnv}\}"${extra} ${db}`;
        const argv = dockerExecArgs(containerId, ['sh', '-c', inner]);

        const r = await runDocker(argv);
        const stdout = r.stdout;
        const stderr = r.stderr ?? '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return {
            success: false,
            output: stderr || `(${config.engine} failed)`,
          };
        }
        if (!stdout.length) {
          return { success: false, output: 'mysqldump produced no output.' };
        }

        const archiveBasename = `db-${appNameForFile}-${ts}.sql.gz`;
        const fullPath = path.join(outDir, archiveBasename);
        await fs.writeFile(fullPath, gzipSync(stdout));

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      case 'mongodb': {
        const fmt = resolveBackupFormat('mongodb', config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const dumpArgs =
          fmt === 'mongodb_archive_plain'
            ? ['mongodump', `--db=${db}`, '--archive']
            : ['mongodump', `--db=${db}`, '--archive', '--gzip'];

        const argv = dockerExecArgs(containerId, dumpArgs);
        const r = await runDocker(argv);
        const stdout = r.stdout;
        const stderr = r.stderr ?? '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || '(mongodump failed)' };
        }
        if (!stdout?.length) {
          return { success: false, output: 'mongodump produced no output.' };
        }

        const ext =
          fmt === 'mongodb_archive_plain' ? 'mongodump' : 'mongodump.gz';
        const archiveBasename = `db-${appNameForFile}-${ts}.${ext}`;
        const fullPath = path.join(outDir, archiveBasename);
        await fs.writeFile(fullPath, stdout);

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      case 'redis': {
        const argv = dockerExecArgs(containerId, ['redis-cli', '--rdb', '-']);
        const r = await runDocker(argv);
        const stdout = r.stdout;
        const stderr = r.stderr ?? '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || '(redis-cli failed)' };
        }
        if (!stdout?.length) {
          return { success: false, output: 'redis-cli produced no output.' };
        }

        const archiveBasename = `db-${appNameForFile}-${ts}.rdb`;
        const fullPath = path.join(outDir, archiveBasename);
        await fs.writeFile(fullPath, stdout);

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      default:
        return { success: false, output: 'Unsupported database engine.' };
    }
  } catch (e) {
    return { success: false, output: formatRunError(e) };
  }
}

/**
 * Same backups as {@link runStructuredDatabaseBackup}, but writes archives on the deploy host under
 * `remoteWorkDirUnix` (no dump bytes on the API server).
 */
export async function runStructuredDatabaseBackupOnRemoteHost(
  config: DatabaseBackupConfig,
  remoteWorkDirUnix: string,
  appNameForFile: string,
  containerId: string,
  execRemote: (bashBody: string) => Promise<{ stdout: string; stderr: string }>,
): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
  assertSafeComposeService(config.composeService);
  const ts = Date.now();
  const cid = JSON.stringify(containerId);
  const work = remoteWorkDirUnix.replace(/\/+$/, '');

  try {
    switch (config.engine) {
      case 'postgres': {
        const fmt = resolveBackupFormat('postgres', config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'postgres');
        const u = shQuoteSingle(user);
        const d = shQuoteSingle(db);

        let dumpCmd = `pg_dump -w -U '${u}'`;
        if (fmt === 'postgres_custom_gzip') {
          dumpCmd += ` -Fc`;
        } else if (fmt === 'postgres_tar_gzip') {
          dumpCmd += ` -Ft`;
        }
        dumpCmd += ` '${d}'`;

        const innerScript = PG_CONTAINER_PASSWORD_SETUP + `exec ${dumpCmd}`;
        const ext =
          fmt === 'postgres_sql_gzip'
            ? 'sql.gz'
            : fmt === 'postgres_custom_gzip'
              ? 'dump.gz'
              : 'tar.gz';
        const archiveBasename = `db-${appNameForFile}-${ts}.${ext}`;
        const outFile = `${work}/${archiveBasename}`;
        const outQ = shQuoteSingle(outFile);
        const marker = `WHPGBK_${ts}_${randomBytes(5).toString('hex')}`;
        const pipeGzip = fmt === 'postgres_sql_gzip' ? '| gzip -c' : '';
        const body = `set -euo pipefail
OUT=${outQ}
docker exec -i ${cid} sh -s <<'${marker}' ${pipeGzip} > "$OUT"
${innerScript}
${marker}
test -s "$OUT"
`;
        const r = await execRemote(body);
        const stderr = r.stderr ?? '';
        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || '(pg_dump failed)' };
        }
        return {
          success: true,
          output: [stderr.trim(), `Archive: ${outFile}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      case 'mysql':
      case 'mariadb': {
        const isMaria = config.engine === 'mariadb';
        const fmt = resolveBackupFormat(config.engine, config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'root');
        const passEnv = isMaria
          ? 'MARIADB_ROOT_PASSWORD'
          : 'MYSQL_ROOT_PASSWORD';
        const extra =
          fmt === 'mysql_sql_extended_gzip' ||
          fmt === 'mariadb_sql_extended_gzip'
            ? ' --single-transaction --routines --triggers --events'
            : '';
        const inner = `mysqldump -u ${user} -p"$\{${passEnv}\}"${extra} ${db}`;
        const archiveBasename = `db-${appNameForFile}-${ts}.sql.gz`;
        const outFile = `${work}/${archiveBasename}`;
        const outQ = shQuoteSingle(outFile);
        const marker = `WHMY_${ts}_${randomBytes(5).toString('hex')}`;
        const body = `set -euo pipefail
OUT=${outQ}
docker exec -i ${cid} sh -s <<'${marker}' | gzip -c > "$OUT"
${inner}
${marker}
test -s "$OUT"
`;
        const r = await execRemote(body);
        const stderr = r.stderr ?? '';
        if (stderrIndicatesDockerFailure(stderr)) {
          return {
            success: false,
            output: stderr || `(${config.engine} failed)`,
          };
        }
        return {
          success: true,
          output: [stderr.trim(), `Archive: ${outFile}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      case 'mongodb': {
        const fmt = resolveBackupFormat('mongodb', config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const dumpArgs =
          fmt === 'mongodb_archive_plain'
            ? ['mongodump', `--db=${db}`, '--archive']
            : ['mongodump', `--db=${db}`, '--archive', '--gzip'];
        const argvTail = dumpArgs.map((a) => JSON.stringify(a)).join(' ');
        const ext =
          fmt === 'mongodb_archive_plain' ? 'mongodump' : 'mongodump.gz';
        const archiveBasename = `db-${appNameForFile}-${ts}.${ext}`;
        const outFile = `${work}/${archiveBasename}`;
        const outQ = shQuoteSingle(outFile);
        const body = `set -euo pipefail
OUT=${outQ}
docker exec ${cid} ${argvTail} > "$OUT"
test -s "$OUT"
`;
        const r = await execRemote(body);
        const stderr = r.stderr ?? '';
        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || '(mongodump failed)' };
        }
        return {
          success: true,
          output: [stderr.trim(), `Archive: ${outFile}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      case 'redis': {
        const archiveBasename = `db-${appNameForFile}-${ts}.rdb`;
        const outFile = `${work}/${archiveBasename}`;
        const outQ = shQuoteSingle(outFile);
        const body = `set -euo pipefail
OUT=${outQ}
docker exec ${cid} redis-cli --rdb - > "$OUT"
test -s "$OUT"
`;
        const r = await execRemote(body);
        const stderr = r.stderr ?? '';
        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || '(redis-cli failed)' };
        }
        return {
          success: true,
          output: [stderr.trim(), `Archive: ${outFile}`]
            .filter(Boolean)
            .join('\n'),
          archiveBasename,
        };
      }

      default:
        return { success: false, output: 'Unsupported database engine.' };
    }
  } catch (e) {
    return { success: false, output: formatRunError(e) };
  }
}
