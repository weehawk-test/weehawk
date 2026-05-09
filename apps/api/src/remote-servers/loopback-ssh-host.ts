/**
 * True when an SSH "remote" target is the API machine itself (loopback).
 * Such hosts must not be deploy targets — use a real remote host for stacks/containers.
 */
export function isLoopbackSshHost(raw: string): boolean {
  const t = raw.trim();
  const lower = t.toLowerCase();
  return (
    lower === 'localhost' ||
    t === '127.0.0.1' ||
    lower === '::1' ||
    lower === '[::1]'
  );
}

/** Display name of the auto-created self-hosted deploy row (must stay in sync with bootstrap). */
export const SELF_HOSTED_BOOTSTRAP_REMOTE_NAME = 'This Server';

/** Legacy: was stored in `domainsJson` before empty-metadata bootstrap. */
export const SELF_HOSTED_BOOTSTRAP_MARKER = 'self_hosted_local_v1';

export type RemoteServerLoopbackIdentity = {
  host: string;
  domainsJson?: string | null;
  name?: string;
  sshUser?: string;
  serverRole?: string;
};

export function isSelfHostedBootstrapRemoteServer(
  row: RemoteServerLoopbackIdentity,
): boolean {
  const raw = row.domainsJson?.trim();
  if (raw) {
    try {
      const o = JSON.parse(raw) as { weehawkBootstrap?: string };
      if (o.weehawkBootstrap === SELF_HOSTED_BOOTSTRAP_MARKER) return true;
    } catch {
      /* ignore */
    }
  }
  if (row.serverRole?.trim().toLowerCase() !== 'deploy') return false;
  if (row.name?.trim() !== SELF_HOSTED_BOOTSTRAP_REMOTE_NAME) return false;
  if (!isLoopbackSshHost(row.host)) return false;
  return row.sshUser?.trim().toLowerCase() === 'root';
}

/**
 * Loopback SSH hosts are rejected as deploy targets unless this is the self-hosted bootstrap server row.
 */
export function isLoopbackSshDeployForbidden(
  row: RemoteServerLoopbackIdentity,
): boolean {
  return isLoopbackSshHost(row.host) && !isSelfHostedBootstrapRemoteServer(row);
}
