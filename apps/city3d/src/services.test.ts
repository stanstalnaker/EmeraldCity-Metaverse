import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberApi } from "./services";

describe("MemberApi base", () => {
  afterEach(() => vi.unstubAllGlobals());

  const seen = () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ hubId: 1, name: "A", picture: null, venBalance: 2 }), { status: 200 });
    });
    return urls;
  };

  it("uses the live site's /city/api when VITE_MEMBER_API is set", async () => {
    const urls = seen();
    await MemberApi.from("https://hubculture.city/city/api/", "https://gate.example").me();
    expect(urls).toEqual(["https://hubculture.city/city/api/me"]);
  });

  it("falls back to the beta gate's /_gate/api", async () => {
    const urls = seen();
    await MemberApi.from(undefined, "https://gate.example/").friends("ad");
    expect(urls).toEqual(["https://gate.example/_gate/api/friends?name=ad"]);
  });

  it("uses a sample member with neither", () => {
    expect(MemberApi.from(null, null).live).toBe(false);
  });
});
