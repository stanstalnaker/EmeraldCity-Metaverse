import type { LngLat } from "@emerald-city/core";

const R = 6_378_137;

/**
 * Local east/north offset in metres from `origin` (equirectangular tangent plane).
 * three.js convention: x = east, z = south (so -z is north), y = up.
 */
export function toLocal(origin: LngLat, p: LngLat): { x: number; z: number } {
  const toRad = Math.PI / 180;
  const x = (p.lng - origin.lng) * toRad * R * Math.cos(origin.lat * toRad);
  const north = (p.lat - origin.lat) * toRad * R;
  return { x, z: -north };
}
