/** Trims and strips CR — CRLF line endings in `.env` on Windows can break OAuth redirect_uri matching. */
export function cleanEnv(value: string | undefined): string {
  return (value ?? '').replace(/\r/g, '').trim();
}
