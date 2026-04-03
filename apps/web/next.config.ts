import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async redirects() {
    return [
      { source: "/registry/git", destination: "/git", permanent: true },
      { source: "/registry/git/:path*", destination: "/git/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
