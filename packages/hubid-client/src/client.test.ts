import { describe, expect, it, vi } from "vitest";
import { HubIdClient, HubIdError, slugify } from "./index";

const envelope = (data: unknown, status = "success") =>
  new Response(JSON.stringify({ status, errors: [], data, code: 200, time: 0 }), { status: 200 });

describe("HubIdClient", () => {
  it("lists properties across pages, scoped to Emerald City", async () => {
    const page = (n: number, total: number) => ({
      offset: 0,
      limit: 250,
      total,
      count: n,
      items: Array.from({ length: n }, (_, i) => ({ id: i, group: 1, name: `P${i}`, visible: 1, is_private: false })),
    });
    const fetch = vi.fn().mockResolvedValueOnce(envelope(page(250, 260))).mockResolvedValueOnce(envelope(page(10, 260)));
    const client = new HubIdClient({ baseUrl: "https://api.test/", fetch });
    const props = await client.listProperties();
    expect(props).toHaveLength(260);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://api.test/v2/pavilions/list?territory=Emerald+City&offset=0&limit=250",
    );
    expect(String(fetch.mock.calls[1]![0])).toContain("offset=250");
  });

  it("sends keys and bearer token on authed calls", async () => {
    const fetch = vi.fn().mockResolvedValue(envelope({ id: 1 }));
    const client = new HubIdClient({ baseUrl: "https://api.test", privateKey: "pk", fetch }).withToken("jwt");
    await client.getSelf();
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "Private-Key": "pk", Authorization: "Bearer jwt" });
  });

  it("refuses authed calls without a token, and surfaces API errors", async () => {
    const fetch = vi.fn().mockResolvedValue(envelope(null, "error"));
    const client = new HubIdClient({ baseUrl: "https://api.test", privateKey: "pk", fetch });
    await expect(client.getSelf()).rejects.toThrow(/token is required/);
    await expect(client.getProperty(1)).rejects.toBeInstanceOf(HubIdError);
  });
});

describe("property writes", () => {
  it("creates a property with HubID's required fields", async () => {
    const pavilion = { id: 9, group: 1, name: "Café Örbit", visible: 1, is_private: false, latitude: "51.5", longitude: "-0.12" };
    const fetch = vi.fn().mockResolvedValue(envelope({ success: true, pavilion }));
    const client = new HubIdClient({ baseUrl: "https://api.test", privateKey: "pk", fetch }).withToken("jwt");
    const p = await client.createProperty({ name: "  Café Örbit ", location: { lat: 51.5, lng: -0.12 }, timezone: "Europe/London" });
    expect(p).toMatchObject({ id: 9, location: { lat: 51.5, lng: -0.12 } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.test/pavilions");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Café Örbit",
      localename: "Café Örbit",
      url: "cafe-orbit",
      timezone: "Europe/London",
      latitude: "51.500000",
      longitude: "-0.120000",
      address: "Emerald City",
      territory: "Emerald City",
      visible: true,
      is_private: false,
    });
  });

  it("validates names before calling HubID", async () => {
    const fetch = vi.fn();
    const client = new HubIdClient({ baseUrl: "https://api.test", privateKey: "pk", fetch }).withToken("jwt");
    await expect(client.createProperty({ name: "x", location: { lat: 1, lng: 1 } })).rejects.toThrow(/2–50/);
    await expect(client.createProperty({ name: "!!", location: { lat: 1, lng: 1 } })).rejects.toThrow(/letters or digits/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only changed fields on update", async () => {
    const fetch = vi.fn().mockResolvedValue(envelope({}));
    const client = new HubIdClient({ baseUrl: "https://api.test", privateKey: "pk", fetch }).withToken("jwt");
    await client.updateProperty(5, { location: { lat: 1.23456789, lng: 2 } });
    expect(JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ latitude: "1.234568", longitude: "2.000000" });
    await client.updateProperty(5, {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("slugifies like the legacy site", () => {
    expect(slugify("Hub Culture — Davos Pavilion!")).toBe("hub-culture-davos-pavilion");
  });
});
