/**
 * Hub Culture membership layers, as they apply to Emerald City (hubculture.city).
 *
 * HubID stores memberships as numbered user levels (hubid_api app/Models/UserLevels.php), sold through
 * the Hub Culture store. The city recognises three layers:
 *   1. Membership tiers: Personal / Business (Basic, Deluxe, Verified), Corporate, Patron, Entrepreneur…
 *   2. City professions (the hubculture.city "Career Center"): Architects, Designers, Real Estate Agents,
 *      Planners, Artisans, Services, Teachers, Merchants, Influencers, Developers, Financial Services,
 *      Healthcare. Each unlocks a capability in the city.
 *   3. Platform roles: Partner, Gaia, Zeke, administrators.
 *
 * Decided: anyone signed in with a HubID can launch a property; partner records (not the Partner
 * level alone) grant the right to launch cities. Everything else here is a default policy, see
 * docs/PARCELS.md "Open questions".
 */
export const HUB_LEVEL = {
  LOGGED_IN_USERS: 2,
  SUPER_ADMINISTRATORS: 3,
  GENERAL_ADMINISTRATORS: 5,
  PENDING_MEMBER: 6,
  APPROVED_MEMBER: 7,
  PERSONAL_DELUXE: 10,
  PERSONAL_BASIC: 11,
  INFLUENCER: 12,
  BUSINESS_BASIC: 13,
  BUSINESS_DELUXE: 14,
  CORPORATE: 15,
  GUEST: 17,
  PATRON: 22,
  ENTREPRENEUR: 23,
  PERSONAL_VERIFIED: 24,
  BUSINESS_VERIFIED: 25,
  FINANCIAL_SERVICE_PROVIDER: 32,
  MERCHANT: 33,
  DEVELOPER: 35,
  PARTNER: 36,
  ZEKE: 39,
  GAIA: 46,
  HEALTH_CARE_PROFESSIONAL: 47,
  DESIGNERS: 48,
  REAL_ESTATE_AGENTS: 49,
  PLANNERS: 50,
  ARTISANS: 51,
  SERVICES: 52,
  TEACHER: 53,
  ARCHITECTS: 54,
  MANDALA_AGENT: 63,
} as const;

export type HubLevelId = (typeof HUB_LEVEL)[keyof typeof HUB_LEVEL];

export type MembershipTier = "visitor" | "citizen" | "member" | "business" | "patron" | "admin";

/** City capabilities unlocked by professions and roles. */
export type CityCapability =
  | "claim-parcel" // launch a property
  | "launch-city" // partners only (requires a partner record)
  | "submit-designs" // Architects, Designers: publish buildings / items to the Archives
  | "broker" // Real Estate Agents: list and transfer properties for owners
  | "plan-districts" // Planners: shared plans across neighbouring properties
  | "sell" // Merchants: link inventories to properties
  | "create-art" // Artisans
  | "offer-services" // Services, Teachers, Healthcare, Financial Services
  | "promote" // Influencers
  | "develop" // Developers: enhanced API / tooling access
  | "manage-gaia" // Gaia stewards: reserved land and the base layer
  | "administer";

export interface CityEntitlements {
  tier: MembershipTier;
  capabilities: ReadonlySet<CityCapability>;
  /** Max parcels a member may hold at once; null = no limit. */
  maxParcels: number | null;
}

export interface MembershipPolicy {
  /** Parcel limits per tier (null = unlimited). Today everyone is unlimited, matching current behaviour. */
  maxParcels: Record<MembershipTier, number | null>;
}

export const DEFAULT_MEMBERSHIP_POLICY: MembershipPolicy = {
  maxParcels: { visitor: 0, citizen: null, member: null, business: null, patron: null, admin: null },
};

const PROFESSION_CAPABILITY: [HubLevelId, CityCapability][] = [
  [HUB_LEVEL.ARCHITECTS, "submit-designs"],
  [HUB_LEVEL.DESIGNERS, "submit-designs"],
  [HUB_LEVEL.REAL_ESTATE_AGENTS, "broker"],
  [HUB_LEVEL.PLANNERS, "plan-districts"],
  [HUB_LEVEL.MERCHANT, "sell"],
  [HUB_LEVEL.ARTISANS, "create-art"],
  [HUB_LEVEL.SERVICES, "offer-services"],
  [HUB_LEVEL.TEACHER, "offer-services"],
  [HUB_LEVEL.HEALTH_CARE_PROFESSIONAL, "offer-services"],
  [HUB_LEVEL.FINANCIAL_SERVICE_PROVIDER, "offer-services"],
  [HUB_LEVEL.INFLUENCER, "promote"],
  [HUB_LEVEL.DEVELOPER, "develop"],
  [HUB_LEVEL.GAIA, "manage-gaia"],
];

function tierOf(levels: ReadonlySet<number>, signedIn: boolean): MembershipTier {
  const has = (...ids: number[]) => ids.some((id) => levels.has(id));
  if (has(HUB_LEVEL.SUPER_ADMINISTRATORS, HUB_LEVEL.GENERAL_ADMINISTRATORS)) return "admin";
  if (has(HUB_LEVEL.PATRON)) return "patron";
  if (has(HUB_LEVEL.CORPORATE, HUB_LEVEL.BUSINESS_BASIC, HUB_LEVEL.BUSINESS_DELUXE, HUB_LEVEL.BUSINESS_VERIFIED, HUB_LEVEL.ENTREPRENEUR)) return "business";
  if (has(HUB_LEVEL.APPROVED_MEMBER, HUB_LEVEL.PERSONAL_BASIC, HUB_LEVEL.PERSONAL_DELUXE, HUB_LEVEL.PERSONAL_VERIFIED)) return "member";
  return signedIn ? "citizen" : "visitor";
}

/**
 * What a person may do in the city, from their HubID levels. `hasPartnerRecord` must come from
 * HubID's partner records (partners / partners_hub_relation), checked server-side.
 */
export function cityEntitlements(
  input: { signedIn: boolean; levels: Iterable<number>; hasPartnerRecord?: boolean },
  policy: MembershipPolicy = DEFAULT_MEMBERSHIP_POLICY,
): CityEntitlements {
  const levels = new Set(input.levels);
  const tier = tierOf(levels, input.signedIn);
  const caps = new Set<CityCapability>();
  if (input.signedIn) caps.add("claim-parcel");
  for (const [level, cap] of PROFESSION_CAPABILITY) if (levels.has(level)) caps.add(cap);
  if (input.hasPartnerRecord) caps.add("launch-city");
  if (tier === "admin") {
    caps.add("administer");
    caps.add("manage-gaia");
    caps.add("launch-city");
  }
  return { tier, capabilities: caps, maxParcels: policy.maxParcels[tier] };
}

/**
 * HubID's API returns membership *names* (levels.name), not ids. Map names to ids here, in one place.
 * Names follow HubID's level naming; verify against the `levels` table before relying on a new one.
 */
export const LEVEL_BY_NAME: Record<string, HubLevelId> = {
  "Logged In Users": HUB_LEVEL.LOGGED_IN_USERS,
  "Super Administrators": HUB_LEVEL.SUPER_ADMINISTRATORS,
  "General Administrators": HUB_LEVEL.GENERAL_ADMINISTRATORS,
  "Pending Member": HUB_LEVEL.PENDING_MEMBER,
  "Approved Member": HUB_LEVEL.APPROVED_MEMBER,
  "Personal Deluxe": HUB_LEVEL.PERSONAL_DELUXE,
  "Personal Basic": HUB_LEVEL.PERSONAL_BASIC,
  Influencer: HUB_LEVEL.INFLUENCER,
  "Business Basic": HUB_LEVEL.BUSINESS_BASIC,
  "Business Deluxe": HUB_LEVEL.BUSINESS_DELUXE,
  Corporate: HUB_LEVEL.CORPORATE,
  Guest: HUB_LEVEL.GUEST,
  Patron: HUB_LEVEL.PATRON,
  Entrepreneur: HUB_LEVEL.ENTREPRENEUR,
  "Personal Verified": HUB_LEVEL.PERSONAL_VERIFIED,
  "Business Verified": HUB_LEVEL.BUSINESS_VERIFIED,
  "Financial Service Provider": HUB_LEVEL.FINANCIAL_SERVICE_PROVIDER,
  Merchant: HUB_LEVEL.MERCHANT,
  Developer: HUB_LEVEL.DEVELOPER,
  Partner: HUB_LEVEL.PARTNER,
  Zeke: HUB_LEVEL.ZEKE,
  Gaia: HUB_LEVEL.GAIA,
  "Health Care Professional": HUB_LEVEL.HEALTH_CARE_PROFESSIONAL,
  Designers: HUB_LEVEL.DESIGNERS,
  "Real Estate Agents": HUB_LEVEL.REAL_ESTATE_AGENTS,
  Planners: HUB_LEVEL.PLANNERS,
  Artisans: HUB_LEVEL.ARTISANS,
  Services: HUB_LEVEL.SERVICES,
  Teacher: HUB_LEVEL.TEACHER,
  Architects: HUB_LEVEL.ARCHITECTS,
};

export function levelsFromMembershipNames(names: Iterable<string>): HubLevelId[] {
  const byLower = new Map(Object.entries(LEVEL_BY_NAME).map(([k, v]) => [k.toLowerCase(), v]));
  const out: HubLevelId[] = [];
  for (const n of names) {
    const id = byLower.get(n.trim().toLowerCase());
    if (id !== undefined) out.push(id);
  }
  return out;
}
