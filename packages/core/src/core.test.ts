import { describe, expect, it } from "vitest";
import {
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
