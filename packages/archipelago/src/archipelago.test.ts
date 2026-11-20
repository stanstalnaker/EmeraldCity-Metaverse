import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authorize, DEFAULT_REWARDS, dirtRewards, generateArchipelago, geolink, HUB_ARCHIPELAGO, indexTerritories, linksFor,
  summarize, territoriesFrom, venMarket, cellsAround, type Mandate,
} from "./index";

const territories = indexTerritories(territoriesFrom(JSON.parse(readFileSync(new URL("../data/dirt-territories.json", import.meta.url), "utf8"))));
const island = (slug: string) => HUB_ARCHIPELAGO.find((i) => i.slug === slug)!;

describe("geolinks and DIRT territories", () => {
  it("a place resolves to its parcel cell and Gaia address", () => {
    const g = geolink({ lat: 46.8027, lng: 9.836 });
    expect(g.h3).toMatch(/^89[0-9a-f]{13}$/);
    expect(g.gaiaAddress).toBe(`MIP1|GAIA|CELL|${g.h3}`);
    expect(() => geolink({ lat: 95, lng: 0 })).toThrow();
  });
  it("Davos and Ibiza islands sit in their DIRT territories; Bermuda in none", () => {
    expect(linksFor(island("davos"), territories).territory?.symbol).toBe("DAVOS");
    expect(linksFor(island("ibiza"), territories).territory?.symbol).toBe("IBIZA"); // covered at res 6
    expect(linksFor(island("bermuda"), territories).territory).toBeNull();
  });
  it("each territory's hub is a HubID Pavilion", () => {
    expect(linksFor(island("davos"), territories).territory?.hubPavilionId).toBeTypeOf("number");
  });
  it("Ven markets open only when live, hub confirmed and Propel ruled", () => {
    const ibiza = territories.bySymbol("IBIZA")!;
    expect(venMarket(ibiza).ticker).toBe("udIBIZA");
    expect(venMarket({ ...ibiza, hub_confirmed: false }).state).toBe("awaiting-hub");
    expect(venMarket({ ...ibiza, hub_confirmed: true, propel: null, pair_ready: false }).state).toBe("awaiting-propel");
    expect(venMarket({ ...ibiza, hub_confirmed: true, propel: "propel:123", pair_ready: true }).state).toBe("trading");
    expect(venMarket(territories.bySymbol("DAVOS")!).state).toBe("not-launched");
  });
});

describe("Andromeda: your own archipelago", () => {
  it("is the same for the same seed, with one island per neighbouring cell", () => {
    const a = generateArchipelago({ name: "Nova Terra", seed: "stan-1", anchor: { lat: 38.98, lng: 1.43 }, islands: 5 });
    const b = generateArchipelago({ name: "Nova Terra", seed: "stan-1", anchor: { lat: 38.98, lng: 1.43 }, islands: 5 });
    expect(a).toEqual(b);
    expect(a.islands).toHaveLength(5);
    expect(new Set(a.islands.map((i) => i.geolink!.h3)).size).toBe(5);
    expect(a.islands[0]!.geolink!.h3).toBe(a.anchor.h3);
    expect(new Set(a.islands.map((i) => i.slug)).size).toBe(5);
  });
  it("anchored inside Ibiza, every island links to IBIZA DIRT", () => {
    const a = generateArchipelago({ name: "Sa Talaia", seed: "x", anchor: { lat: 38.98, lng: 1.43 }, islands: 3 });
    for (const i of a.islands) expect(linksFor(i, territories).territory?.symbol).toBe("IBIZA");
  });
  it("a different seed gives different cities", () => {
    const a = generateArchipelago({ name: "Nova", seed: "1", anchor: { lat: 0, lng: 0 } });
    const b = generateArchipelago({ name: "Nova", seed: "2", anchor: { lat: 0, lng: 0 } });
    expect(a.islands.map((i) => i.spec!.palette)).not.toEqual(b.islands.map((i) => i.spec!.palette));
  });
});

describe("agents: mandates, contributions and DIRT", () => {
  const m: Mandate = {
    agentHubId: 9001, ownerHubId: 1,
    scopes: ["converse", "world:act", "agent:negotiate", "ven:earn", "gaia:contribute", "ultra:trade"],
    channels: ["telegram", "hub-messages", "metaverse"],
    venPerDay: 200, venPerTrade: 100, approveAbove: 50, markets: ["udIBIZA"],
  };
  it("talks on the channels it's allowed, nowhere else", () => {
    expect(authorize(m, { kind: "converse", channel: "telegram", with: "owner", text: "hi" }, { venSpent: 0 }).allowed).toBe(true);
    expect(authorize(m, { kind: "converse", channel: "web", with: "x", text: "hi" }, { venSpent: 0 }).allowed).toBe(false);
  });
  it("trades only allowed markets, within limits, asking the owner above the line", () => {
    expect(authorize(m, { kind: "trade", side: "buy", ticker: "udIBIZA", ven: 20 }, { venSpent: 0 })).toMatchObject({ allowed: true, needsOwnerApproval: false });
    expect(authorize(m, { kind: "trade", side: "buy", ticker: "udIBIZA", ven: 80 }, { venSpent: 0 })).toMatchObject({ allowed: true, needsOwnerApproval: true });
    expect(authorize(m, { kind: "trade", side: "buy", ticker: "udIBIZA", ven: 150 }, { venSpent: 0 }).allowed).toBe(false);
    expect(authorize(m, { kind: "trade", side: "buy", ticker: "udIBIZA", ven: 40 }, { venSpent: 180 }).allowed).toBe(false);
    expect(authorize(m, { kind: "trade", side: "buy", ticker: "udKAUAI", ven: 10 }, { venSpent: 0 }).allowed).toBe(false);
    expect(authorize({ ...m, markets: ["ud*"] }, { kind: "trade", side: "buy", ticker: "udKAUAI", ven: 10 }, { venSpent: 0 }).allowed).toBe(true);
  });
  it("while the economy is a closed loop, agents keep holdings in Ultra", () => {
    const w = { kind: "withdraw", asset: "udIBIZA", to: "solana:SomeWallet", amount: 10 } as const;
    expect(authorize({ ...m, scopes: [...m.scopes, "ven:send"] }, w, { venSpent: 0 }).allowed).toBe(false);
    // Once Hub Culture opens the loop: allowed within limits, always with the owner's approval.
    const open = { closedLoop: false };
    expect(authorize({ ...m, scopes: [...m.scopes, "ven:send"] }, w, { venSpent: 0 }, open)).toMatchObject({ allowed: true, needsOwnerApproval: true });
    expect(authorize(m, w, { venSpent: 0 }, open).allowed).toBe(false); // needs ven:send
    expect(authorize({ ...m, scopes: [...m.scopes, "ven:send"] }, { ...w, amount: 500 }, { venSpent: 0 }, open).allowed).toBe(false);
  });
  it("Emerald City's placeholder is in Acre, Brazil", () => {
    const g = island("emerald-city").geolink!;
    expect(g.lat).toBeCloseTo(-8.95, 1);
    expect(g.lng).toBeCloseTo(-72.83, 1);
  });
  it("brokering needs its own scope", () => {
    expect(authorize(m, { kind: "world", island: "davos", act: "broker", ref: "pav-7" }, { venSpent: 0 }).allowed).toBe(false);
  });
  it("contributions must cite a source and name their cells", () => {
    expect(authorize(m, { kind: "contribute", layer: "qem-reef", cells: [], source: "https://x", records: 1 }, { venSpent: 0 }).allowed).toBe(false);
    expect(authorize(m, { kind: "contribute", layer: "qem-reef", cells: ["891f8ad4157ffff"], source: "nowhere", records: 1 }, { venSpent: 0 }).allowed).toBe(false);
  });
  it("accepted data inside a live territory earns that territory's DIRT; elsewhere it's recorded for later", () => {
    const ibizaCell = geolink({ lat: 38.98, lng: 1.43 }).h3;
    const davosCell = island("davos").geolink!.h3;
    const cells = [...cellsAround(ibizaCell, 1), davosCell, geolink({ lat: 0, lng: -30 }).h3];
    const r = dirtRewards(cells, territories);
    expect(r.find((x) => x.symbol === "IBIZA")).toMatchObject({ cells: 7, dirt: 7 * DEFAULT_REWARDS.dirtPerCell });
    expect(r.find((x) => x.symbol === "DAVOS")).toMatchObject({ cells: 1, dirt: 0 });
    expect(r).toHaveLength(2); // the mid-Atlantic cell is in no territory
  });
  it("summarizes an agent's day for its owner", () => {
    const s = summarize([
      { at: "t", agentHubId: 9001, action: { kind: "converse", channel: "telegram", with: "owner", text: "go" }, decision: { allowed: true, needsOwnerApproval: false, reason: "" } },
      { at: "t", agentHubId: 9001, action: { kind: "service", forHubId: 2, what: "translate", venEarned: 12 }, decision: { allowed: true, needsOwnerApproval: false, reason: "" }, earnedVen: 12 },
      { at: "t", agentHubId: 9001, action: { kind: "contribute", layer: "qem", cells: ["a"], source: "https://x", records: 3 }, decision: { allowed: true, needsOwnerApproval: false, reason: "" }, earnedDirt: [{ symbol: "IBIZA", dirt: 175 }] },
      { at: "t", agentHubId: 9001, action: { kind: "world", island: "ibiza", act: "visit" }, decision: { allowed: true, needsOwnerApproval: false, reason: "" } },
    ]);
    expect(s).toMatchObject({ actions: 4, venEarned: 12, dirt: { IBIZA: 175 }, channels: ["telegram"], islands: ["ibiza"] });
  });
});
