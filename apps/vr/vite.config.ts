import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // In dev, proxy property GeoJSON from the web app.
    proxy: { "/api": "http://localhost:3000" },
  },
});
