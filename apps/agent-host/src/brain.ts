/**
 * An agent's brain decides its next actions from what it perceives and what its owner asked.
 *
 * In production every agent is a personal replica of Zeke: the agent host sends the perception and
 * the owner's instructions to zeke-ai-server (`POST /agents/decide`), where Zeke decides with his
 * QEM (so he knows the city, the people and the market) and Claude, and reports the tokens used,
 * which the host charges to the agent's Ven budget. The script brain is for demos and tests.
 */
import type { Trade } from "@emerald-city/agents";

export interface Perception {
  now: string;
  agent: { hubId: number; name: string; ownerHubId: number };
  persona: string;
  instructions: string;
  /** Where the agent is: island (world) and nearest named place. */
  location: { island: string; world: string | null; near: string | null; walking: boolean };
  /** Places on this island, and islands it can travel to. */
  places: { id: string; label: string; kind: string; distance: number }[];
  islands: { slug: string; name: string; has3d: boolean }[];
  /** Actors in the same room, nearest first (kind kept, so agents tell people from agents). */
  nearby: { hubId: number; name: string; kind: "human" | "agent"; distance: number | null }[];
  /** Chat lines and requests since the last decision. */
  heard: { from: string; fromHubId: number; text: string; at: string; direct: boolean }[];
  trades: Pick<Trade, "id" | "seller" | "buyer" | "item" | "priceVen" | "status" | "turn">[];
  wallet: { ven: number; mode: "sandbox" | "hubid" };
  budget: { venLeft: number; paused: boolean };
}

export type Action =
  | { do: "go"; place: string }
  | { do: "travel"; island: string }
  | { do: "say"; text: string }
  | { do: "ask"; to: number | string; text: string }
  | { do: "offer"; to: number; side: "sell" | "buy"; item: string; priceVen: number; note?: string }
  | { do: "counter"; trade: string; priceVen: number }
  | { do: "accept"; trade: string }
  | { do: "decline"; trade: string }
  | { do: "wait"; seconds: number }
  | { do: "report"; text: string };

export interface Decision {
  actions: Action[];
  /** Tokens Zeke used (input + output), charged to the Ven budget. */
  tokens: number;
  /** A short line of Zeke's reasoning for the owner's activity log. */
  note?: string;
}

export interface Brain {
  decide(p: Perception): Promise<Decision>;
}

const ACTIONS = new Set(["go", "travel", "say", "ask", "offer", "counter", "accept", "decline", "wait", "report"]);

/** Keep only well-formed actions (Zeke's output is untrusted input to the world). */
export function cleanActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  const out: Action[] = [];
  for (const a of raw.slice(0, 6)) {
    if (!a || typeof a !== "object" || !ACTIONS.has((a as { do?: string }).do ?? "")) continue;
    const x = a as Record<string, unknown>;
    const str = (k: string, max = 500) => (typeof x[k] === "string" ? (x[k] as string).slice(0, max) : undefined);
    switch (x.do) {
      case "go": if (str("place")) out.push({ do: "go", place: str("place")! }); break;
      case "travel": if (str("island")) out.push({ do: "travel", island: str("island")! }); break;
      case "say": if (str("text")) out.push({ do: "say", text: str("text", 600)! }); break;
      case "report": if (str("text")) out.push({ do: "report", text: str("text", 1000)! }); break;
      case "ask": if (str("text") && (typeof x.to === "number" || typeof x.to === "string")) out.push({ do: "ask", to: x.to as number | string, text: str("text")! }); break;
      case "offer":
        if (typeof x.to === "number" && (x.side === "sell" || x.side === "buy") && str("item") && typeof x.priceVen === "number")
          out.push({ do: "offer", to: x.to, side: x.side, item: str("item", 200)!, priceVen: x.priceVen, note: str("note", 200) });
        break;
      case "counter": if (str("trade") && typeof x.priceVen === "number") out.push({ do: "counter", trade: str("trade")!, priceVen: x.priceVen }); break;
      case "accept": if (str("trade")) out.push({ do: "accept", trade: str("trade")! }); break;
      case "decline": if (str("trade")) out.push({ do: "decline", trade: str("trade")! }); break;
      case "wait": out.push({ do: "wait", seconds: Math.min(Math.max(Number(x.seconds) || 10, 2), 600) }); break;
    }
  }
  return out;
}

/** Zeke decides (zeke-ai-server `POST /agents/decide`, system token). */
export class ZekeBrain implements Brain {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async decide(p: Perception): Promise<Decision> {
    const r = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/agents/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ perception: p }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`Zeke decide failed: ${r.status}`);
    const body = (await r.json()) as { actions?: unknown; usage?: { tokens?: number }; note?: string };
    return { actions: cleanActions(body.actions), tokens: Math.max(0, Number(body.usage?.tokens) || 0), note: typeof body.note === "string" ? body.note.slice(0, 300) : undefined };
  }
}

/**
 * A scripted brain for demos and tests: runs the agent's `script` steps in order, then handles
 * trades by simple rules (sellers accept at or above their floor, buyers accept at or below their
 * ceiling, and counter halfway otherwise). Costs nothing.
 */
export class ScriptBrain implements Brain {
  private step = 0;
  constructor(private readonly script: Action[], private readonly rules: { floorVen?: number; ceilingVen?: number; loop?: boolean } = {}) {}

  async decide(p: Perception): Promise<Decision> {
    const actions: Action[] = [];
    for (const t of p.trades) {
      if (t.turn !== p.agent.hubId || !["open", "countered"].includes(t.status)) continue;
      const selling = t.seller === p.agent.hubId;
      const limit = selling ? this.rules.floorVen : this.rules.ceilingVen;
      if (limit === undefined) actions.push({ do: "accept", trade: t.id });
      else if (selling ? t.priceVen >= limit : t.priceVen <= limit) actions.push({ do: "accept", trade: t.id });
      else actions.push({ do: "counter", trade: t.id, priceVen: Math.round(((t.priceVen + limit) / 2) * 100) / 100 });
    }
    if (actions.length) return { actions, tokens: 0, note: "trade rules" };
    if (p.location.walking) return { actions: [{ do: "wait", seconds: 2 }], tokens: 0 };
    if (this.step >= this.script.length && this.rules.loop && this.script.length) this.step = 0;
    const next = this.script[this.step];
    if (!next) return { actions: [{ do: "wait", seconds: 10 }], tokens: 0 };
    this.step++;
    return { actions: [next], tokens: 0, note: `script step ${this.step}` };
  }
}
