import type { TerritoryIndex } from "./territories";
import { isUltraTicker } from "./territories";

/**
 * The agent loop across the archipelago, Gaia and DIRT.
 *
 * An agent is a HubID bot sub-profile with a human owner (docs/AGENTS.md). It can be reached on
 * several channels, and all of them resolve to that one HubID:
 *   telegram       like Zeke's bot (zeke-ai-server src/channels/telegram.py): a Telegram account is
 *                  linked to a HubID with an emailed code; unlinked chats get public answers only
 *   hub-messages   Hub Culture messages, signed in
 *   metaverse      present in an island (presence server), walking, talking, using properties
 *   agent          agent-to-agent requests (packages/agents CityAgent)
 *   web            fetching public data from the web
 *
 * What it does, as typed actions, each checked against the owner's mandate before it happens and
 * recorded after:
 *   converse     talk with its owner or anyone else, on any channel
 *   world        act in an island: visit, open a property, host, broker a listing
 *   negotiate    agree terms with another agent (a price, a service, a split)
 *   service      do paid work and earn Ven (paid by a member, a property or another agent)
 *   contribute   add data to a Gaia layer (QEM, a property's layer, a city's), at H3 cells; once
 *                Gaia accepts it, it earns DIRT from the territory those cells lie in
 *   trade        buy or sell on Ultra: Ven, a DIRT market (`ud<SYMBOL>`), bonds
 */
export type Channel = "telegram" | "hub-messages" | "metaverse" | "agent" | "web";

export type Scope =
  | "converse"
  | "world:act"
  | "property:broker"
  | "agent:negotiate"
  | "ven:earn"
  | "ven:send"
  | "gaia:contribute"
  | "ultra:trade";

export type AgentAction =
  | { kind: "converse"; channel: Channel; with: string; text: string }
  | { kind: "world"; island: string; act: "visit" | "open-property" | "host" | "broker"; ref?: string }
  | { kind: "negotiate"; withAgentHubId: number; terms: string; venValue?: number }
  | { kind: "service"; forHubId: number; what: string; venEarned: number }
  | { kind: "contribute"; layer: string; cells: string[]; source: string; records: number }
  | { kind: "trade"; side: "buy" | "sell"; ticker: string; ven: number }
  /** Moving value out of Ultra (to a Solana wallet, a bank, anywhere). Off while the economy is a closed loop. */
  | { kind: "withdraw"; asset: string; to: string; amount: number };

/**
 * The agent economy's platform-wide setting, set by Hub Culture (not by owners or agents).
 *
 * closedLoop (on for now, 20 November 2026): agents hold Ven, DIRT and bonds in Ultra custodial
 * wallets, trade on Ultra and don't move value out. It's a policy we observe while the flows between
 * worlds, Gaia, DIRT and Ultra prove themselves, not a permanent rule: switch it off and agents may
 * withdraw, within their mandate's limits and always with their owner's approval. People can always
 * withdraw from their own Ultra wallets.
 */
export interface EconomyPolicy {
  closedLoop: boolean;
}

export const DEFAULT_ECONOMY: EconomyPolicy = { closedLoop: true };

/** What the owner lets the agent do. Nothing outside it ever happens. */
export interface Mandate {
  agentHubId: number;
  ownerHubId: number;
  scopes: Scope[];
  channels: Channel[];
  /** Ven the agent may spend (trades bought, Ven sent) per UTC day. */
  venPerDay: number;
  /** Largest single trade or payment. */
  venPerTrade: number;
  /** Above this, the owner approves first (in Hub messages or Telegram). */
  approveAbove: number;
  /** Ultra markets it may trade; empty = none. `ud*` = every DIRT market. */
  markets: string[];
  /** Islands it may act in; empty = any. */
  islands?: string[];
}

export interface DayLedger {
  venSpent: number;
}

export interface Decision {
  allowed: boolean;
  /** Allowed only once the owner says yes. */
  needsOwnerApproval: boolean;
  reason: string;
}

const NEEDS: Record<AgentAction["kind"], Scope> = {
  converse: "converse",
  world: "world:act",
  negotiate: "agent:negotiate",
  service: "ven:earn",
  contribute: "gaia:contribute",
  trade: "ultra:trade",
  withdraw: "ven:send",
};

const deny = (reason: string): Decision => ({ allowed: false, needsOwnerApproval: false, reason });
const ok = (reason = "Within the mandate."): Decision => ({ allowed: true, needsOwnerApproval: false, reason });

/** Check an action against the mandate and what's been spent today. */
export function authorize(m: Mandate, a: AgentAction, today: DayLedger, economy: EconomyPolicy = DEFAULT_ECONOMY): Decision {
  if (a.kind === "withdraw" && economy.closedLoop) return deny("The agent economy is a closed loop for now: agents keep their holdings in Ultra.");
  const scope = a.kind === "world" && a.act === "broker" ? "property:broker" : NEEDS[a.kind];
  if (!m.scopes.includes(scope)) return deny(`The owner hasn't granted "${scope}".`);
  if (a.kind === "converse" && !m.channels.includes(a.channel)) return deny(`The agent isn't allowed on ${a.channel}.`);
  if (a.kind === "world" && m.islands?.length && !m.islands.includes(a.island)) return deny(`The agent may not act in ${a.island}.`);
  if (a.kind === "contribute") {
    if (!a.cells.length) return deny("A contribution must say which Gaia cells it covers.");
    if (!/^https?:\/\//.test(a.source)) return deny("A contribution must cite where its data comes from (Gaia requires attribution).");
    return ok();
  }
  if (a.kind === "withdraw") {
    if (!(a.amount > 0)) return deny("Amount must be positive.");
    if (a.amount > m.venPerTrade) return deny(`${a.amount} is over the ${m.venPerTrade} limit per transfer.`);
    if (today.venSpent + a.amount > m.venPerDay) return deny(`That would pass today's ${m.venPerDay} limit (${today.venSpent} spent).`);
    return { allowed: true, needsOwnerApproval: true, reason: "Moving value out of Ultra: the owner approves every withdrawal." };
  }
  if (a.kind === "trade" || (a.kind === "negotiate" && a.venValue)) {
    const ven = a.kind === "trade" ? a.ven : a.venValue!;
    if (!(ven > 0)) return deny("Amount must be positive.");
    if (a.kind === "trade") {
      if (!isUltraTicker(a.ticker) && a.ticker !== "VEN") return deny(`${a.ticker} isn't an Ultra market.`);
      const allowedMarket = m.markets.includes(a.ticker) || (a.ticker.startsWith("ud") && m.markets.includes("ud*"));
      if (!allowedMarket) return deny(`The owner hasn't allowed trading ${a.ticker}.`);
    }
    if (ven > m.venPerTrade) return deny(`${ven} Ven is over the ${m.venPerTrade} Ven limit per trade.`);
    const spends = a.kind === "trade" ? a.side === "buy" : true;
    if (spends && today.venSpent + ven > m.venPerDay) return deny(`That would pass today's ${m.venPerDay} Ven limit (${today.venSpent} spent).`);
    if (ven > m.approveAbove) return { allowed: true, needsOwnerApproval: true, reason: `Over ${m.approveAbove} Ven: ask the owner first.` };
  }
  return ok();
}

// ---------------------------------------------------------------------------------------------
// Earning DIRT for data contributed where it matters.

/**
 * How accepted Gaia contributions earn DIRT. Rewards come from the territory's 25% Gaia bucket
 * (the DIRT split: "25% Gaia parcels"), so they only exist for live territories, and only after
 * Gaia accepts the layer (member layers start private and a Gaia admin publishes them).
 */
export interface RewardPolicy {
  /** DIRT per newly covered parcel cell (resolution 9 equivalent). */
  dirtPerCell: number;
  /** Most DIRT one contribution can earn in one territory. */
  capPerContribution: number;
  /** Only these statuses pay. */
  payableStatuses: string[];
}

export const DEFAULT_REWARDS: RewardPolicy = { dirtPerCell: 25, capPerContribution: 25_000, payableStatuses: ["live"] };

export interface TerritoryReward {
  symbol: string;
  cells: number;
  dirt: number;
  /** Why it pays nothing, when it doesn't. */
  note?: string;
}

/**
 * Split an accepted contribution's cells by the DIRT territory each lies in, and price each share.
 * Cells outside every territory earn nothing in DIRT (they still count as Gaia work, which can pay Ven).
 */
export function dirtRewards(cells: string[], territories: TerritoryIndex, policy: RewardPolicy = DEFAULT_REWARDS): TerritoryReward[] {
  const counts = new Map<string, number>();
  for (const c of new Set(cells)) {
    const t = territories.at(c);
    if (t) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
  }
  return [...counts.entries()].map(([symbol, n]) => {
    const t = territories.bySymbol(symbol)!;
    if (!policy.payableStatuses.includes(t.status)) return { symbol, cells: n, dirt: 0, note: `${t.name} DIRT isn't live yet; the work is recorded and pays once it is.` };
    return { symbol, cells: n, dirt: Math.min(policy.capPerContribution, n * policy.dirtPerCell) };
  });
}

// ---------------------------------------------------------------------------------------------
// The record of what agents did, for owners (and for the agent's own memory).

export interface AgentEvent {
  at: string;
  agentHubId: number;
  action: AgentAction;
  decision: Decision;
  /** Filled in for completed actions. */
  earnedVen?: number;
  earnedDirt?: { symbol: string; dirt: number }[];
  spentVen?: number;
}

export interface AgentSummary {
  actions: number;
  refused: number;
  awaitingOwner: number;
  venEarned: number;
  venSpent: number;
  dirt: Record<string, number>;
  channels: Channel[];
  islands: string[];
}

export function summarize(events: AgentEvent[]): AgentSummary {
  const s: AgentSummary = { actions: 0, refused: 0, awaitingOwner: 0, venEarned: 0, venSpent: 0, dirt: {}, channels: [], islands: [] };
  const ch = new Set<Channel>();
  const is = new Set<string>();
  for (const e of events) {
    s.actions++;
    if (!e.decision.allowed) s.refused++;
    else if (e.decision.needsOwnerApproval) s.awaitingOwner++;
    s.venEarned += e.earnedVen ?? 0;
    s.venSpent += e.spentVen ?? 0;
    for (const d of e.earnedDirt ?? []) s.dirt[d.symbol] = (s.dirt[d.symbol] ?? 0) + d.dirt;
    if (e.action.kind === "converse") ch.add(e.action.channel);
    if (e.action.kind === "world") is.add(e.action.island);
  }
  s.channels = [...ch];
  s.islands = [...is];
  return s;
}
