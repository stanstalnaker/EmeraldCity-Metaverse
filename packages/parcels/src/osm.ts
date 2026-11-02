/**
 * Gaia layer importer: turns OpenStreetMap data (Overpass JSON with `out geom`) into CityLayers in a
 * local metric frame, and converts parcel rings back to [lng, lat].
 *
 * Parcel data derived from OSM is © OpenStreetMap contributors and falls under the ODbL.
 *
 * Production note: build land/ocean from the pre-processed OSM land polygons rather than raw
 * coastline ways; this importer treats the requested bbox as land and subtracts mapped water areas.
 */
import type { ReservedReason } from "@emerald-city/core";
import type { CityLayers } from "./cut";
import type { PolygonRings, Ring, XY } from "./geom";
import { adminLevelsFor } from "./admin-levels";
import { OSM_ROAD_CLASS, OSM_SERVICE_NEVER, type BorderLevel } from "./rules";

export interface OverpassGeomPoint {
  lat: number;
  lon: number;
}
export interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry: OverpassGeomPoint[];
}
export interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members: { type: string; role: string; geometry?: OverpassGeomPoint[] }[];
}
export interface OverpassResult {
  elements: (OverpassWay | OverpassRelation | { type: "node" })[];
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Equirectangular local frame around the bbox centre: accurate to well under 1% across a city-sized area. */
export class LocalFrame {
  readonly lat0: number;
  readonly lon0: number;
  private readonly kx: number;
  private static readonly ky = 110_540;

  constructor(bbox: Bbox) {
    this.lat0 = (bbox.south + bbox.north) / 2;
    this.lon0 = (bbox.west + bbox.east) / 2;
    this.kx = 111_320 * Math.cos((this.lat0 * Math.PI) / 180);
  }

  toXY(lon: number, lat: number): XY {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * LocalFrame.ky];
  }

  toLngLat([x, y]: XY): XY {
    return [this.lon0 + x / this.kx, this.lat0 + y / LocalFrame.ky];
  }
}

export interface OsmImportOptions {
  bbox: Bbox;
  /** ISO 3166-1 alpha-2, selects which admin levels count as state / county. */
  countryCode?: string;
}

const RESERVED_TAGS: [ReservedReason, (t: Record<string, string>) => boolean][] = [
  ["disputed", (t) => t.boundary === "disputed" || t.disputed === "yes"],
  ["national-park", (t) => t.boundary === "national_park" || (t.boundary === "protected_area" && t.protect_class === "2")],
];

export function layersFromOverpass(data: OverpassResult, opts: OsmImportOptions): { layers: CityLayers; frame: LocalFrame } {
  const frame = new LocalFrame(opts.bbox);
  const P = (pts: OverpassGeomPoint[]): Ring => pts.map((p) => frame.toXY(p.lon, p.lat));
  const { state, county } = adminLevelsFor(opts.countryCode);
  const borderLevel = (lvl: string | undefined): BorderLevel | null =>
    lvl === "2" ? "national" : lvl === String(state) ? "state" : lvl === String(county) ? "county" : null;

  const { south, west, north, east } = opts.bbox;
  const layers: CityLayers = {
    land: [[[frame.toXY(west, south), frame.toXY(east, south), frame.toXY(east, north), frame.toXY(west, north), frame.toXY(west, south)]]],
    roads: [],
    water: { lines: [], areas: [] },
    borders: [],
    reserved: [],
  };

  for (const el of data.elements) {
    if (el.type === "way") {
      const t = el.tags ?? {};
      if (el.geometry.length < 2) continue;
      const line = P(el.geometry);
      const cls = t.highway ? OSM_ROAD_CLASS[t.highway] : undefined;
      if (cls && !(cls === "service" && t.service && OSM_SERVICE_NEVER.has(t.service))) layers.roads.push({ line, cls });
      if (t.waterway === "river" || t.waterway === "canal") layers.water.lines.push({ line, cls: t.waterway });
      if (t.natural === "water" && isClosed(line)) layers.water.areas.push([line]);
      if (t.boundary === "administrative") {
        const level = borderLevel(t.admin_level);
        if (level) layers.borders.push({ line, level });
      }
      for (const [reason, test] of RESERVED_TAGS) if (test(t) && isClosed(line)) layers.reserved.push({ rings: [line], reason });
    } else if (el.type === "relation") {
      const t = el.tags ?? {};
      const outers = el.members.filter((m) => m.type === "way" && m.geometry && m.role !== "inner").map((m) => P(m.geometry!));
      const inners = el.members.filter((m) => m.type === "way" && m.geometry && m.role === "inner").map((m) => P(m.geometry!));
      if (t.boundary === "administrative") {
        const level = borderLevel(t.admin_level);
        if (level) for (const line of outers) layers.borders.push({ line, level });
      }
      const isWater = t.natural === "water" && t.type === "multipolygon";
      const reason = RESERVED_TAGS.find(([, test]) => test(t))?.[0];
      if (isWater || reason) {
        const holes = stitch(inners);
        for (const shell of stitch(outers)) {
          const rings: PolygonRings = [shell, ...holes];
          if (isWater) layers.water.areas.push(rings);
          if (reason) layers.reserved.push({ rings, reason });
        }
      }
    }
  }
  return { layers, frame };
}

const isClosed = (r: Ring) => r.length >= 4 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1];

/** Joins relation member ways end-to-end into closed rings (members arrive in arbitrary direction). */
export function stitch(parts: Ring[]): Ring[] {
  const open = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: Ring[] = [];
  const same = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  while (open.length) {
    let ring = open.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i]!;
        const end = ring[ring.length - 1]!;
        if (same(p[0]!, end)) ring = [...ring, ...p.slice(1)];
        else if (same(p[p.length - 1]!, end)) ring = [...ring, ...[...p].reverse().slice(1)];
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) rings.push(ring);
  }
  return rings;
}

/** Overpass QL for everything the Gaia layer needs inside a bbox. */
export function overpassQuery({ south, west, north, east }: Bbox): string {
  const b = `${south},${west},${north},${east}`;
  return `[out:json][timeout:120];
(
  way["highway"](${b});
  way["waterway"~"^(river|canal)$"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  relation["boundary"="administrative"](${b});
  way["boundary"~"^(national_park|disputed)$"](${b});
  relation["boundary"~"^(national_park|disputed|protected_area)$"](${b});
);
out geom;`;
}
