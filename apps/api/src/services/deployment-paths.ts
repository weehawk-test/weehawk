import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * Ephemeral deploy workspace on the control plane (under OS temp). Real compose/stacks and builds
 * run on the user’s SSH deploy host; this path is only for staging source/context when needed.
 */
export function toSafePathSegment(raw: string): string {
  const normalized = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'service';
}

export function getServiceDeploymentDir(
  appName: string | undefined,
  serviceId?: number | null,
): string {
  const safeAppName = toSafePathSegment(appName || 'service');
  const idPart = serviceId != null && serviceId >= 1 ? `-svc${serviceId}` : '';
  return path.join(tmpdir(), 'weehawk-orchestrator', `${safeAppName}${idPart}`);
}

/** Temp directory for a single backup run (volume tar.gz or DB dump); removed after S3 upload. */
export async function createBackupTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'weehawk-backup-'));
}

export async function removeBackupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
