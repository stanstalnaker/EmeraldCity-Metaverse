import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import bermuda from "../data/bermuda.world.json";
import { terrainHeight, type WorldManifest } from "./index";

const w = bermuda as unknown as WorldManifest;
const raw = readFileSync(resolve(import.meta.dirname, "../data/bermuda.r16"));
const heights = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const ground = (x: number, z: number) => terrainHeight(w.terrain!, heights, x, z);

describe("Bermuda terrain (Unity heightmap layout)", () => {
  it("puts every palm from the Unity scene on the ground", () => {
    const palms = w.trees!.instances;
    expect(palms.length).toBeGreaterThan(40);
    for (const [x, y, z] of palms) expect(Math.abs(ground(x, z) - y)).toBeLessThan(0.05);
  });

  it("keeps the portals and the arrival point above the sea", () => {
    const sea = w.environment!.water![0]!.center[1];
    for (const p of w.portals ?? []) expect(ground(p.position[0], p.position[2])).toBeGreaterThan(sea + 0.5);
    const s = w.defaultSpawn.position;
    expect(ground(s.x, s.z)).toBeGreaterThan(sea + 0.5);
  });
});

import davos from "../data/davos.world.json";
import davosTown from "../data/davos.osm.json";
import type { OsmTown } from "./index";

describe("Davos from OpenStreetMap", () => {
  const town = davosTown as unknown as OsmTown;
  const world = davos as unknown as WorldManifest;

  it("has the real town and replaces the generated one", () => {
    expect(town.buildings.length).toBeGreaterThan(2000);
    expect(town.roads.length).toBeGreaterThan(1000);
    expect(town.attribution).toMatch(/OpenStreetMap/);
    expect(world.osm).toBe("davos.osm.json");
    expect(world.generated ?? []).toHaveLength(0);
  });

  it("stands the ICON, the AGENT and the Techlodge on their open ground, with a teleport to each", () => {
    const kinds = Object.fromEntries((world.pavilions ?? []).map((p) => [p.kind, p]));
    expect(kinds.icon?.address).toMatch(/^Symondsstrasse 7/);
    expect(kinds.agent?.address).toMatch(/^Promenade 107/);
    expect(kinds.techlodge?.address).toMatch(/^Promenade 95/);
    for (const p of world.pavilions ?? []) {
      expect(world.teleports.find((t) => t.id === p.id)).toBeTruthy();
      // no town building stands on the pavilion's centre
      const [x, , z] = p.position;
      for (const b of town.buildings) {
        let inside = false;
        for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) {
          const [xi, zi] = b.ring[i]!, [xj, zj] = b.ring[j]!;
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        }
        expect(inside).toBe(false);
      }
    }
    // Visitors arrive at the ICON.
    const icon = kinds.icon!;
    const s = world.defaultSpawn.position;
    expect(Math.hypot(s.x - icon.position[0], s.z - icon.position[2])).toBeLessThan(20);
  });

  it("stores footprints counter-clockwise seen from above (walls face outward)", () => {
    for (const b of town.buildings.slice(0, 200)) {
      let a = 0;
      for (let i = 0; i < b.ring.length; i++) {
        const p = b.ring[i]!, q = b.ring[(i + 1) % b.ring.length]!;
        a += p[0] * q[1] - q[0] * p[1];
      }
      expect(a).toBeGreaterThan(0);
    }
  });
});
