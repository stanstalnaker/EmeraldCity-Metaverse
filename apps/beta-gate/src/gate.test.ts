import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HubIdClient } from "@emerald-city/hubid-client";
import { hasBetaAccess, openSession, safeNext, sealSession } from "./gate";
import { COOKIE, startGate } from "./server";

const SECRET = "x".repeat(40);
const users: Record<string, { pw: string; self: Record<string, unknown> }> = {
  "tester@hub.test": { pw: "pw", self: { id: 11, name: "Tess Tester", memberships: ["Beta Testers", "Personal Basic"] } },
  "member@hub.test": { pw: "pw", self: { id: 12, name: "Max Member", memberships: ["Personal Basic"] } },
  "admin@hub.test": { pw: "pw", self: { id: 3, name: "Ada Admin", memberships: [], sadmin: true } },
};
const fakeHubId = {
  async login(email: string, pw: string) {
    const u = users[email];
    if (!u || u.pw !== pw) throw new Error("invalid");
    return { token: `tok-${email}`, userId: Number(u.self.id) };
  },
  withToken(token: string) {
    return { getSelf: async () => users[token.replace("tok-", "")]!.self };
  },
} as unknown as HubIdClient;

let server: ReturnType<typeof startGate>;
const port = 18790;
const base = `http://127.0.0.1:${port}`;
beforeAll(() => {
  server = startGate({ port, hubid: fakeHubId, secret: SECRET, domain: "beta.hubculture.city", loginOrigin: "https://beta.hubculture.city", insecureCookies: true });
});
afterAll(() => server.close());

async function signIn(email: string, pw = "pw", next = "https://city.beta.hubculture.city/?world=davos") {
  const page = await fetch(`${base}/_gate/login?next=${encodeURIComponent(next)}`);
  const csrfCookie = page.headers.get("set-cookie")!.split(";")[0]!;
  const csrf = csrfCookie.split("=")[1]!;
  return fetch(`${base}/_gate/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
    body: new URLSearchParams({ email, password: pw, csrf, next }).toString(),
  });
}
const sessionCookie = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith(COOKIE))!.split(";")[0]!;

describe("access rules", () => {
  it("lets admins and beta testers in, nobody else", () => {
    expect(hasBetaAccess({ memberships: ["Beta Testers"] })).toBe(true);
    expect(hasBetaAccess({ memberships: ["general administrators"] })).toBe(true);
    expect(hasBetaAccess({ memberships: [], sadmin: true })).toBe(true);
    expect(hasBetaAccess({ memberships: ["Patron"] })).toBe(false);
    expect(hasBetaAccess({ memberships: ["Patron"] }, ["Patron"])).toBe(true);
  });
  it("only redirects back to beta sites over https", () => {
    const f = "https://beta.hubculture.city/";
    expect(safeNext("https://city.beta.hubculture.city/x", "beta.hubculture.city", f)).toBe("https://city.beta.hubculture.city/x");
    expect(safeNext("https://evil.example/", "beta.hubculture.city", f)).toBe(f);
    expect(safeNext("https://beta.hubculture.city.evil.example/", "beta.hubculture.city", f)).toBe(f);
    expect(safeNext("http://city.beta.hubculture.city/", "beta.hubculture.city", f)).toBe(f);
    expect(safeNext("javascript:alert(1)", "beta.hubculture.city", f)).toBe(f);
  });
  it("seals sessions so they can't be read or forged", async () => {
    const jwe = await sealSession({ hubId: 11, name: "T", picture: null, token: "secret-token" }, SECRET, 60);
    expect(jwe).not.toContain("secret-token");
    expect((await openSession(jwe, SECRET))?.token).toBe("secret-token");
    expect(await openSession(jwe, "y".repeat(40))).toBeNull();
    expect(await openSession(jwe.slice(0, -4) + "AAAA", SECRET)).toBeNull();
  });
});

describe("gate", () => {
  it("sends signed-out visitors to HubID sign-in, back to where they were going", async () => {
    const r = await fetch(`${base}/verify`, { redirect: "manual", headers: { "X-Forwarded-Host": "city.beta.hubculture.city", "X-Forwarded-Uri": "/?world=davos" } });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://beta.hubculture.city/_gate/login?next=" + encodeURIComponent("https://city.beta.hubculture.city/?world=davos"));
  });

  it("signs a beta tester in for every beta site and hands the 3D city their token", async () => {
    const r = await signIn("tester@hub.test");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://city.beta.hubculture.city/?world=davos");
    const cookie = sessionCookie(r);
    expect(r.headers.getSetCookie().find((c) => c.startsWith(COOKIE))).toMatch(/Domain=beta\.hubculture\.city; .*HttpOnly; SameSite=Lax/);
    const ok = await fetch(`${base}/verify`, { headers: { Cookie: cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-hub-user-id")).toBe("11");
    const tok = await fetch(`${base}/_gate/token`, { headers: { Cookie: cookie, Origin: "https://city.beta.hubculture.city" } });
    expect(tok.headers.get("access-control-allow-origin")).toBe("https://city.beta.hubculture.city");
    expect(await tok.json()).toMatchObject({ hubId: 11, token: "tok-tester@hub.test" });
    const foreign = await fetch(`${base}/_gate/token`, { headers: { Cookie: cookie, Origin: "https://evil.example" } });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets super admins in; refuses members without beta access and wrong passwords", async () => {
    expect((await signIn("admin@hub.test")).status).toBe(303);
    const member = await signIn("member@hub.test");
    expect(member.status).toBe(403);
    expect(await member.text()).toContain("doesn&#39;t have beta access");
    expect((await signIn("tester@hub.test", "nope")).status).toBe(401);
  });

  it("refuses a sign-in without the form's own token, and signs out everywhere", async () => {
    const forged = await fetch(`${base}/_gate/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=tester%40hub.test&password=pw&csrf=x" });
    expect(forged.status).toBe(400);
    const out = await fetch(`${base}/_gate/logout`, { redirect: "manual" });
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});
