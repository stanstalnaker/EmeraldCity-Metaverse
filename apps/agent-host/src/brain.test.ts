import { describe, expect, it } from "vitest";
import { cleanActions, ScriptBrain, type Perception } from "./brain";

describe("agent brain", () => {
  it("keeps only well-formed actions from Zeke (his output is untrusted)", () => {
    const out = cleanActions([
      { do: "go", place: "icon" },
      { do: "offer", to: 9101, side: "buy", item: "Tour", priceVen: 8 },
      { do: "offer", to: "9101", side: "buy", item: "Tour", priceVen: 8 }, // to must be a HubID number
      { do: "rm -rf", place: "/" },
      { do: "wait", seconds: 99999 },
      "nonsense",
    ]);
    expect(out.map((a) => a.do)).toEqual(["go", "offer", "wait"]);
    expect(out[2]).toEqual({ do: "wait", seconds: 600 });
    expect(cleanActions("not a list")).toEqual([]);
  });

  it("script brain: counters halfway, accepts within its limit, then follows its script", async () => {
    const p = (trades: Perception["trades"]): Perception => ({
      now: "", agent: { hubId: 1, name: "A", ownerHubId: 9 }, persona: "", instructions: "",
      location: { island: "Davos", world: "davos", near: null, walking: false }, places: [], islands: [], nearby: [], heard: [],
      trades, wallet: { ven: 10, mode: "sandbox" }, budget: { venLeft: 10, paused: false },
    });
    const seller = new ScriptBrain([{ do: "say", text: "hi" }], { floorVen: 10 });
    const offer = { id: "t", seller: 1, buyer: 2, item: "Tour", priceVen: 8, status: "open" as const, turn: 1 };
    expect((await seller.decide(p([offer]))).actions).toEqual([{ do: "counter", trade: "t", priceVen: 9 }]);
    expect((await seller.decide(p([{ ...offer, priceVen: 10 }]))).actions).toEqual([{ do: "accept", trade: "t" }]);
    expect((await seller.decide(p([]))).actions).toEqual([{ do: "say", text: "hi" }]);
  });
});
