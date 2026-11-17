#!/usr/bin/env node
/**
 * Convert the legacy Emerald City models (.babylon, about 1.5 GB) to compressed GLB for the CDN.
 *
 *   1. With the city3d dev server running (it serves the legacy checkout at /legacy/), each model
 *      is loaded in headless Chromium and exported to GLB by Babylon's exporter (convert.html).
 *   2. gltf-transform optimises it: dedupe, prune, weld, meshopt-compressed and quantised geometry,
 *      textures resized to at most 2048 px and re-encoded as WebP. join, flatten and palette are off:
 *      they rename or merge meshes (screens, lifts and interactions match meshes by name), and
 *      palette materials came out fully metallic (black).
 *
 *   node packages/world/scripts/convert-legacy.mjs <out-dir> [model-id ...]
 *   env: CITY3D_URL (default http://127.0.0.1:5174), GLTF_TRANSFORM (path to the gltf-transform CLI)
 *
 * Output: <out-dir>/<same relative path>.glb plus <out-dir>/report.json (sizes before and after).
 * The output is served as VITE_ASSET_BASE with VITE_ASSET_FORMAT=glb. It is never committed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const [outDir, ...only] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: convert-legacy.mjs <out-dir> [model-id ...]");
  process.exit(1);
}
const base = process.env.CITY3D_URL ?? "http://127.0.0.1:5174";
const cli = process.env.GLTF_TRANSFORM ?? "gltf-transform";
const legacyDir = resolve(process.env.LEGACY_ASSETS_DIR ?? new URL("../../../../vr-hubculture-city/src", import.meta.url).pathname);
const world = JSON.parse(readFileSync(new URL("../data/emerald-city.world.json", import.meta.url), "utf8"));
const models = world.models.filter((m) => !only.length || only.includes(m.id));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.setDefaultTimeout(900_000);
await page.goto(`${base}/convert.html`);
await page.waitForFunction(() => window.__converterReady === true);

const report = [];
for (const m of models) {
  const t0 = Date.now();
  const raw = join(outDir, "_raw", m.file.replace(/\.babylon$/, ".glb"));
  const out = join(outDir, m.file.replace(/\.babylon$/, ".glb"));
  mkdirSync(dirname(raw), { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  try {
    const r = await page.evaluate((f) => window.__convert(f), m.file);
    writeFileSync(raw, Buffer.from(r.base64, "base64"));
    execFileSync(cli, ["optimize", raw, out, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "2048", "--simplify", "false", "--instance", "false", "--join", "false", "--palette", "false", "--flatten", "false"], { stdio: "pipe" });
    const before = statSync(join(legacyDir, m.file)).size;
    const after = statSync(out).size;
    report.push({ id: m.id, file: m.file, before, after, meshes: r.meshes, seconds: Math.round((Date.now() - t0) / 1000) });
    console.log(`${m.id}: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB (${r.meshes} meshes, ${Math.round((Date.now() - t0) / 1000)} s)`);
  } catch (e) {
    report.push({ id: m.id, file: m.file, error: String(e).slice(0, 300) });
    console.log(`${m.id}: FAILED ${String(e).slice(0, 200)}`);
  }
}
await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
const ok = report.filter((r) => r.after);
const sum = (k) => ok.reduce((s, r) => s + r[k], 0) / 1e6;
console.log(`total: ${sum("before").toFixed(0)} MB -> ${sum("after").toFixed(0)} MB across ${ok.length}/${report.length} models`);
