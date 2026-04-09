import type { NextConfig } from "next";

const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: false,
  output: "standalone",
  /** If the public webhook base URL points at this web app host, proxy /hooks/* to the API (avoids Next.js 404). */
  async rewrites() {
    return [
      {
        source: "/hooks/:token",
        destination: `${apiBase}/hooks/:token`,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/docker/traefik", destination: "/traefik", permanent: true },
      {
        source: "/docker",
        destination: "/console/local/images",
        permanent: true,
      },
      {
        source: "/docker/:path*",
        destination: "/console/local/:path*",
        permanent: true,
      },
      { source: "/auth", destination: "/", permanent: true },
      { source: "/registry/git", destination: "/git", permanent: true },
      { source: "/registry/git/:path*", destination: "/git/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
