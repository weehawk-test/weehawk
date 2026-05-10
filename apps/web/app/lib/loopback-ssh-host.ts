/** Display name of the auto-created self-hosted deploy row (must match API bootstrap). */
export const SELF_HOSTED_BOOTSTRAP_REMOTE_NAME = "This Server";

/** Legacy: was stored in `domainsJson` before empty-metadata bootstrap. */
export const SELF_HOSTED_BOOTSTRAP_MARKER = "self_hosted_local_v1";

/** SSH hostname for the default self-hosted deploy row (container → host); must match API bootstrap. */
export const SELF_HOSTED_BOOTSTRAP_SSH_HOST = "host.docker.internal";

/** True when an SSH remote target is the machine running Weehawk (must not be a deploy host). */
export function isLoopbackSshHost(host: string): boolean {
  const raw = host.trim();
  const lower = raw.toLowerCase();
  return (
    lower === "localhost" ||
    raw === "127.0.0.1" ||
    lower === "::1" ||
    lower === "[::1]"
  );
}

export function isSelfHostedBootstrapRemoteServer(row: {
  domainsJson?: string | null;
  name: string;
  host: string;
  sshUser: string;
  serverRole: string;
}): boolean {
  const raw = row.domainsJson?.trim();
  if (raw) {
    try {
      const o = JSON.parse(raw) as { weehawkBootstrap?: string };
      if (o.weehawkBootstrap === SELF_HOSTED_BOOTSTRAP_MARKER) return true;
    } catch {
      /* ignore */
    }
  }
  if (row.serverRole !== "deploy") return false;
  if (row.name.trim() !== SELF_HOSTED_BOOTSTRAP_REMOTE_NAME) return false;
  if (!isLoopbackSshHost(row.host)) return false;
  return row.sshUser.trim().toLowerCase() === "root";
}

/**
 * Remote servers eligible as deploy targets (excludes ad-hoc loopback rows;
 * self-hosted bootstrap row stays eligible via name/host/user or legacy domainsJson marker).
 */
export function filterSshDeployServers<
  T extends {
    host: string;
    serverRole: string;
    name: string;
    sshUser: string;
    domainsJson?: string | null;
  },
>(rows: T[]): T[] {
  return rows.filter((s) => {
    if (s.serverRole !== "deploy") return false;
    if (!isLoopbackSshHost(s.host)) return true;
    return isSelfHostedBootstrapRemoteServer({
      domainsJson: s.domainsJson ?? null,
      name: s.name,
      host: s.host,
      sshUser: s.sshUser,
      serverRole: s.serverRole,
    });
  });
}
