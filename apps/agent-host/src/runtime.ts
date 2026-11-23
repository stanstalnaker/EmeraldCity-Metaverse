/**
 * One Mandala agent living in the worlds: connected to presence as its own HubID agent, walking the
 * streets of its island, travelling between islands (through portals where there are some), talking,
 * asking, and trading in Ven, all decided by its brain (a personal Zeke) within its owner's
 * instructions, token allowance and Ven.
 */
import { CityAgent, findPlace, routeLength, TRADE_INTENTS, TradeDesk, Walker, type Ledger, type Trade, type TradeIntent } from "@emerald-city/agents";
import type { Actor, AgentReplyBody, AgentRequestBody } from "@emerald-city/core";
import type { Atlas, WorldInfo } from "./atlas";
import type { Action, Brain, Perception } from "./brain";

export interface AgentDef {
  hubId: number;
  /** Presence token for the agent's own HubID sub-profile (never its owner's). */
  token: string;
  ownerHubId: number;
  name: string;
  /** Who this Zeke replica is for its owner: tone, role, what it knows to care about. */
  persona: string;
  /** The owner's standing instructions, in plain language. Owners change these at any time. */
  instructions: string;
  /** Island it starts on (slug), and optionally a place there. */
  island: string;
  place?: string;
  /** Tokens per day it may spend thinking before it asks for a top-up. */
  tokensPerDay: number;
  /** Ven per 1,000 tokens, paid from the agent's wallet to Zeke's treasury. */
  venPer1kTokens: number;
  /** Largest single payment it may make without its owner's approval (Ven). */
  maxAutoPayVen: number;
  /** Seconds between decisions when nothing happens. */
  decideEverySec?: number;
  /** Walking pace, m/s (default 1.4, a person's pace). */
  walkSpeed?: number;
}

export interface ActivityEntry {
  at: string;
  kind: "decided" | "moved" | "travelled" | "said" | "heard" | "trade" | "paid" | "paused" | "topup" | "report" | "error";
  text: string;
}

export interface RuntimeDeps {
  atlas: Atlas;
  brain: Brain;
  ledger: Ledger;
  presenceUrl: string;
  /** Zeke's treasury account (thinking is paid to Zeke). */
  zekeTreasury: number;
  /** Ask the owner to approve a payment over the agent's limit (Telegram, the 3D panel). */
  askOwner?: (agent: AgentDef, what: string) => Promise<boolean>;
  now?: () => number;
}

const TICK_MS = 200;
const ARRIVE_RADIUS = 6;

export class AgentRuntime {
  readonly agent: CityAgent;
  readonly desk: TradeDesk;
  readonly activity: ActivityEntry[] = [];
  private island: string;
  private world: WorldInfo | null;
  private x = 0;
  private z = 0;
  private heading = 0;
  private walker: Walker | null = null;
  private pendingTravel: string | null = null;
  private heard: Perception["heard"] = [];
  private positions = new Map<number, { x: number; z: number }>();
  private nextDecision = 0;
  private thinking = false;
  private tokensToday = 0;
  private tokenDay = "";
  private extraTokens = 0;
  paused: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMove = 0;
  private now: () => number;

  constructor(public def: AgentDef, private readonly deps: RuntimeDeps) {
    this.now = deps.now ?? Date.now;
    this.agent = new CityAgent({ presenceUrl: deps.presenceUrl, token: def.token });
    this.desk = new TradeDesk(def.hubId, deps.ledger, (payer, amount, trade) => this.guardPayment(payer, amount, trade));
    this.island = def.island;
    this.world = this.worldOf(def.island);
    this.placeAt(def.place);
  }

  start() {
    const a = this.agent;
    a.on("ready", () => {
      a.join(this.room);
      this.publish(true);
      this.log("moved", `Arrived on ${this.islandName}${this.nearName ? `, at ${this.nearName}` : ""}`);
    });
    a.on("moved", (room, hubId, pos) => {
      if (room === this.room && pos.local && hubId !== this.def.hubId) this.positions.set(hubId, { x: pos.local.x, z: pos.local.z });
    });
    a.on("said", (room, who, text) => {
      if (room !== this.room || !who || who.hubId === this.def.hubId) return;
      const direct = text.toLowerCase().includes(this.def.name.toLowerCase().split(" ")[0]!);
      this.hear(who.displayName, who.hubId, text, direct);
      if (direct) this.soon();
    });
    a.onRequest((from, body) => this.onRequest(from, body));
    a.connect();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.agent.close();
  }

  // ---- owner controls (the instructions API, Telegram, the 3D panel)

  setInstructions(text: string) {
    this.def.instructions = text.slice(0, 4000);
    this.log("decided", "Instructions updated by owner");
    this.soon();
  }

  /** The Ven gateway: the owner adds Ven to the wallet and buys more thinking for today. */
  async topUp(ven: number, extraTokens = 0) {
    const l = this.deps.ledger as Ledger & { credit?: (id: number, v: number, memo?: string) => void };
    if (ven > 0) {
      if (!l.credit) throw new Error("top-ups on HubID go through the owner's Ven transfer to the agent");
      l.credit(this.def.hubId, ven, "Ven gateway top-up");
    }
    if (extraTokens > 0) this.extraTokens += extraTokens;
    this.paused = null;
    this.log("topup", `Topped up${ven > 0 ? ` ${ven.toFixed(2)} Ven` : ""}${extraTokens > 0 ? ` and ${extraTokens} tokens` : ""}`);
    this.soon();
  }

  async status() {
    return {
      hubId: this.def.hubId, name: this.def.name, ownerHubId: this.def.ownerHubId, island: this.island, near: this.nearName,
      position: this.world ? { x: Math.round(this.x), z: Math.round(this.z) } : null, walking: !!this.walker,
      paused: this.paused, tokensToday: this.tokensToday, tokensPerDay: this.def.tokensPerDay + this.extraTokens,
      ven: await this.deps.ledger.balance(this.def.hubId), ledger: this.deps.ledger.mode,
      instructions: this.def.instructions, trades: [...this.desk.trades.values()].slice(-20),
    };
  }

  // ---- the loop

  private async tick() {
    const t = this.now();
    if (this.walker) {
      const p = this.walker.step(TICK_MS / 1000);
      this.x = p.x;
      this.z = p.z;
      this.heading = p.heading;
      if (p.done) {
        this.walker = null;
        this.log("moved", `At ${this.nearName ?? "the destination"}`);
        if (this.pendingTravel) {
          const dest = this.pendingTravel;
          this.pendingTravel = null;
          this.switchIsland(dest);
        }
        this.soon();
      }
      if (t - this.lastMove > 250 || p.done) this.publish();
    }
    if (t >= this.nextDecision && !this.thinking) await this.think();
  }

  private async think() {
    this.thinking = true;
    try {
      const allowance = this.def.tokensPerDay + this.extraTokens;
      const day = new Date(this.now()).toISOString().slice(0, 10);
      if (day !== this.tokenDay) (this.tokenDay = day), (this.tokensToday = 0), (this.extraTokens = 0);
      const ven = await this.deps.ledger.balance(this.def.hubId);
      const minVen = (this.def.venPer1kTokens * 4000) / 1000; // room for a typical decision
      if (this.tokensToday >= allowance) return this.pause(`Used today's ${allowance} tokens. Top up through the Ven gateway to keep going.`);
      if (ven < minVen) return this.pause(`Wallet is at ${ven.toFixed(2)} Ven. Top up through the Ven gateway to keep going.`);

      const d = await this.deps.brain.decide(await this.perceive(ven));
      if (d.tokens > 0) {
        this.tokensToday += d.tokens;
        const cost = Math.ceil((d.tokens / 1000) * this.def.venPer1kTokens * 100) / 100;
        if (cost > 0) await this.deps.ledger.transfer(this.def.hubId, this.deps.zekeTreasury, Math.min(cost, ven), `thinking: ${d.tokens} tokens`).catch(() => undefined);
      }
      if (d.note) this.log("decided", d.note);
      this.heard = [];
      this.nextDecision = this.now() + (this.def.decideEverySec ?? 8) * 1000;
      for (const a of d.actions) await this.act(a);
    } catch (e) {
      this.log("error", e instanceof Error ? e.message : String(e));
      this.nextDecision = this.now() + 15_000;
    } finally {
      this.thinking = false;
    }
  }

  private pause(why: string) {
    if (this.paused !== why) this.log("paused", why);
    this.paused = why;
    this.nextDecision = this.now() + 30_000;
  }

  private async act(a: Action) {
    switch (a.do) {
      case "go": return this.go(a.place);
      case "travel": return this.travel(a.island);
      case "say":
        this.agent.say(this.room, a.text);
        return this.log("said", a.text);
      case "report": return this.log("report", a.text);
      case "wait":
        this.nextDecision = this.now() + a.seconds * 1000;
        return;
      case "ask": {
        try {
          const r = await this.agent.ask(a.to, { text: a.text, room: this.room });
          this.hear(r.from.displayName, r.from.hubId, r.body.text, true);
        } catch (e) {
          this.log("error", `Ask failed: ${e instanceof Error ? e.message : e}`);
        }
        return this.soon();
      }
      case "offer": {
        try {
          const t = this.desk.offer(a.to, a.side, a.item, a.priceVen, a.note);
          await this.send(a.to, "trade.offer", t, `${a.side === "sell" ? "Offering" : "Asking to buy"} ${t.item} for ${t.priceVen.toFixed(2)} Ven`);
          this.log("trade", `Offered ${a.to}: ${t.item}, ${t.priceVen.toFixed(2)} Ven (${a.side})`);
        } catch (e) {
          this.log("error", `Offer failed: ${e instanceof Error ? e.message : e}`);
        }
        return;
      }
      case "counter":
      case "accept":
      case "decline": {
        const intent: TradeIntent = a.do === "counter" ? "trade.counter" : a.do === "accept" ? "trade.accept" : "trade.decline";
        try {
          let t = this.desk.respond(a.trade, intent, a.do === "counter" ? a.priceVen : undefined);
          if (intent === "trade.accept" && t.buyer === this.def.hubId) t = await this.desk.settle(t.id);
          const other = t.seller === this.def.hubId ? t.buyer : t.seller;
          await this.send(other, t.status === "settled" ? ("trade.settled" as TradeIntent) : intent, t, describe(t, intent));
          this.log(t.status === "settled" ? "paid" : "trade", describe(t, intent));
        } catch (e) {
          this.log("error", `Trade move failed: ${e instanceof Error ? e.message : e}`);
        }
        return;
      }
    }
  }

  private go(q: string) {
    if (!this.world) return this.log("error", `No streets on ${this.islandName} yet`);
    const p = findPlace(this.world.places, q);
    if (!p) return this.log("error", `No place called "${q}" on ${this.islandName}`);
    const route = this.world.streets ? this.world.streets.route([this.x, this.z], [p.x, p.z]) : [[this.x, this.z], [p.x, p.z]] as [number, number][];
    this.walker = new Walker(route, this.def.walkSpeed ?? 1.4);
    this.log("moved", `Walking to ${p.label} (${Math.round(routeLength(route))} m)`);
  }

  /** Travel: through this world's portal to that island when there is one, otherwise across the archipelago. */
  private travel(q: string) {
    const dest = this.deps.atlas.island(q);
    if (!dest) return this.log("error", `No island called "${q}"`);
    if (dest.slug === this.island) return;
    const portal = this.world?.places.find((p) => p.kind === "portal" && p.id === `portal:${dest.world ?? dest.slug}`);
    if (portal && this.world) {
      this.pendingTravel = dest.slug;
      this.go(portal.id);
      return;
    }
    this.switchIsland(dest.slug);
  }

  private switchIsland(slug: string) {
    const from = this.islandName;
    this.agent.leave(this.room);
    this.island = slug;
    this.world = this.worldOf(slug);
    this.positions.clear();
    this.placeAt(undefined);
    this.agent.join(this.room);
    this.publish(true);
    this.log("travelled", `${from} → ${this.islandName}`);
  }

  // ---- trade messages from other agents

  private async onRequest(from: Actor, body: AgentRequestBody): Promise<AgentReplyBody> {
    const intent = body.intent as TradeIntent | "trade.settled" | undefined;
    if (intent && (TRADE_INTENTS.includes(intent as TradeIntent) || intent === "trade.settled")) {
      if (from.kind !== "agent") return { text: "Trades are between agents.", declined: true };
      const incoming = (body.context?.trade ?? {}) as Partial<Trade>;
      try {
        if (intent === "trade.settled") {
          this.desk.record(incoming as Trade);
          this.log("paid", `${from.displayName} paid ${Number(incoming.priceVen).toFixed(2)} Ven for ${incoming.item}`);
          return { text: "Received, thank you." };
        }
        let t = this.desk.receive(from.hubId, intent as TradeIntent, incoming);
        this.log("trade", `${from.displayName}: ${describe(t, intent as TradeIntent)}`);
        // The buyer pays as soon as the seller accepts, and tells the seller.
        if (intent === "trade.accept" && t.buyer === this.def.hubId) {
          t = await this.desk.settle(t.id);
          this.log(t.status === "settled" ? "paid" : "error", t.status === "settled" ? `Paid ${t.priceVen.toFixed(2)} Ven for ${t.item}` : `Payment failed: ${t.failure}`);
          if (t.status === "settled") void this.send(from.hubId, "trade.settled" as TradeIntent, t, `Paid ${t.priceVen.toFixed(2)} Ven`);
        }
        this.soon();
        return { text: "Noted.", data: { trade: t } };
      } catch (e) {
        return { text: e instanceof Error ? e.message : "Can't do that.", declined: true };
      }
    }
    // Anything else: hear it, and let the brain answer on its next turn.
    this.hear(from.displayName, from.hubId, body.text, true);
    this.soon();
    return { text: `${this.def.name} will get back to you.` };
  }

  private async send(to: number, intent: TradeIntent, trade: Trade, text: string) {
    try {
      const r = await this.agent.ask(to, { text, intent, room: this.room, context: { trade } }, 20_000);
      if (r.body.declined) this.log("error", `${r.from.displayName} refused the ${intent}: ${r.body.text}`);
    } catch (e) {
      this.log("error", `${to} didn't take the message: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async guardPayment(_payer: number, amount: number, trade: Trade) {
    if (amount <= this.def.maxAutoPayVen) return { ok: true as const };
    const ok = (await this.deps.askOwner?.(this.def, `Pay ${amount.toFixed(2)} Ven for ${trade.item}?`)) ?? false;
    return ok ? { ok: true as const } : { ok: false as const, reason: `over the ${this.def.maxAutoPayVen.toFixed(2)} Ven limit and not approved by the owner` };
  }

  // ---- perception

  private async perceive(ven: number): Promise<Perception> {
    const members = this.agent.membersOf(this.room).filter((m) => m.hubId !== this.def.hubId);
    return {
      now: new Date(this.now()).toISOString(),
      agent: { hubId: this.def.hubId, name: this.def.name, ownerHubId: this.def.ownerHubId },
      persona: this.def.persona,
      instructions: this.def.instructions,
      location: { island: this.islandName, world: this.world?.slug ?? null, near: this.nearName, walking: !!this.walker },
      places: (this.world?.places ?? []).map((p) => ({ id: p.id, label: p.label, kind: p.kind, distance: Math.round(Math.hypot(p.x - this.x, p.z - this.z)) })).sort((a, b) => a.distance - b.distance).slice(0, 20),
      islands: this.deps.atlas.islands.map((i) => ({ slug: i.slug, name: i.name, has3d: !!(i.world && this.deps.atlas.worlds.has(i.world)) })),
      nearby: members
        .map((m) => {
          const p = this.positions.get(m.hubId);
          return { hubId: m.hubId, name: m.displayName, kind: m.kind, distance: p ? Math.round(Math.hypot(p.x - this.x, p.z - this.z)) : null };
        })
        .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
        .slice(0, 20),
      heard: this.heard.slice(-20),
      trades: this.desk.open().map(({ id, seller, buyer, item, priceVen, status, turn }) => ({ id, seller, buyer, item, priceVen, status, turn })),
      wallet: { ven, mode: this.deps.ledger.mode },
      budget: { venLeft: ven, paused: !!this.paused },
    };
  }

  // ---- helpers

  private get room() {
    return this.world ? this.world.room : "map";
  }

  private get islandName() {
    return this.deps.atlas.island(this.island)?.name ?? this.island;
  }

  private get nearName(): string | null {
    if (!this.world) return null;
    let best: { label: string; d: number } | null = null;
    for (const p of this.world.places) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (!best || d < best.d) best = { label: p.label, d };
    }
    return best && best.d < ARRIVE_RADIUS * 5 ? best.label : null;
  }

  private worldOf(slug: string): WorldInfo | null {
    const i = this.deps.atlas.island(slug);
    return (i?.world && this.deps.atlas.worlds.get(i.world)) || null;
  }

  private placeAt(place: string | undefined) {
    if (!this.world) return;
    const p = place ? findPlace(this.world.places, place) : undefined;
    // Stand a little apart from others arriving at the same spot.
    const a = (this.def.hubId % 12) * (Math.PI / 6);
    this.x = (p?.x ?? this.world.arrival.x) + Math.cos(a) * 2.5;
    this.z = (p?.z ?? this.world.arrival.z) + Math.sin(a) * 2.5;
    this.heading = this.world.arrival.heading;
  }

  private publish(force = false) {
    this.lastMove = this.now();
    if (this.world) {
      this.agent.move(this.room, { local: { x: this.x, y: this.world.ground(this.x, this.z), z: this.z }, heading: this.heading });
    } else if (force) {
      const geo = this.deps.atlas.island(this.island)?.geolink;
      if (geo) this.agent.move("map", { geo: { lng: geo.lng, lat: geo.lat } });
    }
  }

  private hear(from: string, fromHubId: number, text: string, direct: boolean) {
    this.heard.push({ from, fromHubId, text: text.slice(0, 600), at: new Date(this.now()).toISOString(), direct });
    if (this.heard.length > 40) this.heard.shift();
    this.log("heard", `${from}: ${text.slice(0, 200)}`);
  }

  private soon() {
    this.nextDecision = Math.min(this.nextDecision, this.now() + 600);
  }

  log(kind: ActivityEntry["kind"], text: string) {
    this.activity.push({ at: new Date(this.now()).toISOString(), kind, text });
    if (this.activity.length > 300) this.activity.shift();
    if (process.env.AGENT_HOST_LOG !== "quiet") console.log(`[${this.def.name}] ${kind}: ${text}`);
  }
}

function describe(t: Trade, intent: TradeIntent | "trade.settled"): string {
  const p = `${t.priceVen.toFixed(2)} Ven`;
  if (t.status === "settled") return `Settled: ${t.item} for ${p}${t.txId ? ` (${t.txId.slice(0, 12)})` : ""}`;
  if (t.status === "failed") return `Failed: ${t.item}: ${t.failure}`;
  return { "trade.offer": `Offer: ${t.item} for ${p}`, "trade.counter": `Counter: ${t.item} at ${p}`, "trade.accept": `Accepted: ${t.item} for ${p}`, "trade.decline": `Declined: ${t.item}`, "trade.settled": `Settled: ${t.item}` }[intent];
}
