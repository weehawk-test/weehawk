import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async redirects() {
    return [
      { source: "/docker/traefik", destination: "/traefik", permanent: true },
      { source: "/auth", destination: "/", permanent: true },
      { source: "/registry/git", destination: "/git", permanent: true },
      { source: "/registry/git/:path*", destination: "/git/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
