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
