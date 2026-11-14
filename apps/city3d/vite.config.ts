import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Legacy Emerald City assets (≈1.5 GB of .babylon models and textures, including partners' branded
 * content) are NOT in this repo. In development they are served from a local checkout of
 * hub/vr-hubculture-city (LEGACY_ASSETS_DIR, default ../../../vr-hubculture-city/src) at /legacy/.
 * In production they move to a CDN after conversion to compressed GLB/KTX2 (VITE_ASSET_BASE).
 */
const legacyDir = resolve(process.env.LEGACY_ASSETS_DIR ?? resolve(__dirname, "../../../vr-hubculture-city/src"));
const TYPES: Record<string, string> = {
  ".babylon": "application/json", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".hdr": "application/octet-stream", ".env": "application/octet-stream", ".mp3": "audio/mpeg",
};

export default defineConfig({
  plugins: [
    {
      name: "legacy-assets",
      configureServer(server) {
        server.middlewares.use("/legacy", (req, res, next) => {
          const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
          const file = join(legacyDir, rel);
          if (!file.startsWith(legacyDir) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=3600");
          createReadStream(file).pipe(res);
        });
      },
    },
  ],
});
