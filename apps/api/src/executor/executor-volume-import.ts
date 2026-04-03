import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import {
  normalizeHostPathForDockerBind,
  stderrIndicatesDockerFailure,
} from './executor-docker';

const execAsync = promisify(exec);

/**
 * Restores a `.tar.gz` produced by {@link runDockerVolumeBackup} into a named Docker volume.
 */
export async function runDockerVolumeImport(
  volumeName: string,
  hostArchivePath: string,
): Promise<{ success: boolean; output: string }> {
  const safe = volumeName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(safe)) {
    return { success: false, output: 'Invalid volume name.' };
  }
  const base = path.basename(hostArchivePath);
  if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/i.test(base)) {
    return {
      success: false,
      output: 'Expected a .tar.gz archive (same format as volume backups).',
    };
  }
  const hostDir = normalizeHostPathForDockerBind(path.dirname(path.resolve(hostArchivePath)));
  const execOpts = { maxBuffer: 50 * 1024 * 1024, timeout: 600_000 };
  try {
    const { stdout, stderr } = await execAsync(
      `docker run --rm -v "${safe}:/v" -v "${hostDir}:/in:ro" alpine:3.19 sh -c "cd /v && tar xzf /in/${base}"`,
      execOpts,
    );
    const se = stderr?.toString() ?? '';
    const so = stdout?.toString() ?? '';
    const out = [so, se].filter((s) => s?.trim()).join('\n');
    if (stderrIndicatesDockerFailure(se)) {
      return { success: false, output: out || se };
    }
    return { success: true, output: (out || 'Volume import finished.').slice(0, 8000) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, output: msg };
  }
}
