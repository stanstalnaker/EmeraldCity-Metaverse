import { describe, expect, it } from "vitest";
import { SandboxLedger, TradeDesk, validVen } from "./trade";

const pair = (benVen: number, guard?: ConstructorParameters<typeof TradeDesk>[2], now?: () => number) => {
  const ledger = new SandboxLedger({ 1: 20, 2: benVen });
  return { ledger, ana: new TradeDesk(1, ledger, undefined, 60_000, now), ben: new TradeDesk(2, ledger, guard, 60_000, now) };
};

describe("agent trade in Ven", () => {
  it("offer, counter, accept: the buyer pays once and both desks agree", async () => {
    const { ledger, ana, ben } = pair(30);
    const offer = ben.offer(1, "buy", "Guided tour of the ICON", 8);
    ana.receive(2, "trade.offer", offer);
    ben.receive(1, "trade.counter", ana.respond(offer.id, "trade.counter", 9));
    const accepted = ben.respond(offer.id, "trade.accept");
    expect(accepted.priceVen).toBe(9);
    ana.receive(2, "trade.accept", accepted);
    const settled = await ben.settle(offer.id);
    expect(settled.status).toBe("settled");
    expect((await ben.settle(offer.id)).txId).toBe(settled.txId); // paying twice is a no-op
    ana.record(settled);
    expect(ana.trades.get(offer.id)?.status).toBe("settled");
    expect(await ledger.balance(1)).toBe(29);
    expect(await ledger.balance(2)).toBe(21);
  });

  it("records a failed payment instead of throwing (insufficient funds, owner said no)", async () => {
    const poor = pair(5);
    const t = poor.ben.offer(1, "buy", "Tour", 9);
    poor.ana.receive(2, "trade.offer", t);
    poor.ben.receive(1, "trade.accept", poor.ana.respond(t.id, "trade.accept"));
    expect((await poor.ben.settle(t.id)).failure).toBe("insufficient funds");

    const refused = pair(50, async () => ({ ok: false, reason: "over the limit and not approved by the owner" }));
    const u = refused.ben.offer(1, "buy", "Tour", 30);
    refused.ana.receive(2, "trade.offer", u);
    refused.ben.receive(1, "trade.accept", refused.ana.respond(u.id, "trade.accept"));
    const r = await refused.ben.settle(u.id);
    expect(r.status).toBe("failed");
    expect(await refused.ledger.balance(2)).toBe(50);
  });

  it("refuses moves out of turn, from strangers, on closed or expired trades", () => {
    let clock = 0;
    const { ana, ben } = pair(30, undefined, () => clock);
    const t = ben.offer(1, "buy", "Tour", 8);
    expect(() => ben.respond(t.id, "trade.accept")).toThrow("not my move");
    ana.receive(2, "trade.offer", t);
    expect(() => ana.receive(3, "trade.accept", t)).toThrow();
    ben.receive(1, "trade.decline", ana.respond(t.id, "trade.decline"));
    expect(() => ben.respond(t.id, "trade.accept")).toThrow();
    const late = ben.offer(1, "buy", "Tour", 8);
    ana.receive(2, "trade.offer", late);
    clock = 120_000;
    expect(() => ana.respond(late.id, "trade.accept")).toThrow("expired");
  });

  it("only accepts Ven amounts with at most two decimals", () => {
    expect(validVen(9)).toBe(true);
    expect(validVen(9.99)).toBe(true);
    expect(validVen(9.999)).toBe(false);
    expect(validVen(0)).toBe(false);
    expect(validVen(-1)).toBe(false);
  });
});
