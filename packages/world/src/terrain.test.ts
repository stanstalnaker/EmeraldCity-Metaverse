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

  it("marks both Hub Culture pavilions by address, with a teleport to each", () => {
    for (const [id, addr] of [["hub-symondsstrasse-7", "Symondsstrasse 7"], ["hub-promenade-95", "Promenade 95"]] as const) {
      const b = town.buildings.find((x) => x.hub === id);
      expect(b?.addr).toBe(addr);
      expect(world.teleports.find((t) => t.id === id)).toBeTruthy();
      expect(world.pavilions?.find((p) => p.id === id)?.osmWay).toBe(b?.id);
    }
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
