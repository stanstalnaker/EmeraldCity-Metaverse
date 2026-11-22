import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { HubIdError, type HubIdClient } from "@emerald-city/hubid-client";
import { hasBetaAccess, openSession, parseCookies, safeNext, sealSession, type Member } from "./gate";
import { loginPage } from "./page";

/**
 * Beta gate. Caddy's forward_auth asks GET /verify before serving any *.beta.hubculture.city page:
 *   200: a beta session exists (headers X-Hub-User-Id / X-Hub-User-Name go to the site);
 *   302: no session; the browser goes to the HubID sign-in page.
 * Routes under /_gate/ (served on beta.hubculture.city): login (GET page, POST sign-in), logout, token.
 */
export interface GateOptions {
  port: number;
  hubid: HubIdClient;
  secret: string;
  /** Cookie domain and allowed redirect domain, e.g. "beta.hubculture.city". */
  domain: string;
  /** Where sign-in lives, e.g. "https://beta.hubculture.city". */
  loginOrigin: string;
  extraLevels?: string[];
  ttlSeconds?: number;
  /** Most Ven one send may move from the 3D city (HubID still checks funds). */
  maxSendVen?: number;
  /** For tests: plain-http cookies. */
  insecureCookies?: boolean;
}

export const COOKIE = "ec_beta_session";
const CSRF_COOKIE = "ec_beta_csrf";

export function startGate(o: GateOptions) {
  const ttl = o.ttlSeconds ?? 12 * 3600;
  const attempts = new Map<string, number[]>();
  const cookieAttrs = (maxAge: number) =>
    `Domain=${o.domain}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${o.insecureCookies ? "" : "; Secure"}`;

  const send = (res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", ...headers });
    res.end(body);
  };
  const html = (res: ServerResponse, status: number, page: string, headers: Record<string, string | string[]> = {}) =>
    send(res, status, page, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; form-action 'self'", ...headers });

  const originalUrl = (req: IncomingMessage) => {
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? o.domain);
    const uri = String(req.headers["x-forwarded-uri"] ?? "/");
    return `https://${host}${uri}`;
  };
  const loginUrl = (next: string) => `${o.loginOrigin}/_gate/login?next=${encodeURIComponent(next)}`;

  const readForm = (req: IncomingMessage) =>
    new Promise<URLSearchParams>((resolve, reject) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 8192) {
          reject(new Error("too large"));
          req.destroy();
        }
      });
      req.on("end", () => resolve(new URLSearchParams(body)));
      req.on("error", reject);
    });

  const limited = (ip: string) => {
    const now = Date.now();
    const list = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    list.push(now);
    attempts.set(ip, list);
    return list.length > 10;
  };

  /** CORS for beta sites only (https *.{domain}), with credentials; nothing for anyone else. */
  const betaOrigin = (req: IncomingMessage) => {
    const origin = String(req.headers.origin ?? "");
    try {
      const u = new URL(origin);
      return u.protocol === "https:" && (u.hostname === o.domain || u.hostname.endsWith(`.${o.domain}`)) ? origin : null;
    } catch {
      return null;
    }
  };
  const corsFor = (req: IncomingMessage): Record<string, string> => {
    const origin = betaOrigin(req);
    return origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" } : {};
  };
  const json = (res: ServerResponse, req: IncomingMessage, status: number, body: unknown) =>
    send(res, status, JSON.stringify(body), { "Content-Type": "application/json", ...corsFor(req) });
  const readJson = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 2048) {
          reject(new Error("too large"));
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          const v = JSON.parse(body || "{}");
          resolve(v && typeof v === "object" ? v : {});
        } catch {
          reject(new Error("bad json"));
        }
      });
      req.on("error", reject);
    });
  const sends = new Map<number, number[]>();
  const sendLimited = (hubId: number) => {
    const now = Date.now();
    const list = (sends.get(hubId) ?? []).filter((t) => now - t < 10 * 60_000);
    list.push(now);
    sends.set(hubId, list);
    return list.length > 10;
  };
  const maxSend = o.maxSendVen ?? 1000;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://gate");
    const cookies = parseCookies(req.headers.cookie);
    try {
      if (url.pathname === "/verify") {
        const s = await openSession(cookies[COOKIE], o.secret);
        if (s) return send(res, 200, "", { "X-Hub-User-Id": String(s.hubId), "X-Hub-User-Name": encodeURIComponent(s.name) });
        return send(res, 302, "", { Location: loginUrl(originalUrl(req)) });
      }

      if (url.pathname === "/_gate/login" && req.method === "GET") {
        const next = safeNext(url.searchParams.get("next"), o.domain, `${o.loginOrigin}/`);
        if (await openSession(cookies[COOKIE], o.secret)) return send(res, 302, "", { Location: next });
        const csrf = randomBytes(18).toString("base64url");
        return html(res, 200, loginPage({ next, csrf }), { "Set-Cookie": `${CSRF_COOKIE}=${csrf}; Path=/_gate; Max-Age=1800; HttpOnly; SameSite=Strict${o.insecureCookies ? "" : "; Secure"}` });
      }

      if (url.pathname === "/_gate/login" && req.method === "POST") {
        const form = await readForm(req);
        const next = safeNext(form.get("next"), o.domain, `${o.loginOrigin}/`);
        const email = (form.get("email") ?? "").trim();
        const csrf = form.get("csrf") ?? "";
        const fresh = randomBytes(18).toString("base64url");
        const again = (error: string, status = 401) =>
          html(res, status, loginPage({ next, csrf: fresh, email, error }), { "Set-Cookie": `${CSRF_COOKIE}=${fresh}; Path=/_gate; Max-Age=1800; HttpOnly; SameSite=Strict${o.insecureCookies ? "" : "; Secure"}` });
        const expected = cookies[CSRF_COOKIE] ?? "";
        if (!csrf || csrf.length !== expected.length || !timingSafeEqual(Buffer.from(csrf), Buffer.from(expected))) return again("Your sign-in form expired. Please try again.", 400);
        const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim();
        if (limited(ip)) return again("Too many attempts. Please wait a few minutes.", 429);
        let token: string;
        let self: Record<string, unknown>;
        try {
          ({ token } = await o.hubid.login(email, form.get("password") ?? ""));
        } catch (err) {
          // Only a refusal from HubID means the password is wrong; anything else is the gate's or HubID's problem.
          const status = err instanceof HubIdError ? err.status : 0;
          if ([400, 401, 403, 404, 422].includes(status)) {
            const code = err instanceof HubIdError ? JSON.stringify(err.body)?.slice(0, 160) : "";
            console.info(`beta-gate: HubID refused a sign-in (${status} ${code})`);
            return again("That email and password don't match a HubID.");
          }
          console.error(`beta-gate: HubID sign-in failed (${status || "no response"}): ${err instanceof Error ? err.message : String(err)}`);
          return again("HubID couldn't check your sign-in just now. Please try again in a minute.", 502);
        }
        try {
          self = await o.hubid.withToken(token).getSelf<Record<string, unknown>>();
        } catch (err) {
          console.error(`beta-gate: HubID profile read failed: ${err instanceof Error ? err.message : String(err)}`);
          return again("You're signed in, but HubID didn't return your profile. Please try again in a minute.", 502);
        }
        const member: Member = {
          hubId: Number(self.id),
          name: String(self.name ?? ([self.first, self.last].filter(Boolean).join(" ") || "Member")),
          picture: typeof (self.profile as { image?: unknown } | undefined)?.image === "string" ? ((self.profile as { image: string }).image) : null,
          memberships: Array.isArray(self.memberships) ? self.memberships.map(String) : [],
          sadmin: self.sadmin === true,
        };
        if (!hasBetaAccess(member, o.extraLevels)) {
          console.info(`beta-gate: HubID ${member.hubId} has no beta level (memberships: ${member.memberships.join(", ") || "none"}; sadmin: ${member.sadmin === true})`);
          return again("Your HubID doesn't have beta access yet. Ask Hub Culture for Beta Tester membership.", 403);
        }
        const jwe = await sealSession({ hubId: member.hubId, name: member.name, picture: member.picture, token }, o.secret, ttl);
        return send(res, 303, "", { Location: next, "Set-Cookie": [`${COOKIE}=${jwe}; ${cookieAttrs(ttl)}`, `${CSRF_COOKIE}=; Path=/_gate; Max-Age=0`] });
      }

      if (url.pathname === "/_gate/logout") {
        return send(res, 303, "", { Location: `${o.loginOrigin}/_gate/login`, "Set-Cookie": `${COOKIE}=; ${cookieAttrs(0)}` });
      }

      if (url.pathname === "/_gate/token") {
        // The 3D city (another beta subdomain) reads the member's HubID token to join presence.
        if (req.method === "OPTIONS") return send(res, 204, "", { ...corsFor(req), "Access-Control-Allow-Methods": "GET" });
        const s = await openSession(cookies[COOKIE], o.secret);
        if (!s) return json(res, req, 401, { error: "signed_out" });
        return json(res, req, 200, { hubId: s.hubId, name: s.name, token: s.token });
      }

      // ---- Member services for beta sites (the 3D city's wallet, friends and profile panels).
      // HubID's app keys stay here; the browser only ever holds its own session cookie.
      if (url.pathname.startsWith("/_gate/api/")) {
        if (req.method === "OPTIONS") {
          return send(res, 204, "", { ...corsFor(req), "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, X-Hub-Action", "Access-Control-Max-Age": "600" });
        }
        const s = await openSession(cookies[COOKIE], o.secret);
        if (!s) return json(res, req, 401, { error: "signed_out" });
        const member = o.hubid.withToken(s.token);
        try {
          if (url.pathname === "/_gate/api/me" && req.method === "GET") {
            const balance = await member.venBalance().catch(() => null);
            return json(res, req, 200, { hubId: s.hubId, name: s.name, picture: s.picture, venBalance: balance });
          }
          if (url.pathname === "/_gate/api/friends" && req.method === "GET") {
            const f = await member.friends({ name: url.searchParams.get("name") ?? undefined });
            return json(res, req, 200, {
              count: f.count,
              items: f.items.map((x) => ({
                id: Number(x.id),
                name: String(x.name ?? ""),
                picture: typeof x.picture === "string" ? x.picture : (x.picture as { thumbnail?: string } | null)?.thumbnail ?? null,
              })),
            });
          }
          if (url.pathname === "/_gate/api/ven/send" && req.method === "POST") {
            // Only beta sites, only deliberate JSON calls (a custom header forces a CORS preflight).
            if (!betaOrigin(req)) return json(res, req, 403, { error: "origin" });
            if (req.headers["x-hub-action"] !== "send-ven" || !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
              return json(res, req, 400, { error: "bad_request" });
            }
            const body = await readJson(req);
            const to = Number(body.to);
            const amount = Number(body.amount);
            const message = typeof body.message === "string" ? body.message.slice(0, 140) : undefined;
            if (!Number.isInteger(to) || to <= 0) return json(res, req, 400, { error: "Choose who to send Ven to." });
            if (to === s.hubId) return json(res, req, 400, { error: "You can't send Ven to yourself." });
            if (!Number.isFinite(amount) || amount <= 0) return json(res, req, 400, { error: "Enter an amount of Ven." });
            if (Math.round(amount * 100) !== amount * 100) return json(res, req, 400, { error: "Ven has at most two decimals." });
            if (amount > maxSend) return json(res, req, 400, { error: `You can send up to ${maxSend} Ven at a time from here.` });
            if (sendLimited(s.hubId)) return json(res, req, 429, { error: "That's a lot of sends. Please wait a few minutes." });
            const r = await member.sendVen(to, amount, message);
            console.info(`beta-gate: HubID ${s.hubId} sent ${amount} Ven to ${to}`);
            return json(res, req, 200, { ok: true, message: r?.message ?? `Sent ${amount} Ven.` });
          }
          return json(res, req, 404, { error: "not_found" });
        } catch (err) {
          const status = err instanceof HubIdError ? err.status : 0;
          const detail = err instanceof HubIdError ? JSON.stringify(err.body)?.slice(0, 200) : String(err);
          console.error(`beta-gate: member API ${url.pathname} failed (${status || "no response"}): ${detail}`);
          // HubID's own refusals (insufficient funds, unconfirmed email) are worth showing as they are.
          const said = err instanceof HubIdError && typeof err.body === "object" && err.body !== null ? (Object.values(err.body as Record<string, unknown>).flat().find((v) => typeof v === "string") as string | undefined) : undefined;
          return json(res, req, status >= 400 && status < 500 ? status : 502, { error: said ?? "HubID couldn't do that just now." });
        }
      }

      if (url.pathname === "/healthz") return send(res, 200, "ok");
      return send(res, 404, "not found");
    } catch (err) {
      console.error("beta-gate", err);
      return send(res, 500, "error");
    }
  });
  server.listen(o.port);
  return server;
}
