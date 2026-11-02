/**
 * Thin typed wrapper over JSTS (a port of JTS, the engine behind PostGIS), exposing only what the
 * parcel engine needs. Coordinates are planar metres.
 */
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import Centroid from "jsts/org/locationtech/jts/algorithm/Centroid.js";
import RelateOp from "jsts/org/locationtech/jts/operation/relate/RelateOp.js";

export type XY = [number, number];
export type Ring = XY[];
/** Exterior ring followed by holes. */
export type PolygonRings = Ring[];

/** Opaque JSTS geometry. */
export interface Geom {
  readonly __geom: unique symbol;
}
interface J {
  isEmpty(): boolean;
  getArea(): number;
  getLength(): number;
  getNumGeometries(): number;
  getGeometryN(i: number): J;
  getGeometryType(): string;
  getExteriorRing(): { getCoordinates(): { x: number; y: number }[] };
  getNumInteriorRing(): number;
  getInteriorRingN(i: number): { getCoordinates(): { x: number; y: number }[] };
  getEnvelopeInternal(): { getMinX(): number; getMinY(): number; getMaxX(): number; getMaxY(): number };
}
const j = (g: Geom) => g as unknown as J;
const g = (x: unknown) => x as Geom;

// Centimetre precision keeps overlays robust without visibly changing shapes.
const factory = new GeometryFactory(new PrecisionModel(100));
const flat = new BufferParameters();
flat.setEndCapStyle(BufferParameters.CAP_FLAT);
flat.setQuadrantSegments(4);
const round = new BufferParameters();
round.setQuadrantSegments(4);

/**
 * Snap inputs to the same centimetre grid as the precision model. Without this, floating-point noise
 * from projections (e.g. y = 7.8e-10 instead of 0) can make overlays merge pieces that a border or
 * road should have split.
 */
const snap = (v: number) => Math.round(v * 100) / 100;
const coord = ([x, y]: XY) => new Coordinate(snap(x), snap(y));
const closed = (r: Ring): Ring => {
  const [a, b] = [r[0]!, r[r.length - 1]!];
  return snap(a[0]) === snap(b[0]) && snap(a[1]) === snap(b[1]) ? r : [...r, a];
};

export const empty = (): Geom => g(factory.createGeometryCollection([]));
export const line = (pts: Ring): Geom => g(factory.createLineString(pts.map(coord)));
export function polygon(rings: PolygonRings): Geom {
  const [shell, ...holes] = rings.map((r) => factory.createLinearRing(closed(r).map(coord)));
  return g(factory.createPolygon(shell, holes));
}

/** Corridor around a polyline: `halfWidth` metres either side, square ends (so corridors meet cleanly at junctions). */
export const corridor = (pts: Ring, halfWidth: number, roundEnds = false): Geom =>
  g(BufferOp.bufferOp(j(line(pts)), halfWidth, roundEnds ? round : flat));

export function union(parts: Geom[]): Geom {
  const nonEmpty = parts.filter((p) => !j(p).isEmpty());
  if (nonEmpty.length === 0) return empty();
  return g(UnaryUnionOp.union(factory.createGeometryCollection(nonEmpty.map(j))));
}

export const difference = (a: Geom, b: Geom): Geom => (j(b).isEmpty() ? a : g(OverlayOp.difference(j(a), j(b))));
export const intersection = (a: Geom, b: Geom): Geom => g(OverlayOp.intersection(j(a), j(b)));
export const intersects = (a: Geom, b: Geom): boolean => !j(a).isEmpty() && !j(b).isEmpty() && RelateOp.intersects(j(a), j(b));
export const area = (a: Geom): number => j(a).getArea();
export const isEmpty = (a: Geom): boolean => j(a).isEmpty();
/** Perimeter of a polygon (including holes). */
export const perimeter = (a: Geom): number => j(a).getLength();
export function centroid(a: Geom): XY {
  const c = Centroid.getCentroid(j(a)) as { x: number; y: number };
  return [c.x, c.y];
}

/** Every polygon inside a geometry (flattening multi-polygons and collections). */
export function polygons(a: Geom): Geom[] {
  const out: Geom[] = [];
  const walk = (x: J) => {
    if (x.isEmpty()) return;
    const t = x.getGeometryType();
    if (t === "Polygon") out.push(g(x));
    else if (t === "MultiPolygon" || t === "GeometryCollection") for (let i = 0; i < x.getNumGeometries(); i++) walk(x.getGeometryN(i));
  };
  walk(j(a));
  return out;
}

export function rings(poly: Geom): PolygonRings {
  const p = j(poly);
  const toRing = (cs: { x: number; y: number }[]): Ring => cs.map((c) => [c.x, c.y]);
  const out = [toRing(p.getExteriorRing().getCoordinates())];
  for (let i = 0; i < p.getNumInteriorRing(); i++) out.push(toRing(p.getInteriorRingN(i).getCoordinates()));
  return out;
}

export function bounds(a: Geom): { minX: number; minY: number; maxX: number; maxY: number } {
  const e = j(a).getEnvelopeInternal();
  return { minX: e.getMinX(), minY: e.getMinY(), maxX: e.getMaxX(), maxY: e.getMaxY() };
}
