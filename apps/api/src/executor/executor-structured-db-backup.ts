import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { gzipSync } from 'zlib';
import type { DatabaseBackupConfig } from '../backup/database-backup.types';
import {
  assertSafeComposeService,
  assertSafeDbIdentifier,
  resolveBackupFormat,
} from '../backup/database-backup.types';
import { stderrIndicatesDockerFailure } from './executor-docker';

const execFileAsync = promisify(execFile) as any;

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

type ExecFileError = Error & { stderr?: string | Buffer; stdout?: string | Buffer };

function formatExecFileError(e: unknown): string {
  const err = e as ExecFileError;
  let msg = e instanceof Error ? e.message : String(e);
  const stderr =
    err.stderr != null
      ? Buffer.isBuffer(err.stderr)
        ? err.stderr.toString('utf8')
        : String(err.stderr)
      : '';
  if (stderr.trim()) {
    msg = `${msg}\n${stderr.trim()}`;
  }
  return msg;
}

export async function runStructuredDatabaseBackup(
  deployDir: string,
  config: DatabaseBackupConfig,
  destDir: string,
  appNameForFile: string,
  execEnv: NodeJS.ProcessEnv,
  containerId: string,
): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
  const composeFile = path.join(deployDir, 'docker-compose.yml');
  assertSafeComposeService(config.composeService);
  const envMerged = { ...process.env, ...execEnv };

  try {
    await fs.access(composeFile);
  } catch {
    return { success: false, output: 'docker-compose.yml not found for this service.' };
  }

  await fs.mkdir(destDir, { recursive: true });
  const outDir = path.resolve(destDir);
  const ts = Date.now();

  // نستخدم Buffer كافتراضي للجميع للتعامل مع البيانات الثنائية (Binary Data)
  const optsBuf = {
    cwd: deployDir,
    env: envMerged,
    maxBuffer: 512 * 1024 * 1024, // 512MB
    timeout: 600_000,
    encoding: 'buffer' as const,
  };

  try {
    switch (config.engine) {
      case 'postgres': {
        const fmt = resolveBackupFormat('postgres', config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'postgres');
        const u = shQuoteSingle(user);
        const d = shQuoteSingle(db);

        // بناء الأمر بناءً على التنسيق المختار
        let dumpCmd = `pg_dump -w -U '${u}'`;
        if (fmt === 'postgres_custom_gzip') {
          dumpCmd += ` -Fc`; // Custom format (مضغوط تلقائياً)
        } else if (fmt === 'postgres_tar_gzip') {
          dumpCmd += ` -Ft`; // Tar format
        }
        // ملاحظة: الـ SQL العادي لا يحتاج flag إضافي، وسيخرج لـ stdout
        
        dumpCmd += ` '${d}'`;

        const inner = PG_CONTAINER_PASSWORD_SETUP + `exec ${dumpCmd}`;
        const args = dockerExecArgs(containerId, ['sh', '-c', inner]);
        
        // تنفيذ الأمر واستلام النتيجة كـ Buffer
        const r = await execFileAsync('docker', args, optsBuf);
        const stdout = r.stdout as Buffer;
        const stderr = r.stderr ? r.stderr.toString('utf8') : '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: [stderr].filter(Boolean).join('\n') };
        }

        if (!stdout || stdout.length === 0) {
          return { success: false, output: formatEmptyStdout('pg_dump', stderr) };
        }

        const ext =
          fmt === 'postgres_sql_gzip'
            ? 'sql.gz'
            : fmt === 'postgres_custom_gzip'
              ? 'dump.gz'
              : 'tar.gz';

        const archiveBasename = `db-${appNameForFile}-${ts}.${ext}`;
        const fullPath = path.join(outDir, archiveBasename);

        // إذا كان التنسيق SQL عادي، نقوم بضغطه يدوياً. التنسيقات الأخرى تُحفظ كما هي.
        if (fmt === 'postgres_sql_gzip') {
          await fs.writeFile(fullPath, gzipSync(stdout));
        } else {
          await fs.writeFile(fullPath, stdout);
        }

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`].filter(Boolean).join('\n'),
          archiveBasename,
        };
      }

      case 'mysql':
      case 'mariadb': {
        const isMaria = config.engine === 'mariadb';
        const fmt = resolveBackupFormat(config.engine, config.backupFormat);
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'root');
        const passEnv = isMaria ? 'MARIADB_ROOT_PASSWORD' : 'MYSQL_ROOT_PASSWORD';
        
        const extra = (fmt === 'mysql_sql_extended_gzip' || fmt === 'mariadb_sql_extended_gzip')
            ? ' --single-transaction --routines --triggers --events'
            : '';

        const inner = `mysqldump -u ${user} -p"$\{${passEnv}\}"${extra} ${db}`;
        const args = dockerExecArgs(containerId, ['sh', '-c', inner]);
        
        const r = await execFileAsync('docker', args, optsBuf);
        const stdout = r.stdout as Buffer;
        const stderr = r.stderr ? r.stderr.toString('utf8') : '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || `(${config.engine} failed)` };
        }
        if (!stdout.length) {
          return { success: false, output: 'mysqldump produced no output.' };
        }

        const archiveBasename = `db-${appNameForFile}-${ts}.sql.gz`;
        const fullPath = path.join(outDir, archiveBasename);
        await fs.writeFile(fullPath, gzipSync(stdout));

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`].filter(Boolean).join('\n'),
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
            
        const args = dockerExecArgs(containerId, dumpArgs);
        const r = await execFileAsync('docker', args, optsBuf);
        const stdout = r.stdout as Buffer;
        const stderr = r.stderr ? r.stderr.toString('utf8') : '';

        if (stderrIndicatesDockerFailure(stderr)) {
          return { success: false, output: stderr || '(mongodump failed)' };
        }
        if (!stdout?.length) {
          return { success: false, output: 'mongodump produced no output.' };
        }

        const ext = fmt === 'mongodb_archive_plain' ? 'mongodump' : 'mongodump.gz';
        const archiveBasename = `db-${appNameForFile}-${ts}.${ext}`;
        const fullPath = path.join(outDir, archiveBasename);
        await fs.writeFile(fullPath, stdout);

        return {
          success: true,
          output: [stderr.trim(), `Archive: ${fullPath}`].filter(Boolean).join('\n'),
          archiveBasename,
        };
      }

      case 'redis': {
        const args = dockerExecArgs(containerId, ['redis-cli', '--rdb', '-']);
        const r = await execFileAsync('docker', args, optsBuf);
        const stdout = r.stdout as Buffer;
        const stderr = r.stderr ? r.stderr.toString('utf8') : '';

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
          output: [stderr.trim(), `Archive: ${fullPath}`].filter(Boolean).join('\n'),
          archiveBasename,
        };
      }

      default:
        return { success: false, output: 'Unsupported database engine.' };
    }
  } catch (e) {
    return { success: false, output: formatExecFileError(e) };
  }
}