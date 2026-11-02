import { describe, expect, it } from "vitest";
import * as G from "./geom";
import { cutParcels, generateStarterCity, layersFromOverpass, parcelsToGeoJSON, stitch, RULES, type CityLayers, type OverpassResult } from "./index";

const square = (s: number): [number, number][] => [[0, 0], [s, 0], [s, s], [0, s], [0, 0]];
const base = (over: Partial<CityLayers> = {}): CityLayers => ({
  land: [[square(1000)]],
  roads: [],
  water: { lines: [], areas: [] },
  borders: [],
  reserved: [],
  ...over,
});
const ha = (m2: number) => m2 / 10_000;

describe("cutParcels: platform rules", () => {
  it("roads are public corridors: a cross of local roads makes four parcels", () => {
    const r = cutParcels("t", base({ roads: [{ line: [[500, -10], [500, 1010]], cls: "local" }, { line: [[-10, 500], [1010, 500]], cls: "local" }] }));
    expect(r.parcels).toHaveLength(4);
    for (const p of r.parcels) expect(ha(p.areaM2)).toBeCloseTo(ha(494 * 494), 1);
    expect(r.stats.roadsM2).toBeGreaterThan(0);
  });

  it("parcels never overlap each other, roads, water or reserved land", () => {
    const plan = generateStarterCity("overlap-check");
    const r = cutParcels("overlap-check", plan.layers);
    const geoms = r.parcels.map((p) => G.polygon(p.rings));
    const sum = geoms.reduce((s, g) => s + G.area(g), 0);
    const merged = G.union(geoms);
    expect(G.area(merged)).toBeCloseTo(sum, -1); // union area == sum of areas → no overlaps (to ~10 m²)
    const publicSpace = G.union([r.roads, r.water, ...r.reserved.map((p) => G.polygon(p.rings))]);
    expect(G.area(G.intersection(merged, publicSpace))).toBeLessThan(10);
    const accounted = sum + r.stats.roadsM2 + r.stats.waterM2 + r.stats.reservedM2;
    expect(accounted).toBeLessThanOrEqual(r.stats.landM2 * 1.001);
    expect(accounted).toBeGreaterThan(r.stats.landM2 * 0.95); // remainder: slivers, track corridors, borders
  });

  it("drops slivers: tiny pieces and long thin medians between carriageways", () => {
    // Carriageways 25 m apart leave a 5 m × 1 km median: 5,000 m², but far too thin to be property.
    const median = cutParcels("t", base({ roads: [{ line: [[-10, 500], [1010, 500]], cls: "major" }, { line: [[-10, 525], [1010, 525]], cls: "major" }] }));
    expect(median.parcels).toHaveLength(2);
    expect(median.stats.slivers).toBe(1);
    // A traffic island: a 20 m triangle formed by three local roads.
    const island = cutParcels("t", base({ roads: [
      { line: [[300, 300], [700, 300]], cls: "local" }, { line: [[300, 300], [500, 700]], cls: "local" }, { line: [[700, 300], [500, 700]], cls: "local" },
      { line: [[-10, 330], [1010, 330]], cls: "local" },
    ] }));
    expect(island.parcels.every((p) => p.areaM2 >= RULES.minParcelM2 && (2 * p.areaM2) / G.perimeter(G.polygon(p.rings)) >= RULES.minParcelWidthM)).toBe(true);
  });

  it("re-cuts on tracks only when a parcel is larger than the threshold", () => {
    const track = { line: [[500, -10], [500, 1010]] as [number, number][], cls: "track" as const };
    expect(cutParcels("t", base({ land: [[square(1000)]], roads: [track] })).parcels).toHaveLength(2); // 100 ha > 25 ha: re-cut
    const small = base({ land: [[square(400)]], roads: [{ line: [[200, -10], [200, 410]], cls: "track" }] });
    expect(cutParcels("t", small).parcels).toHaveLength(1); // 16 ha: tracks ignored
  });

  it("political borders always cut, so no parcel spans two jurisdictions", () => {
    const r = cutParcels("t", base({ land: [[square(300)]], borders: [{ line: [[150, -10], [150, 310]], level: "county" }] }));
    expect(r.parcels).toHaveLength(2);
  });

  it("rivers and reserved land are excluded and reported", () => {
    const r = cutParcels(
      "t",
      base({
        water: { lines: [{ line: [[-10, 300], [1010, 300]], cls: "river" }], areas: [] },
        reserved: [{ rings: [[[600, 600], [800, 600], [800, 800], [600, 800], [600, 600]]], reason: "national-park" }],
      }),
    );
    expect(r.parcels).toHaveLength(2);
    expect(r.reserved).toHaveLength(1);
    expect(r.reserved[0]).toMatchObject({ status: "reserved", reservedReason: "national-park" });
    expect(ha(r.stats.waterM2)).toBeCloseTo(5, 1);
  });
});

describe("generateStarterCity", () => {
  it("is deterministic per slug: same plan, same parcel ids", () => {
    const a = cutParcels("emerald-city", generateStarterCity("emerald-city").layers);
    const b = cutParcels("emerald-city", generateStarterCity("emerald-city").layers);
    expect(a.parcels.map((p) => p.id)).toEqual(b.parcels.map((p) => p.id));
    expect(new Set(a.parcels.map((p) => p.id)).size).toBe(a.parcels.length);
  });

  it("gives each city unique topography with an urban-to-rural gradient", () => {
    const one = cutParcels("nova-lisboa", generateStarterCity("nova-lisboa").layers);
    const two = cutParcels("kyoto-bay", generateStarterCity("kyoto-bay").layers);
    expect(one.parcels.length).not.toBe(two.parcels.length);
    for (const r of [one, two]) {
      const tiers = new Set(r.parcels.map((p) => p.tier));
      expect(tiers).toContain("core");
      expect(tiers).toContain("rural");
      expect(r.reserved.some((p) => p.reservedReason === "park")).toBe(true);
      expect(r.stats.waterM2).toBeGreaterThan(0);
    }
  });
});

describe("Gaia importer", () => {
  const way = (id: number, tags: Record<string, string>, pts: [number, number][]) => ({
    type: "way" as const,
    id,
    tags,
    geometry: pts.map(([lon, lat]) => ({ lon, lat })),
  });
  const bbox = { south: 51.5, west: -0.13, north: 51.51, east: -0.11 };
  const data: OverpassResult = {
    elements: [
      way(1, { highway: "residential" }, [[-0.12, 51.499], [-0.12, 51.511]]),
      way(2, { highway: "footway" }, [[-0.125, 51.499], [-0.125, 51.511]]),
      way(3, { highway: "service", service: "driveway" }, [[-0.115, 51.499], [-0.115, 51.511]]),
      way(4, { boundary: "administrative", admin_level: "6" }, [[-0.131, 51.505], [-0.109, 51.505]]),
      way(5, { boundary: "administrative", admin_level: "10" }, [[-0.131, 51.507], [-0.109, 51.507]]),
    ],
  };

  it("keeps borders by country admin level and ignores footways and driveways", () => {
    const { layers } = layersFromOverpass(data, { bbox, countryCode: "GB" });
    expect(layers.roads).toHaveLength(1);
    expect(layers.borders.map((b) => b.level)).toEqual(["county"]);
    const r = cutParcels("gaia", layers);
    expect(r.parcels).toHaveLength(4); // road splits west/east, county line splits north/south
  });

  it("exports Gaia parcels as lng/lat GeoJSON", () => {
    const { layers, frame } = layersFromOverpass(data, { bbox, countryCode: "GB" });
    const fc = parcelsToGeoJSON(cutParcels("gaia", layers), (p) => frame.toLngLat(p));
    const [lng, lat] = fc.features[0]!.geometry.coordinates[0]![0]!;
    expect(lng).toBeGreaterThan(-0.131);
    expect(lng).toBeLessThan(-0.109);
    expect(lat).toBeGreaterThan(51.49);
    expect(lat).toBeLessThan(51.52);
  });

  it("stitches relation members into closed rings regardless of direction", () => {
    const rings = stitch([[[0, 0], [10, 0]], [[10, 10], [10, 0]], [[10, 10], [0, 10], [0, 0]]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual(rings[0]!.at(-1));
  });
});
