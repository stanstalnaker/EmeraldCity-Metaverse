export interface LngLat {
  lng: number;
  lat: number;
}

/** Parse a free-form HubID lat/lng pair. Pavilion coordinates are stored as strings with no validation beyond length. */
export function parseLngLat(lat: unknown, lng: unknown): LngLat | null {
  const la = toFiniteNumber(lat);
  const lo = toFiniteNumber(lng);
  if (la === null || lo === null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  // 0,0 ("Null Island") is what an unset form field usually produces.
  if (la === 0 && lo === 0) return null;
  return { lat: la, lng: lo };
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const METERS_PER_DEG_LAT = 111_320;

/**
 * Square parcel footprint centred on a point, as a closed GeoJSON ring
 * ([lng, lat] pairs). Defaults to one hectare (100m x 100m), matching the
 * "one hectare virtual plot" each Emerald City property is sold as.
 */
export function squareFootprint(center: LngLat, areaM2 = 10_000): [number, number][] {
  const half = Math.sqrt(areaM2) / 2;
  const dLat = half / METERS_PER_DEG_LAT;
  const dLng = half / (METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const { lng, lat } = center;
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

/** Great-circle distance in metres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
