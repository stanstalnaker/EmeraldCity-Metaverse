import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { HubIdClient } from "@emerald-city/hubid-client";
import { hubIdRemoteResolver } from "./identity";

const profiles: Record<number, Record<string, unknown>> = {
  11: { id: 11, name: "Tess Tester" },
  21: { id: 21, name: "Scout", profile: { profile_type: "bot", parent_user_id: 11 } },
};
// Stand-in for the real HubID: it accepts only tokens it issued.
const issued = new Set<string>();
const hubid = {
  withToken: (t: string) => ({
    getSelf: async () => {
      if (!issued.has(t)) throw new Error("401 token_invalid");
      const sub = Number(JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()).sub);
      return profiles[sub];
    },
  }),
} as unknown as HubIdClient;
const token = async (sub: number, opts: { issue?: boolean; exp?: number } = {}) => {
  const t = await new SignJWT({}).setJti(crypto.randomUUID()).setProtectedHeader({ alg: "HS256" }).setSubject(String(sub)).setExpirationTime(opts.exp ?? "1h").sign(new TextEncoder().encode("hubid-only-secret"));
  if (opts.issue !== false) issued.add(t);
  return t;
};
const resolve = hubIdRemoteResolver({ hubid });

describe("presence verifying tokens with HubID itself", () => {
  it("recognises people and agents from the real HubID", async () => {
    expect(await resolve(await token(11))).toMatchObject({ kind: "human", hubId: 11, displayName: "Tess Tester" });
    expect(await resolve(await token(21))).toMatchObject({ kind: "agent", hubId: 21, ownerHubId: 11 });
  });
  it("refuses tokens HubID didn't issue, expired ones, and junk", async () => {
    await expect(resolve(await token(11, { issue: false }))).rejects.toThrow();
    await expect(resolve(await token(11, { exp: Math.floor(Date.now() / 1000) - 60 }))).rejects.toThrow(/expired/);
    await expect(resolve("not-a-token")).rejects.toThrow();
  });
});

import { parseServiceKeys, withServiceKeys } from "./identity";

describe("presence service keys (house agents like Zeke)", () => {
  const secret = "s".repeat(32);
  const keys = parseServiceKeys(`zeke:39:${secret},bad:0:x,short:5:abc`);
  const resolve = withServiceKeys(keys, async () => { throw new Error("member path"); });

  it("parses only well-formed keys with long secrets", () => {
    expect(keys.map((k) => k.name)).toEqual(["zeke"]);
  });

  it("signs Zeke in as his own agent with the right key, and refuses a wrong one", async () => {
    const a = await resolve(`service:zeke:${secret}`);
    expect(a).toMatchObject({ kind: "agent", hubId: 39, displayName: "Zeke" });
    await expect(resolve(`service:zeke:${"x".repeat(32)}`)).rejects.toThrow("bad service key");
    await expect(resolve("service:nobody:whatever")).rejects.toThrow("bad service key");
    await expect(resolve("human:1:Stan")).rejects.toThrow("member path");
  });
});
