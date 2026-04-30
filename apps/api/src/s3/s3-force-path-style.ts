/**
 * Infer whether to use path-style addressing for S3-compatible APIs.
 * Mirrors `apps/web/app/lib/s3-force-path-style.ts` — keep logic in sync.
 */
export function inferS3ForcePathStyle(endpoint: string): boolean {
  const trimmed = endpoint.trim();
  if (!trimmed) return false;

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return true;
  }

  const host = url.hostname.toLowerCase();
  const port = url.port;

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local')
  ) {
    return true;
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return true;
  }
  if (host.includes('r2.cloudflarestorage.com')) return true;
  if (host.includes('minio')) return true;
  if (port === '9000' || port === '9001') return true;

  if (host.endsWith('.amazonaws.com')) return false;
  if (host.endsWith('.wasabisys.com')) return false;
  if (host.endsWith('.backblazeb2.com')) return false;
  if (host.endsWith('.digitaloceanspaces.com')) return false;

  return true;
}
