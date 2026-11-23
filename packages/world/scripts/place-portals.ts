/**
 * Put each world's portals where arriving visitors see them: ahead of the arrival point, side by
 * side, standing on the ground. Run after regenerating a world: `tsx scripts/place-portals.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { terrainHeight, type WorldManifest } from "../src/index";

const AHEAD = 16; // metres in front of the arrival point
const APART = 12; // between portals

// Emerald City's portals are hand-placed on the arrival plaza (its ground is city models, not a heightmap).
for (const slug of ["davos", "bermuda"]) {
  const file = resolve(import.meta.dirname, `../data/${slug}.world.json`);
  const w = JSON.parse(readFileSync(file, "utf8")) as WorldManifest;
  if (!w.portals?.length) continue;
  const s = w.defaultSpawn;
  const heights = w.terrain ? new Uint16Array(new Uint8Array(readFileSync(resolve(import.meta.dirname, "../data", w.terrain.heightmap))).buffer) : null;
  const ground = (x: number, z: number) => (w.terrain && heights ? terrainHeight(w.terrain, heights, x, z) : s.position.y);
  const n = w.portals.length;
  const g0 = w.terrain ? ground(s.position.x, s.position.z) : s.position.y;
  // Unity walls and shapes: keep portals (and the walk to them) clear of anything solid.
  const solids = (w.primitives ?? []).filter((p) => p.shape !== "plane" && p.shape !== "quad").map((p) => ({ x: p.position[0], z: p.position[2], r: Math.max(Math.abs(p.scale[0]), Math.abs(p.scale[2])) / 2 + 2 }));
  // A real town (OpenStreetMap): its buildings are solid too.
  if (w.osm) {
    const town = JSON.parse(readFileSync(resolve(import.meta.dirname, "../data", w.osm), "utf8")) as { buildings: { ring: [number, number][] }[] };
    for (const b of town.buildings) {
      const cx = b.ring.reduce((a, p) => a + p[0], 0) / b.ring.length;
      const cz = b.ring.reduce((a, p) => a + p[1], 0) / b.ring.length;
      if (Math.hypot(cx - s.position.x, cz - s.position.z) > 120) continue;
      const r = Math.max(...b.ring.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
      solids.push({ x: cx, z: cz, r: r + 2 });
    }
  }
  const blocked = (x: number, z: number) => solids.some((b) => Math.hypot(b.x - x, b.z - z) < b.r);
  // Never in the sea or a lake: keep portals at least half a metre above the water.
  const waterY = Math.max(-Infinity, ...(w.environment?.water ?? []).map((wt) => wt.center[1]));
  const wet = (x: number, z: number) => ground(x, z) < waterY + 0.5;
  const layout = (yaw: number, ahead: number) => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return w.portals!.map((_, i) => {
      const off = (i - (n - 1) / 2) * APART;
      return { x: s.position.x + fx * ahead + rx * off, z: s.position.z + fz * ahead + rz * off };
    });
  };
  // Prefer straight ahead; turn or step closer only as far as needed for flat, open ground.
  let best = { cost: Infinity, spots: layout(s.rotationY, AHEAD) };
  for (const turn of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
    for (const ahead of [AHEAD, 13, 20, 10, 25]) {
      const spots = layout(s.rotationY + turn, ahead);
      let cost = Math.abs(turn) * 2 + Math.abs(ahead - AHEAD) * 0.1;
      for (const p of spots) {
        cost += Math.abs(ground(p.x, p.z) - g0) * 3;
        if (blocked(p.x, p.z)) cost += 500;
        if (wet(p.x, p.z)) cost += 1000;
        // the path from the arrival point to the portal
        for (let t = 0.15; t <= 1.0001; t += 0.1) if (blocked(s.position.x + (p.x - s.position.x) * t, s.position.z + (p.z - s.position.z) * t)) cost += 100;
      }
      if (cost < best.cost) best = { cost, spots };
    }
  }
  w.portals = w.portals.map((p, i) => {
    const { x, z } = best.spots[i]!;
    const { rotationY: _ignored, ...rest } = p;
    return { ...rest, position: [+x.toFixed(1), +ground(x, z).toFixed(2), +z.toFixed(1)] as [number, number, number] };
  });
  writeFileSync(file, JSON.stringify(w, null, 1) === readFileSync(file, "utf8") ? readFileSync(file, "utf8") : reformat(file, w));
  console.log(slug, w.portals.map((p) => `${p.to} ${p.position.join(",")}`).join(" · "));
}

/** Keep the file's existing indentation style. */
function reformat(file: string, w: WorldManifest): string {
  const raw = readFileSync(file, "utf8");
  const indent = /^\{\n( +)/.exec(raw)?.[1]?.length ?? 0;
  return JSON.stringify(w, null, indent || undefined) + (raw.endsWith("\n") ? "\n" : "");
}
