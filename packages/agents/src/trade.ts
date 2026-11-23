/**
 * Agent-to-agent trade in Ven: offer, counter, accept or decline, then settle.
 *
 * The messages ride on presence requests (`agent.ask(to, { intent: "trade.offer", context: { trade } })`),
 * so the sender is always the verified HubID agent. Settlement goes through a Ledger: the sandbox
 * ledger for the beta, HubID transactions once agents hold the ven:send scope. Every payment passes
 * the paying agent's guard first (its owner's limits and approval policy).
 */
import { randomUUID } from "node:crypto";

export type TradeIntent = "trade.offer" | "trade.counter" | "trade.accept" | "trade.decline";
export const TRADE_INTENTS: readonly TradeIntent[] = ["trade.offer", "trade.counter", "trade.accept", "trade.decline"];

export type TradeStatus = "open" | "countered" | "accepted" | "declined" | "settled" | "failed" | "expired";

export interface Trade {
  id: string;
  /** Agent HubIDs. The seller provides the item; the buyer pays priceVen. */
  seller: number;
  buyer: number;
  item: string;
  priceVen: number;
  status: TradeStatus;
  /** Who acts next (the other side of the last move). */
  turn: number;
  history: { by: number; intent: TradeIntent | "settle"; priceVen: number; at: number; note?: string }[];
  createdAt: number;
  expiresAt: number;
  txId?: string;
  failure?: string;
}

export interface Ledger {
  readonly mode: "sandbox" | "hubid";
  balance(hubId: number): Promise<number>;
  transfer(from: number, to: number, amountVen: number, memo: string): Promise<{ txId: string }>;
}

/** Ven amounts: positive, at most two decimals. */
export function validVen(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && Math.round(n * 100) === Math.round(n * 100 * 1e6) / 1e6;
}

/** An in-memory Ven ledger for the beta: same calls and checks as the real one, no real money. */
export class SandboxLedger implements Ledger {
  readonly mode = "sandbox" as const;
  private readonly balances = new Map<number, number>();
  readonly transactions: { txId: string; from: number; to: number; amountVen: number; memo: string; at: number }[] = [];

  constructor(opening: Record<number, number> = {}, private readonly onChange?: () => void) {
    for (const [id, v] of Object.entries(opening)) this.balances.set(Number(id), v);
  }

  async balance(hubId: number) {
    return this.balances.get(hubId) ?? 0;
  }

  /** Credit Ven from outside (the owner's top-up through the Ven gateway). */
  credit(hubId: number, amountVen: number, memo = "top-up") {
    if (!validVen(amountVen)) throw new Error("bad amount");
    this.balances.set(hubId, round2((this.balances.get(hubId) ?? 0) + amountVen));
    this.transactions.push({ txId: `sbx_${randomUUID()}`, from: 0, to: hubId, amountVen, memo, at: Date.now() });
    this.onChange?.();
  }

  async transfer(from: number, to: number, amountVen: number, memo: string) {
    if (!validVen(amountVen)) throw new Error("bad amount");
    if (from === to) throw new Error("same account");
    const have = this.balances.get(from) ?? 0;
    if (have < amountVen) throw new Error("insufficient funds");
    this.balances.set(from, round2(have - amountVen));
    this.balances.set(to, round2((this.balances.get(to) ?? 0) + amountVen));
    const txId = `sbx_${randomUUID()}`;
    this.transactions.push({ txId, from, to, amountVen, memo, at: Date.now() });
    this.onChange?.();
    return { txId };
  }

  snapshot() {
    return { balances: Object.fromEntries(this.balances), transactions: this.transactions.slice(-200) };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Before a payment: may this agent pay this much now? (owner limits, approvals, economy policy) */
export type PaymentGuard = (payer: number, amountVen: number, trade: Trade) => Promise<{ ok: true } | { ok: false; reason: string }>;

/**
 * One agent's view of its trades. Both sides keep their own desk; the messages keep them in step,
 * and only the buyer's desk moves money (on accept), so a payment happens once.
 */
export class TradeDesk {
  readonly trades = new Map<string, Trade>();

  constructor(
    private readonly me: number,
    private readonly ledger: Ledger,
    private readonly guard: PaymentGuard = async () => ({ ok: true }),
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Start a trade. `side` is my role: "sell" (I provide the item) or "buy" (I pay). */
  offer(counterparty: number, side: "sell" | "buy", item: string, priceVen: number, note?: string): Trade {
    if (!validVen(priceVen)) throw new Error("price must be a positive Ven amount with at most two decimals");
    if (counterparty === this.me) throw new Error("can't trade with yourself");
    const t = this.now();
    const trade: Trade = {
      id: randomUUID(),
      seller: side === "sell" ? this.me : counterparty,
      buyer: side === "buy" ? this.me : counterparty,
      item: item.slice(0, 200),
      priceVen,
      status: "open",
      turn: counterparty,
      history: [{ by: this.me, intent: "trade.offer", priceVen, at: t, note }],
      createdAt: t,
      expiresAt: t + this.ttlMs,
    };
    this.trades.set(trade.id, trade);
    return trade;
  }

  /** A trade message from another agent (already verified as `from` by presence). */
  receive(from: number, intent: TradeIntent, incoming: Partial<Trade>): Trade {
    this.expire();
    if (intent === "trade.offer") {
      if (!incoming.id || !validVen(incoming.priceVen) || typeof incoming.item !== "string") throw new Error("bad offer");
      if (![incoming.seller, incoming.buyer].includes(from) || ![incoming.seller, incoming.buyer].includes(this.me) || incoming.seller === incoming.buyer)
        throw new Error("offer doesn't involve us both");
      const t = this.now();
      const trade: Trade = {
        id: incoming.id, seller: incoming.seller!, buyer: incoming.buyer!, item: incoming.item.slice(0, 200), priceVen: incoming.priceVen,
        status: "open", turn: this.me, history: [{ by: from, intent, priceVen: incoming.priceVen, at: t }], createdAt: t, expiresAt: t + this.ttlMs,
      };
      this.trades.set(trade.id, trade);
      return trade;
    }
    const trade = this.trades.get(incoming.id ?? "");
    if (!trade) throw new Error("unknown trade");
    // The last move was ours, so it's their turn: `turn` names whoever acts next.
    if (trade.turn !== from || ![trade.seller, trade.buyer].includes(from)) throw new Error("not their move");
    if (!["open", "countered"].includes(trade.status)) throw new Error(`trade is ${trade.status}`);
    if (intent === "trade.counter") {
      if (!validVen(incoming.priceVen)) throw new Error("bad price");
      trade.priceVen = incoming.priceVen;
      trade.status = "countered";
    } else if (intent === "trade.accept") {
      trade.status = "accepted";
    } else {
      trade.status = "declined";
    }
    trade.turn = this.me;
    trade.history.push({ by: from, intent, priceVen: trade.priceVen, at: this.now() });
    return trade;
  }

  /** My move on a trade where it's my turn. Returns the message to send. */
  respond(id: string, intent: "trade.counter" | "trade.accept" | "trade.decline", priceVen?: number): Trade {
    this.expire();
    const trade = this.trades.get(id);
    if (!trade) throw new Error("unknown trade");
    if (trade.turn !== this.me) throw new Error("not my move");
    if (!["open", "countered"].includes(trade.status)) throw new Error(`trade is ${trade.status}`);
    const other = trade.seller === this.me ? trade.buyer : trade.seller;
    if (intent === "trade.counter") {
      if (!validVen(priceVen)) throw new Error("bad price");
      trade.priceVen = priceVen;
      trade.status = "countered";
    } else trade.status = intent === "trade.accept" ? "accepted" : "declined";
    trade.turn = other;
    trade.history.push({ by: this.me, intent, priceVen: trade.priceVen, at: this.now() });
    return trade;
  }

  /** Pay for an accepted trade (buyer's desk only). Settles once; failures are recorded, not thrown. */
  async settle(id: string): Promise<Trade> {
    const trade = this.trades.get(id);
    if (!trade) throw new Error("unknown trade");
    if (trade.status === "settled") return trade;
    if (trade.status !== "accepted") throw new Error(`trade is ${trade.status}`);
    if (trade.buyer !== this.me) throw new Error("only the buyer pays");
    const allowed = await this.guard(this.me, trade.priceVen, trade);
    if (!allowed.ok) {
      trade.status = "failed";
      trade.failure = allowed.reason;
      return trade;
    }
    try {
      const { txId } = await this.ledger.transfer(trade.buyer, trade.seller, trade.priceVen, `trade ${trade.id}: ${trade.item}`);
      trade.status = "settled";
      trade.txId = txId;
      trade.history.push({ by: this.me, intent: "settle", priceVen: trade.priceVen, at: this.now() });
    } catch (e) {
      trade.status = "failed";
      trade.failure = e instanceof Error ? e.message : String(e);
    }
    return trade;
  }

  /** Mirror the other side's final state (e.g. the seller learning it was paid). */
  record(t: Trade) {
    const mine = this.trades.get(t.id);
    if (mine && [t.seller, t.buyer].includes(this.me)) Object.assign(mine, { status: t.status, txId: t.txId, failure: t.failure, priceVen: t.priceVen });
  }

  open(): Trade[] {
    this.expire();
    return [...this.trades.values()].filter((t) => ["open", "countered", "accepted"].includes(t.status));
  }

  private expire() {
    const t = this.now();
    for (const tr of this.trades.values()) if (["open", "countered"].includes(tr.status) && tr.expiresAt < t) tr.status = "expired";
  }
}
