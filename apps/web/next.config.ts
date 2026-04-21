import type { NextConfig } from "next";

/** Match {@link apps/web/app/lib/api.ts}: origin only; strip mistaken `.../api` suffix. */
function normalizePublicApiOrigin(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (u.toLowerCase().endsWith("/api")) {
    u = u.slice(0, -4).replace(/\/+$/, "");
  }
  return u || "http://localhost:8080";
}

const apiBase = normalizePublicApiOrigin(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080");

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
