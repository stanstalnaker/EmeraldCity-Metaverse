import { describe, expect, it } from "vitest";
import world from "../data/emerald-city.world.json";
import { modelsInRange, screensForProperty, spawnFor, type WorldManifest } from "./index";

const w = world as unknown as WorldManifest;

describe("Emerald City manifest (imported from the legacy scene)", () => {
  it("has the city's models, screens, zones, spawns and teleports", () => {
    expect(w.models.length).toBeGreaterThanOrEqual(19);
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
