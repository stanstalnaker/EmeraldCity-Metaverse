import { describe, expect, it } from "vitest";
import world from "../data/emerald-city.world.json";
import { modelsInRange, screensForProperty, spawnFor, type WorldManifest } from "./index";

const w = world as unknown as WorldManifest;

describe("Emerald City manifest (imported from the legacy scene)", () => {
  it("has the city's models, screens, zones, spawns and teleports", () => {
    expect(w.models.length).toBeGreaterThanOrEqual(18);
    // The 2017 type-4 houses are replaced by glass villas built in code, on the same eight lots.
    expect(w.models.find((m) => m.id === "house-4")).toBeUndefined();
    expect(w.villas).toHaveLength(8);
    expect(w.models.find((m) => m.id === "terrain")?.anchor).toBeNull(); // always loaded
    expect(w.screens.length).toBeGreaterThanOrEqual(150);
    expect(w.zones.length).toBeGreaterThanOrEqual(50);
    expect(w.teleports.filter((t) => t.group === "kiosk").map((t) => t.label)).toContain("City Hall");
    expect(w.teleports.every((t) => t.group !== "other")).toBe(true);
  });

  it("spawns at the right property, honouring the legacy first-case-wins behaviour", () => {
    expect(spawnFor(w, 167).position.x).toBeCloseTo(1042.2); // Cognizant
    expect(spawnFor(w, "235").position.z).toBeCloseTo(-901); // first '235' case, as in the live site
    expect(spawnFor(w, 999999)).toEqual(w.defaultSpawn);
    expect(spawnFor(w, null)).toEqual(w.defaultSpawn);
  });

  it("binds screens to property zones so owners' uploads appear in-world", () => {
    const btg = screensForProperty(w, 209);
    expect(btg.length).toBeGreaterThan(10);
    const c = btg[0]!.content;
    expect(c.kind).toBe("zone");
    if (c.kind === "zone") {
      expect(c.pavilionName).toMatch(/Bridging/i);
      expect(["media", "file"]).toContain(c.slot);
    }
    expect(w.screens.some((s) => s.content.kind === "link" && s.content.url.includes("live.hubculture.city"))).toBe(true);
  });

  it("streams models by distance from the viewer", () => {
    const atCognizant = modelsInRange(w, { x: 1042, y: 3, z: -85 }).map((m) => m.id);
    expect(atCognizant).toContain("terrain");
    expect(atCognizant).toContain("cognizant-n2");
    expect(atCognizant).not.toContain("montessori");
  });

  it("contains no credentials", () => {
    expect(JSON.stringify(w)).not.toMatch(/Private-Key|private_key|password|access_token|token=/i);
  });
});

import davos from "../data/davos.world.json";
import bermuda from "../data/bermuda.world.json";
import { readFileSync } from "node:fs";
import { terrainHeight } from "./index";

describe("landscape worlds", () => {
  it("Davos sits on the real valley: Davos Platz near 1,560 m, forest below the treeline", () => {
    const w = davos as unknown as WorldManifest;
    const t = w.terrain!;
    const raw = readFileSync(new URL("../data/" + t.heightmap, import.meta.url));
    const h = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    expect(h.length).toBe(t.resolution * t.resolution);
    expect(terrainHeight(t, h, 0, 0) + t.base!).toBeGreaterThan(1500);
    expect(terrainHeight(t, h, 0, 0) + t.base!).toBeLessThan(1620);
    expect(w.trees!.instances.length).toBeGreaterThan(10000);
    for (const [x, y, z] of w.trees!.instances.slice(0, 200)) {
      expect(y + t.base!).toBeLessThan(2101);
      expect(Math.abs(terrainHeight(t, h, x, z) - y)).toBeLessThan(25);
    }
    expect(w.portals!.map((p) => p.to).sort()).toEqual(["bermuda", "emerald-city"]);
  });

  it("Bermuda keeps the Unity island layout with portals home", () => {
    const w = bermuda as unknown as WorldManifest;
    expect(w.primitives!.length).toBeGreaterThan(100);
    expect(w.trees!.kind).toBe("palm");
    expect(w.portals!.map((p) => p.to).sort()).toEqual(["davos", "emerald-city"]);
  });
});

import { lotAddresses } from "./index";

describe("street addresses for lots", () => {
  it("gives every Emerald City property a stable street address, numbered out from the plaza", () => {
    const a = lotAddresses(w);
    expect(a.get("153")).toBe("001 Radiant Lane");
    expect([...a.values()].every((s) => /^\d{3} [A-Z][a-z]+ [A-Z][a-z]+$/.test(s))).toBe(true);
    expect(new Set(a.values()).size).toBe(a.size);
    expect(lotAddresses(w)).toEqual(a);
  });
});

import { villaAddresses } from "./index";

describe("glass villa addresses", () => {
  it("numbers the eight villas along Villa Way", () => {
    const a = villaAddresses(w);
    expect(a.get("villa-1")).toBe("001 Villa Way");
    expect(a.get("villa-8")).toBe("008 Villa Way");
  });
});
