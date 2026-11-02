/**
 * Generate starter cities and write GeoJSON + SVG previews.
 *   pnpm --filter @emerald-city/parcels generate emerald-city nova-lisboa --out ./out
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cutParcels, generateStarterCity, parcelsToGeoJSON, renderSvg } from "./index";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1]! : "out";
const slugs = args.filter((a, i) => a !== "--out" && i !== outIdx + 1);
if (slugs.length === 0) {
  console.error("usage: generate <city-slug>... [--out dir]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

for (const slug of slugs) {
  const t0 = Date.now();
  const plan = generateStarterCity(slug);
  const result = cutParcels(slug, plan.layers);
  const areas = result.parcels.map((p) => p.areaM2 / 10_000).sort((a, b) => a - b);
  const summary = `${areas.length} parcels · median ${areas[areas.length >> 1]!.toFixed(2)} ha · largest ${areas.at(-1)!.toFixed(0)} ha`;
  writeFileSync(join(outDir, `${slug}.geojson`), JSON.stringify(parcelsToGeoJSON(result)));
  writeFileSync(join(outDir, `${slug}.svg`), renderSvg(result, plan.layers.land, 900, `${slug} — ${summary}`));
  console.log(`${slug}: ${summary} (${Date.now() - t0} ms) → ${outDir}/${slug}.{geojson,svg}`);
}
