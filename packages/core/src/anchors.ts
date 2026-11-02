/**
 * Real-world anchors: things in virtual worlds tied to a physical place.
 *
 * Decided: many virtual properties (in different cities) may link to the same real-world location.
 * Standing at that place, an AR view can show each linked world as a floating sphere to tap into,
 * richer when the property holds photos, video and other content ("memories"). The same anchor
 * model is meant to carry future discoverable artifacts (the Andromeda idea), so the lookup is
 * generic over what is anchored.
 *
 * Decided: the owner of a Gaia parcel controls what is anchored on their land. They can leave it
 * open, curate it (approve each link), or charge rent to others who want to link there, and can
 * hide any anchor at any time. Unowned land is open.
 */
import { distanceMeters, type LngLat } from "./geo";

export type AnchorKind = "virtual-property" | "artifact";

export type AnchorStatus = "visible" | "pending" | "hidden";

export interface RealWorldAnchor {
  kind: AnchorKind;
  /** Visibility under the land owner's policy. Only "visible" anchors show in AR. Defaults to visible. */
  status?: AnchorStatus;
  /** Gaia parcel the anchor sits on, if known. */
  gaiaParcelId?: string;
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

/** Visible anchors within `radiusM` of a point, nearest first. Several worlds can share one place. */
export function anchorsNear(anchors: Iterable<RealWorldAnchor>, at: LngLat, radiusM: number, limit = 50): NearbyAnchor[] {
  const out: NearbyAnchor[] = [];
  for (const a of anchors) {
    if ((a.status ?? "visible") !== "visible") continue;
    const d = distanceMeters(at, a.location);
    if (d <= radiusM) out.push({ ...a, distanceM: d });
  }
  return out.sort((x, y) => x.distanceM - y.distanceM).slice(0, limit);
}

/** How a Gaia parcel's owner handles links to their land. */
export type LinkMode = "open" | "curated" | "rent";

export interface LandLinkPolicy {
  mode: LinkMode;
  /** Rent per period in VEN when mode is "rent". */
  rentVen?: number;
  rentPeriodDays?: number;
}

/** Unowned Gaia land, and owners who haven't set a policy, are open. */
export const OPEN_LAND: LandLinkPolicy = { mode: "open" };

export interface LinkRequestQuote {
  /** Status the new anchor starts with. */
  status: AnchorStatus;
  /** Rent due per period (0 unless the owner charges rent). */
  rentVen: number;
  rentPeriodDays?: number;
  /** True when the land owner must act (approve) before the anchor is visible. */
  needsOwnerApproval: boolean;
}

/**
 * What happens when someone links a virtual property to a Gaia parcel. The owner always links free
 * and visible. Others are subject to the owner's policy: open (visible now), curated (pending owner
 * approval), or rent (visible once rent is paid each period).
 */
export function quoteLinkRequest(input: { requesterOwnsLand: boolean; policy?: LandLinkPolicy }): LinkRequestQuote {
  const policy = input.policy ?? OPEN_LAND;
  if (input.requesterOwnsLand || policy.mode === "open") return { status: "visible", rentVen: 0, needsOwnerApproval: false };
  if (policy.mode === "curated") return { status: "pending", rentVen: 0, needsOwnerApproval: true };
  return { status: "visible", rentVen: policy.rentVen ?? 0, rentPeriodDays: policy.rentPeriodDays ?? 30, needsOwnerApproval: false };
}
