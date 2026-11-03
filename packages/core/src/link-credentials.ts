/**
 * Optional credentials for real-world links. Linking a virtual property to a real place never
 * requires proof; a verified link earns badges that AR and listings can show.
 *
 * Evidence comes from Google Maps (does the address exist, where is it) and HubID (the person's
 * profile address, their Google Place check-ins, Gaia parcel ownership).
 */
import { distanceMeters, type LngLat } from "./geo";

export type LinkBadge = "real-place" | "checked-in" | "hubid-address" | "land-owner";

/** Strongest badge earned, in increasing order of trust. */
export type LinkTrust = "unverified" | "place" | "presence" | "resident" | "owner";

export interface GeocodedPlace {
  placeId: string;
  location: LngLat;
  formattedAddress: string;
}

export interface LinkEvidence {
  /** Where the link points. */
  linkLocation: LngLat;
  /** Google's result for the link's address (or reverse-geocoded point). */
  linkPlace?: GeocodedPlace | null;
  /** Google's result for the person's HubID profile address. */
  profilePlace?: GeocodedPlace | null;
  /** Google Place ids the person has checked in to on HubID. */
  checkInPlaceIds?: string[];
  /** The person owns the Gaia parcel the link sits on. */
  ownsGaiaParcel?: boolean;
}

export interface LinkCredentials {
  badges: LinkBadge[];
  trust: LinkTrust;
}

/** How close the link's point must be to Google's location for the address to count as the same place. */
export const PLACE_MATCH_RADIUS_M = 75;
/** How close the HubID profile address must be to the link's place (allows for big plots and buildings). */
export const RESIDENT_MATCH_RADIUS_M = 150;

export function evaluateLinkCredentials(e: LinkEvidence): LinkCredentials {
  const badges: LinkBadge[] = [];
  const place = e.linkPlace;
  const realPlace = !!place && distanceMeters(e.linkLocation, place.location) <= PLACE_MATCH_RADIUS_M;
  if (realPlace) badges.push("real-place");
  if (realPlace && e.checkInPlaceIds?.includes(place!.placeId)) badges.push("checked-in");
  if (
    realPlace &&
    e.profilePlace &&
    (e.profilePlace.placeId === place!.placeId || distanceMeters(e.profilePlace.location, place!.location) <= RESIDENT_MATCH_RADIUS_M)
  ) {
    badges.push("hubid-address");
  }
  if (e.ownsGaiaParcel) badges.push("land-owner");

  const trust: LinkTrust = badges.includes("land-owner")
    ? "owner"
    : badges.includes("hubid-address")
      ? "resident"
      : badges.includes("checked-in")
        ? "presence"
        : badges.includes("real-place")
          ? "place"
          : "unverified";
  return { badges, trust };
}

/** One-line postal address from HubID profile fields, or null if there isn't enough to geocode. */
export function profileAddress(p: { address?: string | null; city?: string | null; zip?: string | null; country?: string | null }): string | null {
  const parts = [p.address, p.city, p.zip, p.country].map((s) => (s ?? "").trim()).filter(Boolean);
  return p.address?.trim() && parts.length >= 2 ? parts.join(", ") : null;
}
