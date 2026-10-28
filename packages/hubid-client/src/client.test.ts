import { describe, expect, it, vi } from "vitest";
import { HubIdClient, HubIdError } from "./index";

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
