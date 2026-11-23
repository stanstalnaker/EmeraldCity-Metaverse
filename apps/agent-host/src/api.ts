/**
 * The owner's controls for their agents, over HTTP: the 3D city's "My agents" panel and the
 * Telegram bot (via zeke-ai-server) both use these. Owners only see and steer their own agents.
 *
 *   GET  /agents                       my agents and their status
 *   GET  /agents/:id/activity          what it did, heard and traded
 *   PUT  /agents/:id/instructions      { instructions }
 *   POST /agents/:id/topup             { ven?, tokens? }   the Ven gateway
 *   GET  /ledger                       sandbox balances and transactions (sandbox mode only)
 *
 * Auth: Authorization: Bearer <owner's HubID token>. In production the token is checked with
 * HubID (GET /user); in development "human:<id>:<name>" tokens are accepted, as in presence.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SandboxLedger } from "@emerald-city/agents";
import type { AgentRuntime } from "./runtime";

export type OwnerResolver = (token: string) => Promise<number>;

export function devOwners(): OwnerResolver {
  if (process.env.NODE_ENV === "production") throw new Error("dev owner tokens must not be used in production");
  return async (token) => {
    const [kind, id] = token.split(":");
    if (kind === "human" && /^\d+$/.test(id ?? "")) return Number(id);
    throw new Error("bad token");
  };
}

export function hubIdOwners(apiUrl: string, publicKey: string): OwnerResolver {
  return async (token) => {
    const r = await fetch(`${apiUrl.replace(/\/$/, "")}/user`, { headers: { Authorization: `Bearer ${token}`, "Public-Key": publicKey, Accept: "application/json" } });
    if (!r.ok) throw new Error("bad token");
    const body = (await r.json()) as { data?: { id?: number }; id?: number };
    const id = Number(body.data?.id ?? body.id);
    if (!id) throw new Error("bad token");
    return id;
  };
}

export function startApi(o: { port: number; runtimes: Map<number, AgentRuntime>; owners: OwnerResolver; ledger: SandboxLedger | null; corsOrigins: string[] }) {
  const json = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    const origin = req.headers.origin ?? "";
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(o.corsOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" } : {}),
    });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let data = "";
      req.on("data", (c) => (data.length < 16_384 ? (data += c) : req.destroy()));
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch {
          resolve({});
        }
      });
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      const origin = req.headers.origin ?? "";
      res.writeHead(o.corsOrigins.includes(origin) ? 204 : 403, o.corsOrigins.includes(origin)
        ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, PUT, POST", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" }
        : {});
      return res.end();
    }
    if (url.pathname === "/health") return json(req, res, 200, { ok: true, agents: o.runtimes.size });

    let owner: number;
    try {
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      owner = await o.owners(token);
    } catch {
      return json(req, res, 401, { error: "signed_out" });
    }

    if (url.pathname === "/ledger" && req.method === "GET") {
      if (!o.ledger) return json(req, res, 404, { error: "not_sandbox" });
      const mine = [...o.runtimes.values()].filter((r) => r.def.ownerHubId === owner).map((r) => r.def.hubId);
      const snap = o.ledger.snapshot();
      return json(req, res, 200, {
        balances: Object.fromEntries(Object.entries(snap.balances).filter(([id]) => mine.includes(Number(id)))),
        transactions: snap.transactions.filter((t) => mine.includes(t.from) || mine.includes(t.to)),
      });
    }
    if (url.pathname === "/agents" && req.method === "GET") {
      const mine = [...o.runtimes.values()].filter((r) => r.def.ownerHubId === owner);
      return json(req, res, 200, { items: await Promise.all(mine.map((r) => r.status())) });
    }
    const m = /^\/agents\/(\d+)\/(activity|instructions|topup)$/.exec(url.pathname);
    const rt = m ? o.runtimes.get(Number(m[1])) : undefined;
    if (!m || !rt) return json(req, res, 404, { error: "not_found" });
    if (rt.def.ownerHubId !== owner) return json(req, res, 403, { error: "not_your_agent" });

    if (m[2] === "activity" && req.method === "GET") return json(req, res, 200, { items: rt.activity.slice(-100) });
    if (m[2] === "instructions" && req.method === "PUT") {
      const b = await readBody(req);
      if (typeof b.instructions !== "string" || !b.instructions.trim()) return json(req, res, 400, { error: "Write the instructions." });
      rt.setInstructions(b.instructions);
      return json(req, res, 200, { ok: true });
    }
    if (m[2] === "topup" && req.method === "POST") {
      const b = await readBody(req);
      const ven = Number(b.ven ?? 0), tokens = Math.floor(Number(b.tokens ?? 0));
      if (!(ven >= 0 && ven <= 10_000 && Math.round(ven * 100) === ven * 100) || !(tokens >= 0 && tokens <= 2_000_000) || (ven === 0 && tokens === 0))
        return json(req, res, 400, { error: "Top up between 0.01 and 10,000 Ven, and/or up to 2,000,000 tokens." });
      try {
        await rt.topUp(ven, tokens);
      } catch (e) {
        return json(req, res, 409, { error: e instanceof Error ? e.message : "top-up failed" });
      }
      return json(req, res, 200, { ok: true, status: await rt.status() });
    }
    return json(req, res, 405, { error: "method" });
  });
  server.listen(o.port);
  return server;
}
