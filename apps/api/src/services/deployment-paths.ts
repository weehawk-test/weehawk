import { homedir } from 'os';
import * as path from 'path';

function expandEnvTokens(input: string): string {
  if (!input) return input;
  const fromPercent = input.replace(/%([A-Z0-9_]+)%/gi, (_, key: string) => {
    const value = process.env[key];
    return typeof value === 'string' ? value : '';
  });
  const fromBraced = fromPercent.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key: string) => {
    const value = process.env[key];
    return typeof value === 'string' ? value : '';
  });
  return fromBraced.replace(/\$([A-Z0-9_]+)/gi, (_, key: string) => {
    const value = process.env[key];
    return typeof value === 'string' ? value : '';
  });
}

function resolveDeploymentsBaseDir(configuredBaseDir?: string | null): string {
  const configured = expandEnvTokens((configuredBaseDir || '').trim()).trim();
  if (configured) return path.resolve(configured);

  if (process.platform === 'win32') {
    const localAppData = (process.env.LOCALAPPDATA || '').trim();
    if (localAppData) {
      return path.join(localAppData, 'weehawk', 'deployments');
    }
    const programData = (process.env.PROGRAMDATA || '').trim();
    if (programData) {
      return path.join(programData, 'weehawk', 'deployments');
    }
  }

  return path.join(homedir(), '.weehawk', 'deployments');
}

function toSafePathSegment(raw: string): string {
  const normalized = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'service';
}

export function getServiceDeploymentDir(
  appName: string | undefined,
  configuredBaseDir?: string | null,
): string {
  const baseDir = resolveDeploymentsBaseDir(configuredBaseDir);
  const safeAppName = toSafePathSegment(appName || 'service');
  const resolvedBaseDir = path.resolve(baseDir);
  const deploymentDir = path.resolve(resolvedBaseDir, safeAppName);
  const basePrefix = resolvedBaseDir.endsWith(path.sep)
    ? resolvedBaseDir
    : `${resolvedBaseDir}${path.sep}`;

  if (deploymentDir !== resolvedBaseDir && !deploymentDir.startsWith(basePrefix)) {
    throw new Error('Invalid deployment directory path.');
  }

  return deploymentDir;
}

const VOLUME_BACKUPS_BASE = path.join('/etc', 'weehawk', 'backups');

/** Root for a user's volume backup archives (`…/backups/<userId>/`). */
export function getVolumeBackupsUserDir(userId: number | string): string {
  return path.join(VOLUME_BACKUPS_BASE, String(userId));
}

/** Host directory for volume backup archives (webhooks & cron). */
export function getVolumeBackupDestDir(
  userId: number | string,
  webhookOrJobId: string,
): string {
  return path.join(getVolumeBackupsUserDir(userId), webhookOrJobId);
}

/** Pre-change default: `cwd/webhook-backups/<userId>` (still listed for download). */
export function getLegacyWebhookBackupsUserDir(userId: number | string): string {
  return path.join(process.cwd(), 'webhook-backups', String(userId));
}
