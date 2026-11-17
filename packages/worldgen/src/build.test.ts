import { describe, expect, it } from "vitest";
import { buildCity } from "./build";
import { CitySpecSchema } from "./spec";
import spec from "../specs/davos-agents-city.json";

const flat = () => 100;
const city = CitySpecSchema.parse(spec);

describe("buildCity", () => {
  it("lays out a deterministic city with landmarks, places and few draw batches", () => {
    const a = buildCity(city, { center: [0, 0], ground: flat, orientation: 0 });
    const b = buildCity(city, { center: [0, 0], ground: flat, orientation: 0 });
    expect(a).toEqual(b);
    expect(a.colliders.length).toBeGreaterThan(100);
    expect(a.batches.length).toBeLessThan(15);
    expect(a.places.map((p) => p.name)).toEqual(expect.arrayContaining(["Agent Congress Hall", "Davos Dome", "Zeke Tower", "Ven Exchange Pavilion"]));
    for (const p of a.places) expect(p.position[1]).toBeCloseTo(101.7, 0);
  });

  it("builds nothing on steep ground, off the terrain, or inside keep-out areas", () => {
    const steep = (x: number) => x * 0.8; // 80% slope everywhere
    expect(buildCity(city, { center: [0, 0], ground: steep, orientation: 0 }).colliders).toHaveLength(0);
    expect(buildCity(city, { center: [0, 0], ground: () => null }).colliders).toHaveLength(0);
    const avoided = buildCity(city, { center: [0, 0], ground: flat, orientation: 0, avoid: [[0, 0, 400]] });
    for (const [x, , z] of avoided.colliders) expect(Math.hypot(x!, z!)).toBeGreaterThan(380);
  });

  it("rejects specs that aren't buildable", () => {
    expect(CitySpecSchema.safeParse({ ...spec, sizeMeters: 50 }).success).toBe(false);
    expect(CitySpecSchema.safeParse({ ...spec, palette: { walls: "white", roofs: "#000000", accent: "#000000" } }).success).toBe(false);
  });
});
