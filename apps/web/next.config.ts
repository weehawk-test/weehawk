import type { NextConfig } from "next";

const cloudEdition =
  (process.env.NEXT_PUBLIC_WEEHAWK_EDITION ?? "").toLowerCase() === "cloud";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async redirects() {
    return [
      { source: "/docker/traefik", destination: "/traefik", permanent: true },
      {
        source: "/docker",
        destination: cloudEdition ? "/remote-server" : "/console/local/containers",
        permanent: true,
      },
      {
        source: "/docker/:path*",
        destination: cloudEdition ? "/remote-server" : "/console/local/:path*",
        permanent: true,
      },
      { source: "/auth", destination: "/", permanent: true },
      { source: "/registry/git", destination: "/git", permanent: true },
      { source: "/registry/git/:path*", destination: "/git/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
