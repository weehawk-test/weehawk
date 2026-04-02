import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  normalizeHostPathForDockerBind,
  stderrIndicatesDockerFailure,
} from './executor-docker';

const execAsync = promisify(exec);

export type VolumeBackupResult = {
  success: boolean;
  output: string;
  archiveBasename?: string;
};

/**
 * Creates a `.tar.gz` of a Docker named volume by running `alpine tar` with the volume
 * mounted read-only and `destDir` mounted as the output folder (same pattern as manual
 * `docker run -v vol:/v -v hostOut:/out`).
 */
export async function runDockerVolumeBackup(
  volumeName: string,
  destDir: string,
): Promise<VolumeBackupResult> {
  const safe = volumeName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(safe)) {
    return { success: false, output: 'Invalid volume name.' };
  }
  await fs.mkdir(destDir, { recursive: true });
  const outDir = path.resolve(destDir);
  const archiveBasename = `vol-${safe}-${Date.now()}.tar.gz`;
  const hostOut = path.join(outDir, archiveBasename);
  const hostMount = normalizeHostPathForDockerBind(outDir).replace(
    /"/g,
    '\\"',
  );
  try {
    const { stdout, stderr } = await execAsync(
      `docker run --rm -v "${safe}:/v:ro" -v "${hostMount}:/out" alpine tar czf "/out/${archiveBasename}" -C /v .`,
      { maxBuffer: 20 * 1024 * 1024, timeout: 600_000 },
    );
    const out = [stdout, stderr]
      .filter((s) => s && String(s).trim())
      .join('\n');
    const err = stderr ?? '';
    const failed = stderrIndicatesDockerFailure(err);
    return {
      success: !failed,
      output: [out, `Archive: ${hostOut}`].filter(Boolean).join('\n'),
      archiveBasename,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, output: msg };
  }
}
