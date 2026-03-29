/** Base URL for server-side fetches (SSR). Prefer `API_URL` in Docker/production so the Next server reaches the API. */
export function getServerApiBase(): string {
  const raw =
    process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  return raw.replace(/\/$/, "");
}
