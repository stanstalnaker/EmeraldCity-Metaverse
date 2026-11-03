import { describe, expect, it, vi } from "vitest";
import { HubIdClient } from "@emerald-city/hubid-client";
import { GeocodeError, GoogleGeocoder, verifyLink } from "./index";

const google = (results: { id: string; lat: number; lng: number; addr: string }[], status = "OK") =>
  new Response(JSON.stringify({ status, results: results.map((r) => ({ place_id: r.id, formatted_address: r.addr, geometry: { location: { lat: r.lat, lng: r.lng } } })) }));
const hub = (data: unknown) => new Response(JSON.stringify({ status: "success", errors: [], data, code: 200, time: 0 }));

describe("GoogleGeocoder", () => {
  it("geocodes and reverse-geocodes, handling no results and errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(google([{ id: "gp1", lat: 46.8, lng: 9.83, addr: "Davos" }]))
      .mockResolvedValueOnce(google([], "ZERO_RESULTS"))
      .mockResolvedValueOnce(google([], "REQUEST_DENIED"));
    const g = new GoogleGeocoder({ apiKey: "k", fetch });
    expect(await g.geocode("Promenade 1, Davos")).toEqual({ placeId: "gp1", location: { lat: 46.8, lng: 9.83 }, formattedAddress: "Davos" });
    expect(String(fetch.mock.calls[0]![0])).toContain("address=Promenade+1%2C+Davos");
    expect(await g.reverse({ lat: 1, lng: 2 })).toBeNull();
    expect(String(fetch.mock.calls[1]![0])).toContain("latlng=1%2C2");
    await expect(g.geocode("x")).rejects.toBeInstanceOf(GeocodeError);
  });
});

describe("verifyLink", () => {
  const davos = { lat: 46.8027, lng: 9.836 };
  const place = { id: "gp_davos", lat: 46.8028, lng: 9.8361, addr: "Promenade 1, 7270 Davos, Switzerland" };

  it("earns real-place, checked-in and HubID-address badges from Google + HubID", async () => {
    const geoFetch = vi.fn().mockResolvedValueOnce(google([place])).mockResolvedValueOnce(google([{ ...place, id: "gp_home" }]));
    const hubFetch = vi.fn(async (url: string) =>
      String(url).endsWith("/user")
        ? hub({ id: 7, profile: { address: "Promenade 1", city: "Davos", zip: "7270", country: "CH" } })
        : hub([{ google_place_id: "gp_davos" }]),
    );
    const result = await verifyLink(
      { location: davos, address: "Promenade 1, Davos" },
      {
        geocoder: new GoogleGeocoder({ apiKey: "k", fetch: geoFetch }),
        hubid: new HubIdClient({ baseUrl: "https://hub.test", privateKey: "pk", token: "jwt", fetch: hubFetch as unknown as typeof fetch }),
      },
    );
    expect(result.badges).toEqual(["real-place", "checked-in", "hubid-address"]);
    expect(result.trust).toBe("resident");
    expect(result.place?.formattedAddress).toContain("Davos");
  });

  it("never blocks: HubID failures just mean fewer badges", async () => {
    const result = await verifyLink(
      { location: davos },
      {
        geocoder: new GoogleGeocoder({ apiKey: "k", fetch: vi.fn().mockResolvedValue(google([place])) }),
        hubid: new HubIdClient({ baseUrl: "https://hub.test", privateKey: "pk", token: "jwt", fetch: vi.fn().mockRejectedValue(new Error("down")) }),
      },
    );
    expect(result).toMatchObject({ badges: ["real-place"], trust: "place" });
  });
});
