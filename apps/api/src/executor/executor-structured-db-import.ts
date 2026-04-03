import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DatabaseBackupConfig } from '../backup/database-backup.types';
import {
  assertSafeDbIdentifier,
  assertSafeComposeService,
} from '../backup/database-backup.types';
const execAsync = promisify(exec);

const PG_CONTAINER_PASSWORD_SETUP =
  'if [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -z "${POSTGRES_PASSWORD:-}" ]; then ' +
  'export PGPASSWORD="$(cat "${POSTGRES_PASSWORD_FILE}")"; ' +
  'elif [ -n "${POSTGRES_PASSWORD:-}" ]; then export PGPASSWORD="${POSTGRES_PASSWORD}"; fi; ';

function safeSqlUser(raw: string, fallback: string): string {
  const s = (raw ?? '').trim() || fallback;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) {
    throw new Error('Invalid database user.');
  }
  return s;
}

function shQuoteForDockerExec(inner: string): string {
  return JSON.stringify(inner);
}

export async function runStructuredDatabaseImport(
  config: DatabaseBackupConfig,
  hostArchivePath: string,
  envMerged: NodeJS.ProcessEnv,
  containerId: string,
): Promise<{ success: boolean; output: string }> {
  const base = path.basename(hostArchivePath);
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) {
    return { success: false, output: 'Invalid archive file name.' };
  }

  assertSafeComposeService(config.composeService);

  try {
    await fs.access(hostArchivePath);
  } catch {
    return { success: false, output: 'Import file not found on the server.' };
  }

  const inside = `/tmp/weehawk-import-${Date.now()}`;
  const execOpts = {
    env: { ...process.env, ...envMerged },
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600_000 as number,
  };

  const hostEsc = hostArchivePath.replace(/\\/g, '/');
  try {
    await execAsync(`docker cp "${hostEsc.replace(/"/g, '\\"')}" ${containerId}:${inside}`, execOpts);
  } catch (e) {
    return {
      success: false,
      output: e instanceof Error ? e.message : String(e),
    };
  }

  const runExec = async (inner: string) => {
    const cmd = `docker exec ${containerId} sh -c ${shQuoteForDockerExec(inner)}`;
    const { stdout, stderr } = await execAsync(cmd, execOpts);
    return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
  };

  try {
    switch (config.engine) {
      case 'postgres': {
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'postgres');
        const u = user.replace(/'/g, `'\\''`);
        const d = db.replace(/'/g, `'\\''`);
        const bl = base.toLowerCase();
        let inner: string;
        if (bl.endsWith('.sql.gz')) {
          inner =
            PG_CONTAINER_PASSWORD_SETUP +
            `gunzip -c '${inside}' | psql -w -U '${u}' -d '${d}' -v ON_ERROR_STOP=1`;
        } else if (bl.endsWith('.sql')) {
          inner =
            PG_CONTAINER_PASSWORD_SETUP +
            `psql -w -U '${u}' -d '${d}' -v ON_ERROR_STOP=1 -f '${inside}'`;
        } else {
          inner =
            PG_CONTAINER_PASSWORD_SETUP +
            `pg_restore --clean --if-exists --no-owner --no-acl --verbose -w -U '${u}' -d '${d}' '${inside}'`;
        }
        const { stdout, stderr } = await runExec(inner);
        const out = [stdout, stderr].filter(Boolean).join('\n');
        return { success: true, output: out.slice(0, 8000) };
      }
      case 'mysql':
      case 'mariadb': {
        const isMaria = config.engine === 'mariadb';
        const db = assertSafeDbIdentifier(config.databaseName ?? '');
        const user = safeSqlUser(config.dbUser ?? '', 'root');
        const passVar = user === 'root'
          ? isMaria
            ? 'MARIADB_ROOT_PASSWORD'
            : 'MYSQL_ROOT_PASSWORD'
          : isMaria
            ? 'MARIADB_PASSWORD'
            : 'MYSQL_PASSWORD';
        const bl = base.toLowerCase();
        let inner: string;
        if (bl.endsWith('.sql.gz')) {
          inner = `gunzip -c '${inside}' | mysql -u${user} -p"$${passVar}" ${db}`;
        } else if (bl.endsWith('.sql')) {
          inner = `mysql -u${user} -p"$${passVar}" ${db} < '${inside}'`;
        } else {
          return {
            success: false,
            output:
              'MySQL/MariaDB import expects .sql or .sql.gz (plain SQL dump).',
          };
        }
        const { stdout, stderr } = await runExec(inner);
        const out = [stdout, stderr].filter(Boolean).join('\n');
        return { success: true, output: out.slice(0, 8000) };
      }
      case 'mongodb': {
        const bl = base.toLowerCase();
        const inner = bl.endsWith('.gz')
          ? `mongorestore --gzip --archive='${inside}' --drop`
          : `mongorestore --archive='${inside}' --drop`;
        const { stdout, stderr } = await runExec(inner);
        const out = [stdout, stderr].filter(Boolean).join('\n');
        return { success: true, output: out.slice(0, 8000) };
      }
      case 'redis':
        return {
          success: false,
          output:
            'Redis RDB import is not supported here. Use “Import volume” with a tar.gz of the data directory, or replace the RDB on the host manually.',
        };
      default:
        return { success: false, output: 'Unsupported database engine.' };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, output: msg.slice(0, 8000) };
  } finally {
    await execAsync(`docker exec ${containerId} rm -f ${inside}`, execOpts).catch(() => {});
  }
}
