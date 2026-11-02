/**
 * Designs: buildings, landscapes, items and art made by Architects, Designers and Artisans.
 *
 * Decided: designs are posted directly to the Hub stores as digital items (HubID store `items`,
 * like the store's other digital goods), with no approval to sell, which grows the VEN economy.
 * Cities can mark approval zones (e.g. a historic district or the central plaza) where *placing* a
 * design on a parcel needs City Council approval. The council is the city's council hub if set,
 * otherwise the city owner hub's admins.
 */
import type { Parcel } from "./city";
import { pointInRings, ringCentroid } from "./geo";

export type DesignKind = "building" | "landscape" | "item" | "art";

export interface Design {
  /** HubID store item id: the design is sold through the Hub stores. */
  storeItemId: number;
  creatorHubId: number;
  kind: DesignKind;
  title: string;
  /** glTF/GLB model (compressed: meshopt/Draco + KTX2). */
  modelUrl: string;
  /** Largest parcel footprint the design fits, in m² (optional). */
  footprintM2?: number;
  priceVen: number;
}

export interface ApprovalZone {
  id: string;
  cityId: string;
  name: string;
  /** Zone outline in the same coordinates as the city's parcels. */
  rings: [number, number][][];
  /** Which kinds of design need approval here (default: all). */
  kinds?: DesignKind[];
}

export type PlacementStatus = "placed" | "pending-approval" | "approved" | "rejected";

export interface PlacementCheck {
  needsApproval: boolean;
  zones: ApprovalZone[];
  /** Status a new placement starts in. */
  initialStatus: PlacementStatus;
  fits: boolean;
}

/** Whether placing a design on a parcel needs City Council approval, and whether it fits. */
export function checkPlacement(design: Pick<Design, "kind" | "footprintM2">, parcel: Pick<Parcel, "rings" | "areaM2">, zones: ApprovalZone[]): PlacementCheck {
  const exterior = parcel.rings[0] ?? [];
  const at = ringCentroid(exterior);
  const hits = zones.filter((z) => (!z.kinds || z.kinds.includes(design.kind)) && pointInRings(at, z.rings));
  const fits = design.footprintM2 === undefined || design.footprintM2 <= parcel.areaM2;
  return { needsApproval: hits.length > 0, zones: hits, initialStatus: hits.length > 0 ? "pending-approval" : "placed", fits };
}
