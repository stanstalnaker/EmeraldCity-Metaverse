import { tierFor, type Parcel, type ReservedReason } from "@emerald-city/core";
import * as G from "./geom";
import { RULES, type BorderLevel, type ParcelRules, type RoadClass, type WaterClass } from "./rules";

/** Everything that shapes a city's parcels, in planar metres. */
export interface CityLayers {
  /** Land the city covers (coastline / extent). Anything outside is water or off-map. */
  land: G.PolygonRings[];
  roads: { line: G.Ring; cls: RoadClass }[];
  water: { lines: { line: G.Ring; cls: WaterClass }[]; areas: G.PolygonRings[] };
  borders: { line: G.Ring; level: BorderLevel }[];
  /** Held back from claiming (and held by Hub Culture): parks, disputed areas, national parks. */
  reserved: { rings: G.PolygonRings; reason: ReservedReason }[];
}

export interface CutResult {
  parcels: Parcel[];
  /** Public space: road and water corridors (planar geometry, for rendering). */
  roads: G.Geom;
  water: G.Geom;
  reserved: Parcel[];
  /** Areas are exclusive (water, then reserved, then roads), so they never double count. */
  stats: { landM2: number; roadsM2: number; waterM2: number; reservedM2: number; recut: number; slivers: number };
}

/**
 * Cuts a city's land into parcels, strongest borders first:
 *   1. political borders (national / state / county), 2. water, 3. reserved land,
 *   4. road corridors (major + local), 5. re-cut large parcels on service roads and tracks.
 * Pieces under the minimum size are folded into public space.
 */
export function cutParcels(cityId: string, layers: CityLayers, rules: ParcelRules = RULES): CutResult {
  const land = G.union(layers.land.map(G.polygon));
  const corridors = <T extends string>(items: { line: G.Ring; cls: T }[], widths: Record<T, number>, pick?: (c: T) => boolean) =>
    G.union(items.filter((i) => !pick || pick(i.cls)).map((i) => G.corridor(i.line, widths[i.cls])));

  const borders = G.union(layers.borders.map((b) => G.corridor(b.line, rules.borderHalfWidth)));
  const water = G.intersection(
    G.union([corridors(layers.water.lines, rules.waterHalfWidth, () => true), ...layers.water.areas.map(G.polygon)]),
    land,
  );
  const reservedGeoms = layers.reserved.map((r) => ({ geom: G.intersection(G.polygon(r.rings), land), reason: r.reason }));
  const reservedAll = G.union(reservedGeoms.map((r) => r.geom));
  const roads = G.intersection(corridors(layers.roads, rules.roadHalfWidth, (c) => c === "major" || c === "local"), land);
  const minor = corridors(layers.roads, rules.roadHalfWidth, (c) => c === "service" || c === "track");

  let claimable = G.difference(land, borders);
  claimable = G.difference(claimable, water);
  claimable = G.difference(claimable, reservedAll);
  claimable = G.difference(claimable, roads);

  const pieces: G.Geom[] = [];
  let recut = 0;
  let slivers = 0;
  for (const piece of G.polygons(claimable)) {
    if (G.area(piece) > rules.recutAboveM2) {
      const parts = G.polygons(G.difference(piece, minor));
      if (parts.length > 1) recut++;
      pieces.push(...parts);
    } else pieces.push(piece);
  }
  const kept = pieces.filter((p) => {
    const a = G.area(p);
    const ok = a >= rules.minParcelM2 && (2 * a) / G.perimeter(p) >= rules.minParcelWidthM;
    if (!ok) slivers++;
    return ok;
  });

  const toParcel = (geom: G.Geom, status: Parcel["status"], reason?: ReservedReason): Parcel => {
    const areaM2 = G.area(geom);
    return {
      id: parcelId(cityId, rules.version, G.centroid(geom), areaM2),
      cityId,
      status,
      areaM2,
      tier: tierFor(areaM2),
      rings: G.rings(geom),
      ...(reason ? { reservedReason: reason } : {}),
    };
  };

  const parcels = kept.map((p) => toParcel(p, "free"));
  const reserved = reservedGeoms.flatMap((r) => G.polygons(r.geom).map((p) => toParcel(p, "reserved", r.reason)));
  return {
    parcels,
    roads,
    water,
    reserved,
    stats: {
      landM2: G.area(land),
      waterM2: G.area(water),
      reservedM2: G.area(G.difference(reservedAll, water)),
      roadsM2: G.area(G.difference(G.difference(roads, water), reservedAll)),
      recut,
      slivers,
    },
  };
}

/**
 * Stable parcel id: same city + rules + geometry (to the metre) → same id. Recomputing an area
 * whose roads didn't change therefore keeps ids, so claims stay attached.
 */
export function parcelId(cityId: string, rulesVersion: string, [cx, cy]: G.XY, areaM2: number): string {
  const key = `${cityId}|${rulesVersion}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(areaM2)}`;
  return `p_${hash53(key).toString(36)}`;
}

/** cyrb53: small, fast, well-distributed 53-bit string hash (runs in browsers and Node). */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
