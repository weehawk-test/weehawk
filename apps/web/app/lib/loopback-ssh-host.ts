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

/** Remote servers eligible as deploy targets (excludes loopback “local SSH” rows). */
export function filterSshDeployServers<T extends { host: string; serverRole: string }>(
  rows: T[],
): T[] {
  return rows.filter((s) => s.serverRole === "deploy" && !isLoopbackSshHost(s.host));
}
