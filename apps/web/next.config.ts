import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@emerald-city/core", "@emerald-city/hubid-client", "@emerald-city/gaia-map"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**.hubculture.com" }] },
};

export default config;
