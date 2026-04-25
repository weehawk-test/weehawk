/** Normalize S3 prefix query: non-empty keys use trailing `/` like common prefixes. */
export function normalizeS3PrefixParam(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  let p = raw.trim().replace(/\\/g, "/");
  if (!p.endsWith("/")) p += "/";
  return p;
}

/** Convert normalized prefix (`foo/bar/`) to path segments (`["foo","bar"]`). */
export function s3PrefixToPathSegments(prefix: string): string[] {
  const p = normalizeS3PrefixParam(prefix).replace(/\/+$/, "");
  if (!p) return [];
  return p.split("/").filter(Boolean);
}

/** Convert optional catch-all path segments to normalized prefix (`foo/bar/`). */
export function s3PathSegmentsToPrefix(
  segments: readonly string[] | undefined | null,
): string {
  if (!segments || segments.length === 0) return "";
  const joined = segments.map((part) => String(part ?? "").trim()).filter(Boolean).join("/");
  return normalizeS3PrefixParam(joined);
}
