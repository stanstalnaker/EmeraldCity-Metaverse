import { describe, expect, it } from "vitest";
import {
  anchorsNear,
  canBroker,
  quoteClaim,
  quoteTransfer,
  cityEntitlements,
  HUB_LEVEL,
  levelsFromMembershipNames,
  parcelPrice,
  tierFor,
  distanceMeters,
  parseClientMessage,
  parseLngLat,
  propertiesToParcels,
  propertiesToPoints,
  squareFootprint,
  toProperty,
  type HubPavilion,
} from "./index";

const pavilion = (over: Partial<HubPavilion> = {}): HubPavilion => ({
  id: 209,
  group: 1,
  name: "City Hall",
  territory: "Emerald City",
  latitude: "40.7128",
  longitude: "-74.006",
  url: "city-hall",
  visible: 1,
  is_private: false,
  created_by_user: { id: 77 },
  ...over,
});

describe("parseLngLat", () => {
  it("accepts strings and numbers", () => {
    expect(parseLngLat("40.7", -74)).toEqual({ lat: 40.7, lng: -74 });
  });
  it("rejects junk, out-of-range and null island", () => {
    expect(parseLngLat("abc", "1")).toBeNull();
    expect(parseLngLat("", "1")).toBeNull();
    expect(parseLngLat(91, 0)).toBeNull();
    expect(parseLngLat(0, 0)).toBeNull();
  });
});

describe("toProperty / GeoJSON", () => {
  it("normalises a pavilion", () => {
    const p = toProperty(pavilion());
    expect(p).toMatchObject({ id: 209, slug: "city-hall", ownerProfileId: 77, location: { lat: 40.7128, lng: -74.006 } });
  });
  it("drops private and unplaced properties from map layers", () => {
    const props = [
      toProperty(pavilion()),
      toProperty(pavilion({ id: 2, is_private: true })),
      toProperty(pavilion({ id: 3, latitude: null })),
    ];
    expect(propertiesToPoints(props).features.map((f) => f.id)).toEqual([209]);
    expect(propertiesToParcels(props).features).toHaveLength(1);
  });
});

describe("squareFootprint", () => {
  it("is a closed ~100m square for one hectare", () => {
    const c = { lat: 40.7128, lng: -74.006 };
    const ring = squareFootprint(c);
    expect(ring[0]).toEqual(ring[4]);
    const [sw, se, ne] = ring as [[number, number], [number, number], [number, number]];
    const width = distanceMeters({ lng: sw[0], lat: sw[1] }, { lng: se[0], lat: se[1] });
    const height = distanceMeters({ lng: se[0], lat: se[1] }, { lng: ne[0], lat: ne[1] });
    expect(width).toBeCloseTo(100, 0);
    expect(height).toBeCloseTo(100, 0);
  });
});

describe("parseClientMessage", () => {
  it("parses valid messages", () => {
    expect(parseClientMessage('{"t":"join","room":"map"}')).toEqual({ t: "join", room: "map" });
    expect(parseClientMessage('{"t":"move","room":"map","pos":{"geo":{"lat":1,"lng":2}}}')).not.toBeNull();
  });
  it("parses media, request and reply", () => {
    expect(parseClientMessage('{"t":"media","room":"property:1"}')).toEqual({ t: "media", room: "property:1" });
    expect(parseClientMessage('{"t":"request","to":"zeke","id":"r1","body":{"text":"help"}}')).toMatchObject({ to: "zeke" });
    expect(parseClientMessage('{"t":"request","to":42,"id":"r1","body":{"text":"hi","intent":"help"}}')).toMatchObject({ to: 42 });
    expect(parseClientMessage('{"t":"reply","to":42,"id":"r1","body":{"text":"ok"}}')).toMatchObject({ t: "reply" });
  });
  it("rejects bad requests", () => {
    expect(parseClientMessage('{"t":"request","to":"Zeke!","id":"r1","body":{"text":"x"}}')).toBeNull();
    expect(parseClientMessage('{"t":"request","to":"zeke","id":"has space","body":{"text":"x"}}')).toBeNull();
    expect(parseClientMessage('{"t":"request","to":"zeke","id":"r1","body":{"text":""}}')).toBeNull();
    expect(parseClientMessage('{"t":"reply","to":"zeke","id":"r1","body":{"text":"x"}}')).toBeNull();
    const big = JSON.stringify({ t: "request", to: "zeke", id: "r1", body: { text: "x", context: { pad: "y".repeat(9000) } } });
    expect(parseClientMessage(big)).toBeNull();
  });
  it("rejects malformed input", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage('{"t":"move","room":"map","pos":{}}')).toBeNull();
    expect(parseClientMessage('{"t":"say","room":"map","text":""}')).toBeNull();
    expect(parseClientMessage('{"t":"nope","room":"map"}')).toBeNull();
  });
});

describe("membership layers", () => {
  it("anyone signed in can launch a property; visitors cannot", () => {
    expect(cityEntitlements({ signedIn: false, levels: [] }).capabilities.has("claim-parcel")).toBe(false);
    const citizen = cityEntitlements({ signedIn: true, levels: [HUB_LEVEL.LOGGED_IN_USERS] });
    expect(citizen.tier).toBe("citizen");
    expect(citizen.capabilities.has("claim-parcel")).toBe(true);
    expect(citizen.maxParcels).toBeNull();
    expect(citizen.includedParcels).toBe(3);
  });
  it("cities need a partner record, not just the Partner level", () => {
    expect(cityEntitlements({ signedIn: true, levels: [HUB_LEVEL.PARTNER] }).capabilities.has("launch-city")).toBe(false);
    expect(cityEntitlements({ signedIn: true, levels: [], hasPartnerRecord: true }).capabilities.has("launch-city")).toBe(true);
  });
  it("tiers and professions unlock city capabilities", () => {
    const e = cityEntitlements({ signedIn: true, levels: [HUB_LEVEL.BUSINESS_DELUXE, HUB_LEVEL.ARCHITECTS, HUB_LEVEL.REAL_ESTATE_AGENTS] });
    expect(e.tier).toBe("business");
    expect([...e.capabilities]).toEqual(expect.arrayContaining(["submit-designs", "broker"]));
    expect(cityEntitlements({ signedIn: true, levels: [HUB_LEVEL.SUPER_ADMINISTRATORS] }).capabilities.has("administer")).toBe(true);
  });
  it("maps HubID membership names to levels", () => {
    expect(levelsFromMembershipNames(["Super Administrators", "architects", "Unknown"])).toEqual([HUB_LEVEL.SUPER_ADMINISTRATORS, HUB_LEVEL.ARCHITECTS]);
  });
});

describe("parcels: tiers and pricing", () => {
  it("bands parcels by size and prices by area with a floor", () => {
    expect([5_000, 20_000, 100_000, 400_000].map(tierFor)).toEqual(["core", "urban", "suburban", "rural"]);
    expect(parcelPrice(25_000, { venPerHectare: 10 })).toBe(25);
    expect(parcelPrice(1_000, { venPerHectare: 10, minimumVen: 5 })).toBe(5);
  });
});

describe("claims, transfers and anchors", () => {
  const citizen = cityEntitlements({ signedIn: true, levels: [] });
  it("includes 3 parcels, then charges 10 VEN per extra parcel", () => {
    expect(quoteClaim({ landVen: 20, parcelsHeld: 2, entitlements: citizen })).toMatchObject({ allowed: true, extraParcelFeeVen: 0, totalVen: 20 });
    expect(quoteClaim({ landVen: 20, parcelsHeld: 3, entitlements: citizen })).toMatchObject({ allowed: true, extraParcelFeeVen: 10, totalVen: 30 });
    expect(quoteClaim({ landVen: 20, parcelsHeld: 0, entitlements: cityEntitlements({ signedIn: false, levels: [] }) }).allowed).toBe(false);
  });
  it("supports optional hard caps per tier", () => {
    const capped = cityEntitlements({ signedIn: true, levels: [] }, { includedParcels: { visitor: 0, citizen: 3, member: 3, business: 3, patron: 3, admin: 3 }, extraParcelFeeVen: 10, maxParcels: { visitor: 0, citizen: 5, member: null, business: null, patron: null, admin: null } });
    expect(quoteClaim({ landVen: 1, parcelsHeld: 5, entitlements: capped })).toMatchObject({ allowed: false, reason: "cap-reached" });
  });
  it("p2p transfers are free; brokered ones pay the broker 1%", () => {
    expect(quoteTransfer(500, "p2p")).toEqual({ kind: "p2p", priceVen: 500, brokerFeeVen: 0, sellerReceivesVen: 500 });
    expect(quoteTransfer(500, "brokered")).toEqual({ kind: "brokered", priceVen: 500, brokerFeeVen: 5, sellerReceivesVen: 495 });
  });
  it("brokers are Real Estate Agents or AI agents with property:broker", () => {
    const agent = { kind: "agent" as const, hubId: 9, displayName: "Listing Bot", avatarUrl: null, ownerHubId: 1, variant: "ai__ai", scopes: ["property:broker" as const] };
    expect(canBroker(agent)).toBe(true);
    expect(canBroker({ ...agent, scopes: [] })).toBe(false);
    const human = { kind: "human" as const, hubId: 2, displayName: "Ana", avatarUrl: null };
    expect(canBroker(human, cityEntitlements({ signedIn: true, levels: [HUB_LEVEL.REAL_ESTATE_AGENTS] }))).toBe(true);
    expect(canBroker(human, citizen)).toBe(false);
  });
  it("finds every virtual world anchored near a real place, nearest first", () => {
    const here = { lat: 46.8027, lng: 9.836 }; // Davos
    const near = anchorsNear(
      [
        { kind: "virtual-property", ref: "209", citySlug: "emerald-city", location: { lat: 46.8028, lng: 9.8361 } },
        { kind: "virtual-property", ref: "501", citySlug: "nova-lisboa", location: { lat: 46.8027, lng: 9.836 } },
        { kind: "artifact", ref: "a1", location: { lat: 46.81, lng: 9.85 } },
      ],
      here,
      100,
    );
    expect(near.map((a) => a.ref)).toEqual(["501", "209"]);
  });
});
