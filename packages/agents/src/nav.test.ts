import { describe, expect, it } from "vitest";
import davos from "@emerald-city/world/data/davos.world.json";
import town from "@emerald-city/world/data/davos.osm.json";
import type { OsmTown, WorldManifest } from "@emerald-city/world";
import { findPlace, placesOf, routeLength, StreetGraph, Walker } from "./nav";

const world = davos as unknown as WorldManifest;
const graph = StreetGraph.fromTown(town as unknown as OsmTown);
const places = placesOf(world);

describe("agents finding their way in Davos", () => {
  it("knows the pavilions and landmarks by short names", () => {
    expect(findPlace(places, "icon")?.label).toMatch(/ICON/);
    expect(findPlace(places, "agent")?.label).toMatch(/AGENT/);
    expect(findPlace(places, "techlodge")?.label).toMatch(/Techlodge/);
    expect(findPlace(places, "kongress")?.label).toBe("Congress Centre");
  });

  it("walks the streets between the AGENT and the Techlodge, not through the houses", () => {
    const a = findPlace(places, "agent")!, b = findPlace(places, "techlodge")!;
    const route = graph.route([a.x, a.z], [b.x, b.z]);
    const straight = Math.hypot(b.x - a.x, b.z - a.z);
    expect(route.length).toBeGreaterThan(3);
    expect(routeLength(route)).toBeGreaterThan(straight);
    expect(routeLength(route)).toBeLessThan(straight * 2.5);
  });

  it("walks at the pace it's given and arrives", () => {
    const w = new Walker([[0, 0], [10, 0]], 2);
    expect(w.step(1).x).toBeCloseTo(2);
    const end = w.step(10);
    expect(end.done).toBe(true);
    expect(end.x).toBeCloseTo(10);
  });
});
