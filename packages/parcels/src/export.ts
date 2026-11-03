import type { Parcel } from "@emerald-city/core";
import type { CutResult } from "./cut";
import type { XY } from "./geom";
import * as G from "./geom";

export interface ParcelFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Polygon"; coordinates: XY[][] };
  properties: { id: string; status: Parcel["status"]; tier: Parcel["tier"]; areaHa: number; reservedReason?: string };
}

export interface ParcelCollection {
  type: "FeatureCollection";
  features: ParcelFeature[];
}

/**
 * Parcels (and reserved land) as GeoJSON. `project` maps planar metres to output coordinates:
 * identity for virtual cities, LocalFrame.toLngLat for the Gaia layer.
 */
export function parcelsToGeoJSON(result: Pick<CutResult, "parcels" | "reserved">, project: (p: XY) => XY = (p) => p): ParcelCollection {
  const feature = (p: Parcel): ParcelFeature => ({
    type: "Feature",
    id: p.id,
    geometry: { type: "Polygon", coordinates: p.rings.map((r) => r.map((pt) => round(project(pt)))) },
    properties: {
      id: p.id,
      status: p.status,
      tier: p.tier,
      areaHa: Math.round(p.areaM2 / 100) / 100,
      ...(p.reservedReason ? { reservedReason: p.reservedReason } : {}),
    },
  });
  return { type: "FeatureCollection", features: [...result.parcels, ...result.reserved].map(feature) };
}

const round = ([a, b]: XY): XY => [Math.round(a * 1e7) / 1e7, Math.round(b * 1e7) / 1e7];

const TIER_COLOR: Record<Parcel["tier"], string> = { core: "#2e8b57", urban: "#5fae6e", suburban: "#a3cf7a", rural: "#d9c56b" };

/** Static SVG preview of a cut city (planar coordinates). */
export function renderSvg(result: CutResult, land: G.PolygonRings[], size = 900, title = ""): string {
  const landGeom = G.union(land.map(G.polygon));
  const b = G.bounds(landGeom);
  const pad = 20;
  const s = (size - 2 * pad) / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const X = (x: number) => (pad + (x - b.minX) * s).toFixed(1);
  const Y = (y: number) => (pad + (b.maxY - y) * s).toFixed(1);
  const d = (rings: XY[][]) => rings.map((r) => "M" + r.map(([x, y]) => `${X(x)},${Y(y)}`).join("L") + "Z").join("");
  const geomPath = (g: G.Geom) => G.polygons(g).map((p) => d(G.rings(p))).join("");
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 30}" viewBox="0 0 ${size} ${size + 30}" font-family="sans-serif">`,
    `<rect width="100%" height="100%" fill="#bcd9ea"/>`,
    `<path d="${geomPath(landGeom)}" fill="#e9e4d4"/>`,
    ...result.parcels.map((p) => `<path d="${d(p.rings)}" fill="${TIER_COLOR[p.tier]}" stroke="#fff" stroke-width="0.4"/>`),
    ...result.reserved.map((p) => `<path d="${d(p.rings)}" fill="#1b5e20"/>`),
    `<path d="${geomPath(result.water)}" fill="#4a90c2"/>`,
    `<text x="${pad}" y="${size + 18}" font-size="14">${escapeXml(title)}</text>`,
    `</svg>`,
  ];
  return out.join("\n");
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

export interface HubIdImportPayload {
  rules_version: string;
  parcels: {
    id: string;
    status: Parcel["status"];
    reserved_reason: string | null;
    area_m2: number;
    tier: Parcel["tier"];
    geometry: XY[][];
  }[];
}

/**
 * Parcels in the shape HubID's import expects (POST /cities/{slug}/parcels/import and
 * `php artisan emeraldcity:import-parcels`). Coordinates stay in the city's frame, rounded to cm.
 */
export function toHubIdImport(result: Pick<CutResult, "parcels" | "reserved">, rulesVersion: string): HubIdImportPayload {
  const cm = (v: number) => Math.round(v * 100) / 100;
  return {
    rules_version: rulesVersion,
    parcels: [...result.parcels, ...result.reserved].map((p) => ({
      id: p.id,
      status: p.status,
      reserved_reason: p.reservedReason ?? null,
      area_m2: cm(p.areaM2),
      tier: p.tier,
      geometry: p.rings.map((r) => r.map(([x, y]) => [cm(x), cm(y)] as XY)),
    })),
  };
}
