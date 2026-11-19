import { cellToLatLng, cellToParent, getResolution, gridDisk, isValidCell, latLngToCell } from "h3-js";

/**
 * Gaia addressing, as in the Gaia spec (hub-culture/gaiaclub docs/api/gaia-implementation-brief.md)
 * and the DIRT launchpad: a place is an H3 cell; parcels are resolution 9; a cell's canonical
 * address is `MIP1|GAIA|CELL|{h3index}` (the string its MIP1 sigil is drawn from).
 */
export const PARCEL_RES = 9;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Geolink extends LatLng {
  /** Resolution-9 (parcel) cell of the point. */
  h3: string;
  /** `MIP1|GAIA|CELL|{h3}`: the address Gaia, DIRT and sigils share. */
  gaiaAddress: string;
}

export const gaiaAddress = (h3: string) => `MIP1|GAIA|CELL|${h3}`;

/** Tie anything (an island, a property, an archipelago) to a real place. */
export function geolink(p: LatLng): Geolink {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
    throw new RangeError(`Not a place on Earth: ${p.lat}, ${p.lng}`);
  }
  const h3 = latLngToCell(p.lat, p.lng, PARCEL_RES);
  return { lat: p.lat, lng: p.lng, h3, gaiaAddress: gaiaAddress(h3) };
}

export function cellCentre(h3: string): LatLng {
  const [lat, lng] = cellToLatLng(h3);
  return { lat, lng };
}

/** The cell's ancestor at a coarser resolution (itself at the same one). */
export function parentAt(h3: string, res: number): string | null {
  const r = getResolution(h3);
  if (res > r) return null;
  return res === r ? h3 : cellToParent(h3, res);
}

/** Parcel cells around a centre, nearest rings first (k = 1 gives the 6 neighbours). */
export function cellsAround(h3: string, k: number): string[] {
  return gridDisk(h3, k);
}

export const isCell = (h3: string) => isValidCell(h3);
