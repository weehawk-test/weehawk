import type { NextConfig } from "next";

/** Docker one-image-many-envs: build with this token, replace at container start. */
const RUNTIME_API_URL_PLACEHOLDER = "__WEEHAWK_RUNTIME_API_URL__";

/** Match {@link apps/web/app/lib/api.ts}: origin only; strip mistaken `.../api` suffix. */
function normalizePublicApiOrigin(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (u.toLowerCase().endsWith("/api")) {
    u = u.slice(0, -4).replace(/\/+$/, "");
  }
  return u || "http://localhost:8080";
}

function publicApiOriginForConfig(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").trim();
  if (raw === RUNTIME_API_URL_PLACEHOLDER) {
    // `rewrites()` requires an absolute URL (`http://`/`https://`). The entrypoint replaces
    // `http://__WEEHAWK_RUNTIME_API_URL__` and any bare token with the real origin.
    return `http://${RUNTIME_API_URL_PLACEHOLDER}`;
  }
  return normalizePublicApiOrigin(raw);
}

const apiBase = publicApiOriginForConfig();

const nextConfig: NextConfig = {
  reactStrictMode: false,
  output: "standalone",
  /** If the public webhook base URL points at this web app host, proxy /weehawk-hooks/* to the API (avoids Next.js 404). */
  async rewrites() {
    return [
      {
        source: "/weehawk-hooks/:token",
        destination: `${apiBase}/weehawk-hooks/:token`,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/docker/traefik", destination: "/traefik", permanent: true },
      {
        source: "/docker",
        destination: "/remote-server",
        permanent: true,
      },
      {
        source: "/docker/:path*",
        destination: "/remote-server",
        permanent: true,
      },
      { source: "/auth", destination: "/", permanent: true },
      { source: "/registry/git", destination: "/git", permanent: true },
      { source: "/registry/git/:path*", destination: "/git/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
