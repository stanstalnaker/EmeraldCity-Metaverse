import { describe, expect, it, vi } from "vitest";
import { geolink, launchLink, OCEAN_COMMONS, parseLatLng, plotAt, plotView, sanitizePlotAt, type PlotAt, type PlotLookup } from "./index";

const where = { lat: 38.9089, lng: 1.4329, cell: "883951cecdfffff", address: "MIP1|GAIA|CELL|883951cecdfffff" };
const square = { type: "Polygon", coordinates: [[[1.43, 38.9], [1.44, 38.9], [1.44, 38.91], [1.43, 38.9]]] };

function land(status: string, extra: Record<string, unknown> = {}): PlotAt {
  return sanitizePlotAt({
    found: "plot",
    buyable: status === "free",
    buy_url: "https://gaia.club/account?plot=land-abc123",
    where,
    plot: { type: "Feature", id: "land-abc123", geometry: square,
      properties: { id: "land-abc123", kind: "land", area_m2: 12_400, price_ven: 1240, status, tier: 2, region: "Ibiza", ...extra } },
  })!;
}
const ok = (at: PlotAt): PlotLookup => ({ state: "ok", at });

describe("plotView: what an island shows about the land under it", () => {
  it("a free land plot can be bought on gaia.club, with its price", () => {
    const v = plotView(ok(land("free")));
    expect(v).toMatchObject({ tone: "free", kindLabel: "Land plot", size: "1.2 ha", price: "1,240 Ven", detail: "Tier 2 · Ibiza", id: "land-abc123" });
    expect(v.status).toBe("Free: buy on gaia.club for 1,240 Ven");
    expect(v.buy).toEqual({ url: "https://gaia.club/account?plot=land-abc123", label: "Buy this plot" });
    expect(v.commons).toBeUndefined();
  });
  it("a listed plot shows its listing price, and no buy button", () => {
    const v = plotView(ok(land("for_sale", { listing: { price_ven: 3000 } })));
    expect(v.status).toBe("Listed for 3,000 Ven");
    expect(v.price).toBe("3,000 Ven");
    expect(v.buy).toBeUndefined();
    expect(v.listing?.url).toContain("plot=land-abc123");
  });
  it("owned, reserved and unknown plots say so in plain words, never who owns them", () => {
    const owned = plotView(ok(land("owned", { owner: "someone@example.com", owner_hubid: 42, mine: true })));
    expect(owned.status).toBe("Owned: links are open");
    expect(owned.buy).toBeUndefined();
    expect(JSON.stringify(owned)).not.toMatch(/someone|owner|42|mine/);
    expect(plotView(ok(land("reserved"))).status).toBe("Being bought");
    expect(plotView(ok(land("unknown"))).tone).toBe("unknown");
  });
  it("a free ocean plot carries the ocean commons line", () => {
    const at = sanitizePlotAt({ found: "plot", buyable: true, buy_url: "https://beta.gaia.club/account?plot=ocean-88abc", where,
      plot: { type: "Feature", geometry: square, properties: { id: "ocean-88abc", kind: "ocean", area_m2: 737_327, price_ven: 74, status: "free", seller: "Ocean Climate Fund", buyable: true } } })!;
    const v = plotView(ok(at));
    expect(v).toMatchObject({ tone: "free", kindLabel: "Ocean plot", size: "73.7 ha", commons: OCEAN_COMMONS });
    expect(v.buy?.url).toBe("https://beta.gaia.club/account?plot=ocean-88abc");
  });
  it("an ocean cell that can't be bought has no buy button, and says why", () => {
    const at = sanitizePlotAt({ found: "plot", buyable: false, buy_url: "https://gaia.club/account?plot=ocean-88abc", where,
      plot: { type: "Feature", id: "ocean-88abc", geometry: square, properties: { h3: "88abc", buyable: false, reason: "this cell touches land: coastal cells are cut with the land" } } })!;
    const v = plotView(ok(at));
    expect(v).toMatchObject({ tone: "closed", status: "Not for sale", kindLabel: "Ocean plot", detail: expect.stringContaining("coastal") });
    expect(v.buy).toBeUndefined();
    expect(v.commons).toBeUndefined();
  });
  it("pending, none, not live and errors", () => {
    expect(plotView(ok(sanitizePlotAt({ found: "pending", plot: null, buyable: false, retry_after_secs: 20, where })!))).toMatchObject({ tone: "pending", status: "Being mapped", retryAfterSecs: 20 });
    const none = plotView(ok(sanitizePlotAt({ found: "none", plot: null, buyable: false, where })!));
    expect(none.tone).toBe("none");
    expect(none.buy).toBeUndefined();
    expect(plotView({ state: "not-live" }).status).toBe("Plot lookup isn't live yet");
    expect(plotView({ state: "error", message: "x" }).tone).toBe("error");
  });
  it("free but not buyable (Gaia can't sell it right now) shows no button", () => {
    const at = land("free");
    expect(plotView(ok({ ...at, buyable: false })).buy).toBeUndefined();
  });
});

describe("sanitizePlotAt", () => {
  it("keeps only the contract's fields", () => {
    const at = land("owned", { owner: "x", mine: true, notes: "secret" });
    expect(Object.keys(at.plot!.properties).sort()).toEqual(["area_m2", "id", "kind", "listing", "price_ven", "region", "status", "tier"].sort());
  });
  it("drops buy links that aren't https on gaia.club", () => {
    expect(sanitizePlotAt({ found: "plot", buyable: true, buy_url: "https://evil.example/account?plot=1", where, plot: null })!.buy_url).toBeUndefined();
    expect(sanitizePlotAt({ found: "plot", buyable: true, buy_url: "http://gaia.club/account", where, plot: null })!.buy_url).toBeUndefined();
    expect(sanitizePlotAt({ found: "plot", buyable: true, buy_url: "https://notgaia.club/account", where, plot: null })!.buy_url).toBeUndefined();
  });
  it("rejects what isn't a plots/at answer", () => {
    expect(sanitizePlotAt(null)).toBeNull();
    expect(sanitizePlotAt({ found: "maybe", where })).toBeNull();
    expect(sanitizePlotAt({ found: "none" })).toBeNull();
  });
});

describe("plotAt: the client", () => {
  const body = { found: "plot", buyable: true, buy_url: "https://gaia.club/account?plot=land-abc123", where,
    plot: { type: "Feature", geometry: square, properties: { id: "land-abc123", kind: "land", area_m2: 900, price_ven: 90, status: "free", owner: "x" } } };
  const respond = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } }));

  it("asks {base}/plots/at with the point and sanitizes the answer", async () => {
    const f = respond(200, body);
    const r = await plotAt("https://beta.gaia.club/api/gaia/", 38.90891234567, 1.4329, { fetch: f as unknown as typeof fetch });
    expect((f.mock.calls[0] as unknown[])[0]).toBe("https://beta.gaia.club/api/gaia/plots/at?lat=38.908912&lng=1.4329");
    expect(r.state).toBe("ok");
    if (r.state === "ok") {
      expect(r.at.plot?.properties).not.toHaveProperty("owner");
      expect(plotView(r).buy?.label).toBe("Buy this plot");
    }
  });
  it("a 404 means the route isn't live yet", async () => {
    expect(await plotAt("/api", 1, 2, { fetch: respond(404, { error: "not_found" }) as unknown as typeof fetch })).toEqual({ state: "not-live" });
  });
  it("other failures are errors, not throws", async () => {
    expect((await plotAt("/api", 1, 2, { fetch: respond(502, {}) as unknown as typeof fetch })).state).toBe("error");
    expect((await plotAt("/api", 1, 2, { fetch: respond(200, { nope: true }) as unknown as typeof fetch })).state).toBe("error");
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await plotAt("/api", 1, 2, { fetch: down as unknown as typeof fetch })).toEqual({ state: "error", message: "Couldn't reach Gaia." });
    const slow = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
    expect(await plotAt("/api", 1, 2, { fetch: slow as unknown as typeof fetch, timeoutMs: 20 })).toEqual({ state: "error", message: "Gaia took too long to answer." });
    expect((await plotAt("/api", 95, 2)).state).toBe("error");
  });
});

describe("parseLatLng and launch links", () => {
  it("validates a query's lat and lng", () => {
    expect(parseLatLng("38.9", "1.43")).toEqual({ lat: 38.9, lng: 1.43 });
    expect(parseLatLng("", "1")).toBeNull();
    expect(parseLatLng(null, "1")).toBeNull();
    expect(parseLatLng("91", "0")).toBeNull();
    expect(parseLatLng("0", "-181")).toBeNull();
    expect(parseLatLng("abc", "0")).toBeNull();
  });
  it("a launch link carries the island's geolink cell and its Gaia plot", () => {
    const g = geolink({ lat: 38.9089, lng: 1.4329 });
    const u = new URL(launchLink("https://beta.hubculture.city/launch-properties", { city: "ibiza", geolink: g, plotId: "land-abc123" }));
    expect(u.origin + u.pathname).toBe("https://beta.hubculture.city/launch-properties");
    expect(Object.fromEntries(u.searchParams)).toEqual({ city: "ibiza", lat: "38.9089", lng: "1.4329", geolink: g.h3, gaia_plot: "land-abc123" });
    expect(new URL(launchLink("https://x.test/launch?ref=arch", { city: "davos" })).search).toBe("?ref=arch&city=davos");
  });
});
