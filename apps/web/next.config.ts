import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@emerald-city/core", "@emerald-city/hubid-client", "@emerald-city/gaia-map", "@emerald-city/parcels"],
  // JSTS ships thousands of small ESM modules; let Node load it directly on the server.
  serverExternalPackages: ["jsts"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**.hubculture.com" }] },
};

export default config;
