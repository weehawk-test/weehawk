/** Normalize S3 prefix query: non-empty keys use trailing `/` like common prefixes. */
export function normalizeS3PrefixParam(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  let p = raw.trim().replace(/\\/g, "/");
  if (!p.endsWith("/")) p += "/";
  return p;
}
