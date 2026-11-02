/**
 * Cities and parcels. See docs/PARCELS.md for the rules and the decisions behind them.
 *
 * - The Gaia layer is the real world, cut into parcels by political borders, water and roads.
 * - Virtual cities float outside the real world as islands, each with its own street plan,
 *   cut by the same platform-wide rules.
 * - A property (HubID pavilion) occupies exactly one parcel; parcels never overlap.
 */
export type CityKind = "gaia" | "virtual";

/** How a partner lets people launch properties in its city. The Gaia layer is always "open". */
export type LaunchPolicy = "open" | "approval" | "invite";

export interface CityPricing {
  /** Price per hectare in VEN; 0 means free to claim. */
  venPerHectare: number;
  /** Optional floor so tiny parcels are not near-free. */
  minimumVen?: number;
}

export interface City {
  id: string;
  /** URL-safe, unique; also seeds the starter topography for virtual cities. */
  slug: string;
  name: string;
  kind: CityKind;
  /** Partner hub that owns and runs the city (HubID groups.id). Hub Culture for the Gaia layer. */
  ownerHubId: number;
  launchPolicy: LaunchPolicy;
  pricing: CityPricing;
  /** Parcel rules version the city's parcels were cut with. */
  rulesVersion: string;
}

export type ParcelStatus = "free" | "claimed" | "public" | "reserved";

/** Why land is held back from claiming. Reserved land is held by Hub Culture. */
export type ReservedReason = "disputed" | "national-park" | "ocean" | "park" | "public";

/** Size band, used for display and pricing hints. */
export type ParcelTier = "core" | "urban" | "suburban" | "rural";

export interface Parcel {
  /** Stable id: derived from city, rules version and geometry, so recomputing an unchanged area yields the same ids. */
  id: string;
  cityId: string;
  status: ParcelStatus;
  areaM2: number;
  tier: ParcelTier;
  /** Exterior ring then holes, closed. Metres in the city's local frame (virtual) or [lng, lat] (Gaia). */
  rings: [number, number][][];
  /** HubID pavilion occupying the parcel, once claimed. */
  pavilionId?: number;
  reservedReason?: ReservedReason;
}

/**
 * Optional link from a property in a virtual city to the real world. It is a reference, not
 * ownership: it places the virtual property on the Gaia map.
 */
export type RealWorldLink =
  | { kind: "address"; address: string }
  | { kind: "point"; lat: number; lng: number }
  | { kind: "gaia-parcel"; parcelId: string };

export function tierFor(areaM2: number): ParcelTier {
  const ha = areaM2 / 10_000;
  if (ha < 1) return "core";
  if (ha < 5) return "urban";
  if (ha < 25) return "suburban";
  return "rural";
}

/** Price of a parcel under a city's pricing. */
export function parcelPrice(areaM2: number, pricing: CityPricing): number {
  const price = (areaM2 / 10_000) * pricing.venPerHectare;
  return Math.max(Math.round(price * 100) / 100, pricing.minimumVen ?? 0);
}
