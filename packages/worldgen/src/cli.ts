#!/usr/bin/env tsx
/**
 * World generator CLI.
 *
 *   pnpm --filter @emerald-city/worldgen describe "A Davos city for AI agents…" --out specs/my-city.json
 *       Claude writes a city spec from a description (needs Anthropic credentials). Review it.
 *
 *   pnpm --filter @emerald-city/worldgen generate specs/davos-agents-city.json --world davos [--center x,z] [--seed n]
 *       Builds the city from the spec onto the world's terrain and writes it into
 *       packages/world/data/<world>.world.json (replacing an earlier build of the same spec).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { terrainHeight, type WorldManifest } from "@emerald-city/world";
import { buildCity } from "./build";
import { describeCity } from "./describe";
import { CitySpecSchema } from "./spec";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../../world/data");
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (cmd === "describe") {
  const text = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--")).join(" ");
  const out = flag("out");
  if (!text || !out) throw new Error('usage: describe "<description>" --out specs/<name>.json');
  const spec = await describeCity(text);
  writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
  console.log(`Wrote ${out}: ${spec.name}, ${spec.districts.length} districts, ${spec.landmarks.length} landmarks. Review it, then run generate.`);
} else if (cmd === "generate") {
  const specPath = rest[0];
  const worldSlug = flag("world");
  if (!specPath || !worldSlug) throw new Error("usage: generate <spec.json> --world <slug> [--center x,z] [--seed n]");
  const spec = CitySpecSchema.parse(JSON.parse(readFileSync(specPath, "utf8")));
  const worldFile = resolve(dataDir, `${worldSlug}.world.json`);
  const world = JSON.parse(readFileSync(worldFile, "utf8")) as WorldManifest;
  const t = world.terrain;
  if (!t) throw new Error(`${worldSlug} has no terrain to build on`);
  const raw = readFileSync(resolve(dataDir, t.heightmap));
  const heights = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const ground = (x: number, z: number) =>
    x < t.origin[0] || z < t.origin[2] || x > t.origin[0] + t.size[0] || z > t.origin[2] + t.size[1] ? null : terrainHeight(t, heights, x, z);
  const center = (flag("center") ?? "0,0").split(",").map(Number) as [number, number];
  // Keep clear of the existing places: spawn/chalet group, portals and water.
  const avoid: [number, number, number][] = [
    [world.defaultSpawn.position.x, world.defaultSpawn.position.z, 70],
    ...(world.portals ?? []).map((p) => [p.position[0], p.position[2], 20] as [number, number, number]),
    ...(world.environment?.water ?? []).map((w) => [w.center[0], w.center[2], w.radius + 20] as [number, number, number]),
  ];
  const city = buildCity(spec, { center, ground, avoid, seed: Number(flag("seed") ?? 7) });
  world.generated = [...(world.generated ?? []).filter((g) => g.spec !== spec.slug), city];
  // Clear the forest inside the city (the generated parks bring their own trees).
  if (world.trees) {
    const r = (spec.sizeMeters / 2) * 1.15;
    const before = world.trees.instances.length;
    world.trees.instances = world.trees.instances.filter(([x, , z]) => Math.hypot(x - center[0], z - center[1]) > r);
    console.log(`cleared ${before - world.trees.instances.length} forest trees inside the city`);
  }
  world.teleports = [
    ...world.teleports.filter((tp) => !tp.id.startsWith(`gen:${spec.slug}:`)),
    ...city.places.map((p, i) => ({ id: `gen:${spec.slug}:${i}`, label: `${spec.name} · ${p.name}`, position: { x: p.position[0], y: p.position[1], z: p.position[2] }, group: "kiosk" as const })),
  ];
  writeFileSync(worldFile, JSON.stringify(world));
  const instances = city.batches.reduce((s, b) => s + b.transforms.length, 0);
  console.log(`${spec.name}: ${city.batches.length} batches, ${instances} instances, ${city.colliders.length} buildings, ${city.places.length} places -> ${worldFile}`);
} else {
  console.log("commands: describe, generate (see the header of src/cli.ts)");
}
