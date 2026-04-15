/** `remote_servers.publicId` (or legacy numeric id) in `/docker-manager/[serverId]`. */
export type DockerConsoleTarget = string;

/** URL segment under `/docker-manager/[serverId]` → target, or null if invalid */
export function parseConsoleServerSlug(slug: string): DockerConsoleTarget | null {
  const t = slug.trim();
  if (!t || t.toLowerCase() === "local") return null;
  if (/^[A-Za-z0-9_-]+$/.test(t)) return t;
  return null;
}

