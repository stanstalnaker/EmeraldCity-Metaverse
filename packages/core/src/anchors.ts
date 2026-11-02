/**
 * Real-world anchors: things in virtual worlds tied to a physical place.
 *
 * Decided: many virtual properties (in different cities) may link to the same real-world location.
 * Standing at that place, an AR view can show each linked world as a floating sphere to tap into,
 * richer when the property holds photos, video and other content ("memories"). The same anchor
 * model is meant to carry future discoverable artifacts (the Andromeda idea), so the lookup is
 * generic over what is anchored.
 */
import { distanceMeters, type LngLat } from "./geo";

export type AnchorKind = "virtual-property" | "artifact";

export interface RealWorldAnchor {
  kind: AnchorKind;
  /** Id of the anchored thing (pavilion id for virtual properties). */
  ref: string;
  /** City the anchored thing lives in, for virtual properties. */
  citySlug?: string;
  location: LngLat;
  /** Optional preview for the AR sphere: title, thumbnail, content counts. */
  title?: string;
  thumbnail?: string | null;
  mediaCount?: number;
}

export interface NearbyAnchor extends RealWorldAnchor {
  distanceM: number;
}

/** Anchors within `radiusM` of a point, nearest first. Several worlds can share one place. */
export function anchorsNear(anchors: Iterable<RealWorldAnchor>, at: LngLat, radiusM: number, limit = 50): NearbyAnchor[] {
  const out: NearbyAnchor[] = [];
  for (const a of anchors) {
    const d = distanceMeters(at, a.location);
    if (d <= radiusM) out.push({ ...a, distanceM: d });
  }
  return out.sort((x, y) => x.distanceM - y.distanceM).slice(0, limit);
}
