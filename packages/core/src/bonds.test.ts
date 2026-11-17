import { describe, expect, it } from "vitest";
import {
  canBuyBond, couponSchedule, fundingNeeded, lifetimeObligation, maturityDate, planPayouts, validateBondTerms, type BondTerms,
} from "./bonds";

const city3y: BondTerms & { assetId: number } = {
  assetId: 900, kind: "city", ticker: "uEC3Y", title: "Emerald City Bond 3Y", issuerUserId: 7000,
  faceValueVen: 100, couponRate: 0.05, termYears: 3, issueDate: "2026-12-01", supply: 1000, landCreditRedeemable: true,
};

describe("bond terms", () => {
  it("accepts the published city series and rejects off-series rates", () => {
    expect(validateBondTerms(city3y).ok).toBe(true);
    expect(validateBondTerms({ ...city3y, couponRate: 0.06 }).errors.join()).toMatch(/published series/);
    expect(validateBondTerms({ ...city3y, ticker: "EC3Y" }).ok).toBe(false);
    expect(validateBondTerms({ ...city3y, faceValueVen: 10.005 }).ok).toBe(false);
  });

  it("requires City Council approval for citizen project bonds, at any rate up to the cap", () => {
    const p: BondTerms = { ...city3y, kind: "citizen-project", couponRate: 0.08, ticker: "uGARDN" };
    expect(validateBondTerms(p).errors.join()).toMatch(/City Council/);
    expect(validateBondTerms({ ...p, councilApprovalRef: "council-2026-14" }).ok).toBe(true);
    expect(validateBondTerms({ ...p, councilApprovalRef: "x", couponRate: 0.5 }).ok).toBe(false);
  });
});

describe("schedule", () => {
  it("pays annual coupons on each anniversary and principal with the last", () => {
    expect(maturityDate(city3y)).toBe("2029-12-01");
    expect(couponSchedule(city3y)).toEqual([
      { period: 1, date: "2027-12-01", couponVen: 5, principalVen: 0 },
      { period: 2, date: "2028-12-01", couponVen: 5, principalVen: 0 },
      { period: 3, date: "2029-12-01", couponVen: 5, principalVen: 100 },
    ]);
  });

  it("moves 29 February anniversaries to 28 February", () => {
    expect(couponSchedule({ ...city3y, issueDate: "2028-02-29", termYears: 1 })[0]!.date).toBe("2029-02-28");
  });

  it("states the issuer's lifetime obligation", () => {
    expect(lifetimeObligation(city3y)).toEqual({ couponsVen: 15000, principalVen: 100000, totalVen: 115000 });
  });
});

describe("payout plan", () => {
  const holdings = [{ userId: 1, units: 10 }, { userId: 2, units: 2.5 }, { userId: 7000, units: 987.5 }];

  it("pays holders on record, never the issuer's unsold supply, pro rata for fractions", () => {
    const plan = planPayouts(city3y, holdings, "2027-12-01", new Set());
    expect(plan.map((p) => [p.userId, p.kind, p.amountVen])).toEqual([[1, "coupon", 50], [2, "coupon", 12.5]]);
    expect(fundingNeeded(plan)).toBe(62.5);
    expect(planPayouts(city3y, holdings, "2027-11-30", new Set())).toEqual([]);
  });

  it("is idempotent: paid keys are never planned again, missed periods are caught up", () => {
    const first = planPayouts(city3y, holdings, "2027-12-01", new Set());
    const paid = new Set(first.map((p) => p.key));
    const late = planPayouts(city3y, holdings, "2029-12-05", paid);
    expect(late.filter((p) => p.period === 1)).toEqual([]);
    expect(late.filter((p) => p.kind === "principal").map((p) => [p.userId, p.amountVen])).toEqual([[1, 1000], [2, 250]]);
    expect(new Set(late.map((p) => p.key)).size).toBe(late.length);
  });
});

describe("who can buy", () => {
  const human = { kind: "human" as const, hubId: 42 };
  it("lets any member buy an active bond before maturity; never agents or the issuer", () => {
    expect(canBuyBond(city3y, "active", human, "2027-01-10")).toEqual({ ok: true });
    expect(canBuyBond(city3y, "active", { ...human, kind: "agent" }, "2027-01-10").ok).toBe(false);
    expect(canBuyBond(city3y, "active", { ...human, hubId: 7000 }, "2027-01-10").ok).toBe(false);
    expect(canBuyBond(city3y, "pending-approval", human, "2027-01-10").ok).toBe(false);
    expect(canBuyBond(city3y, "active", human, "2029-12-01").ok).toBe(false);
  });

  it("honours per-issue allow-lists and jurisdiction blocks when counsel turns them on", () => {
    const restricted = { ...city3y, restrictions: { allowListOnly: true, blockedJurisdictions: ["US"] } };
    expect(canBuyBond(restricted, "active", human, "2027-01-10").ok).toBe(false);
    expect(canBuyBond(restricted, "active", { ...human, allowListed: true, jurisdiction: "us" }, "2027-01-10").ok).toBe(false);
    expect(canBuyBond(restricted, "active", { ...human, allowListed: true, jurisdiction: "CH" }, "2027-01-10")).toEqual({ ok: true });
  });
});
