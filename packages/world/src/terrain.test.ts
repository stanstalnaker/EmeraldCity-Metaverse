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
