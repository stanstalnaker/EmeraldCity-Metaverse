/**
 * Platform-wide parcel rules. Every city (the Gaia layer and every partner's virtual island) is cut
 * with the same rules; partners shape parcels only through their street plan. Bump RULES_VERSION
 * when anything here changes: existing claimed parcels keep their shape regardless.
 */
export const RULES_VERSION = "2026.11-1";

export type RoadClass = "major" | "local" | "service" | "track";
export type WaterClass = "river" | "canal";
export type BorderLevel = "national" | "state" | "county";

export interface ParcelRules {
  version: string;
  /** Corridor half-widths in metres. Roads and rivers are public corridors, never claimable. */
  roadHalfWidth: Record<RoadClass, number>;
  waterHalfWidth: Record<WaterClass, number>;
  /** Political borders cut land with a hairline gap so no parcel spans two jurisdictions. */
  borderHalfWidth: number;
  /** Pieces smaller than this (traffic islands, slivers between carriageways) become public space. */
  minParcelM2: number;
  /**
   * Pieces narrower than this on average become public space too: long medians between carriageways
   * can exceed the minimum area while being useless as property. Average width ≈ 2 × area / perimeter.
   */
  minParcelWidthM: number;
  /** Parcels larger than this are re-cut along service roads and tracks (the rural rule). */
  recutAboveM2: number;
}

export const RULES: ParcelRules = {
  version: RULES_VERSION,
  roadHalfWidth: { major: 10, local: 6, service: 3, track: 2 },
  waterHalfWidth: { river: 25, canal: 10 },
  borderHalfWidth: 0.5,
  minParcelM2: 500,
  minParcelWidthM: 8,
  recutAboveM2: 25 * 10_000,
};

/** OSM `highway=*` values per road class. Anything not listed (footways, paths, steps…) is not a border. */
export const OSM_ROAD_CLASS: Record<string, RoadClass> = {
  motorway: "major", motorway_link: "major", trunk: "major", trunk_link: "major",
  primary: "major", primary_link: "major", secondary: "major", secondary_link: "major",
  tertiary: "local", tertiary_link: "local", residential: "local", unclassified: "local", living_street: "local",
  service: "service", track: "track",
};

/** `service=*` values that never form borders, so towns aren't cut into car parks and driveways. */
export const OSM_SERVICE_NEVER = new Set(["driveway", "parking_aisle", "drive-through", "emergency_access"]);
