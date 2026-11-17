/**
 * Emerald City Bonds, issued as Ultra assets.
 *
 * An Ultra asset is a row in HubID (`ultra_assets`), priced and settled in Ven, sold from the
 * issuer's supply and traded on the Ultra order book. Bonds add what Ultra lacks: a term, an
 * annual coupon, maturity and redemption. This module is the pure logic: validation, the coupon
 * schedule and the payout plan. HubID runs it against `wallets` holdings and pays in Ven from the
 * bonds account (see docs/BONDS.md). Nothing here moves money.
 *
 * Agreed decisions (Nov 2026): everything in Ven: bought, paid and redeemed in Ven, no land credit
 * or other payout forms; any HubID member may buy (agents never);
 * bonds trade on Ultra, and whoever holds a bond on a payment date receives that coupon; a
 * dedicated bonds account issues the city's bonds and pays coupons and principal.
 */

/** The published city series (hubculture.city/investment). */
export const CITY_BOND_TERMS = [
  { termYears: 1, couponRate: 0.03 },
  { termYears: 3, couponRate: 0.05 },
  { termYears: 5, couponRate: 0.07 },
] as const;

export type BondKind = "city" | "citizen-project";
export type BondStatus = "draft" | "pending-council" | "pending-approval" | "active" | "matured" | "suspended";

export interface BondTerms {
  /** Ultra asset id (ultra_assets.id) once created. */
  assetId?: number;
  kind: BondKind;
  /** Ultra ticker: "u" + 2-6 letters, e.g. uEC1Y. */
  ticker: string;
  title: string;
  /** HubID user that sold the bonds and pays coupons and principal (the bonds account for city bonds). */
  issuerUserId: number;
  /** Price and redemption value of one bond, in Ven. */
  faceValueVen: number;
  /** Annual coupon as a fraction of face value (0.05 = 5%). */
  couponRate: number;
  termYears: number;
  /** ISO date (UTC, YYYY-MM-DD) the bond starts accruing. */
  issueDate: string;
  /** Number of bonds offered. */
  supply: number;
  /** Citizen project bonds: the City Council approval that allowed the issue. */
  councilApprovalRef?: string;
  /** Off by default; counsel can switch these on per issue without new code. */
  restrictions?: { allowListOnly?: boolean; blockedJurisdictions?: string[] };
}

export interface BondValidation {
  ok: boolean;
  errors: string[];
}

const MAX_RATE = 0.2;

export function validateBondTerms(t: BondTerms): BondValidation {
  const e: string[] = [];
  if (!/^u[A-Z0-9]{2,6}$/.test(t.ticker)) e.push("ticker must be 'u' followed by 2-6 capital letters or digits");
  if (t.title.trim().length < 5 || t.title.length > 64) e.push("title must be 5-64 characters");
  if (!Number.isInteger(t.issuerUserId) || t.issuerUserId <= 0) e.push("issuer must be a HubID user");
  if (!(t.faceValueVen > 0) || !isFiniteMoney(t.faceValueVen)) e.push("face value must be a positive Ven amount (max 2 decimals)");
  if (!(t.couponRate >= 0 && t.couponRate <= MAX_RATE)) e.push(`coupon rate must be between 0 and ${MAX_RATE * 100}%`);
  if (!Number.isInteger(t.termYears) || t.termYears < 1 || t.termYears > 10) e.push("term must be 1-10 whole years");
  if (!Number.isInteger(t.supply) || t.supply < 1) e.push("supply must be a whole number of bonds");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.issueDate) || Number.isNaN(Date.parse(t.issueDate + "T00:00:00Z"))) e.push("issue date must be YYYY-MM-DD");
  if (t.kind === "city") {
    const published = CITY_BOND_TERMS.find((c) => c.termYears === t.termYears);
    if (!published || published.couponRate !== t.couponRate) e.push("city bonds use the published series: 1y 3%, 3y 5%, 5y 7%");
  }
  if (t.kind === "citizen-project" && !t.councilApprovalRef) e.push("citizen project bonds need a City Council approval");
  return { ok: e.length === 0, errors: e };
}

function isFiniteMoney(v: number): boolean {
  return Number.isFinite(v) && Math.abs(Math.round(v * 100) - v * 100) < 1e-9;
}

/** Round to Ven cents. */
export const ven = (v: number) => Math.round(v * 100 + Number.EPSILON * Math.sign(v)) / 100;

function addYears(isoDate: string, years: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  const y = d.getUTCFullYear() + years;
  // 29 Feb issues pay on 28 Feb in non-leap years.
  const m = d.getUTCMonth(), day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}

export function maturityDate(t: Pick<BondTerms, "issueDate" | "termYears">): string {
  return addYears(t.issueDate, t.termYears);
}

export interface CouponPeriod {
  period: number;
  date: string;
  /** Coupon per bond, in Ven. */
  couponVen: number;
  /** Principal per bond paid on this date (only the last period). */
  principalVen: number;
}

/** Annual coupons on each anniversary; principal with the last coupon. */
export function couponSchedule(t: Pick<BondTerms, "issueDate" | "termYears" | "faceValueVen" | "couponRate">): CouponPeriod[] {
  return Array.from({ length: t.termYears }, (_, i) => ({
    period: i + 1,
    date: addYears(t.issueDate, i + 1),
    couponVen: ven(t.faceValueVen * t.couponRate),
    principalVen: i + 1 === t.termYears ? t.faceValueVen : 0,
  }));
}

/** Holder balances (Ultra `wallets` rows for the bond asset) at the record time. */
export interface Holding {
  userId: number;
  units: number;
}

export type PayoutKind = "coupon" | "principal";

export interface Payout {
  /** Idempotency key: one payment per bond, holder, period and kind, ever. */
  key: string;
  assetId: number;
  userId: number;
  period: number;
  kind: PayoutKind;
  units: number;
  amountVen: number;
  dueDate: string;
}

/**
 * The payments due on or before `asOf` that have not been made. Holders are whoever held the
 * bond at the run (the record date is the payment date; secondary trading moves entitlement).
 * The issuer's own unsold supply earns nothing. Fractional units pay pro rata.
 */
export function planPayouts(
  t: BondTerms & { assetId: number },
  holdings: Holding[],
  asOf: string,
  alreadyPaid: ReadonlySet<string>,
): Payout[] {
  const out: Payout[] = [];
  for (const p of couponSchedule(t)) {
    if (p.date > asOf) break;
    for (const h of holdings) {
      if (h.userId === t.issuerUserId || !(h.units > 0)) continue;
      const entries: [PayoutKind, number][] = [["coupon", p.couponVen]];
      if (p.principalVen > 0) entries.push(["principal", p.principalVen]);
      for (const [kind, perBond] of entries) {
        if (perBond <= 0) continue;
        const key = `bond:${t.assetId}:${p.period}:${kind}:${h.userId}`;
        if (alreadyPaid.has(key)) continue;
        out.push({ key, assetId: t.assetId, userId: h.userId, period: p.period, kind, units: h.units, amountVen: ven(perBond * h.units), dueDate: p.date });
      }
    }
  }
  return out;
}

/** Ven the bonds account must hold to make every payment in the plan. */
export function fundingNeeded(plan: Payout[]): number {
  return ven(plan.reduce((s, p) => s + p.amountVen, 0));
}

/** Total Ven the issuer owes over the life of the issue if every bond sells. */
export function lifetimeObligation(t: Pick<BondTerms, "faceValueVen" | "couponRate" | "termYears" | "supply">): { couponsVen: number; principalVen: number; totalVen: number } {
  const couponsVen = ven(t.faceValueVen * t.couponRate * t.termYears * t.supply);
  const principalVen = ven(t.faceValueVen * t.supply);
  return { couponsVen, principalVen, totalVen: ven(couponsVen + principalVen) };
}

export type BuyDecision = { ok: true } | { ok: false; reason: string };

/** Who may buy a bond (primary sale or on the order book). */
export function canBuyBond(
  t: BondTerms,
  status: BondStatus,
  buyer: { kind: "human" | "agent"; hubId: number; jurisdiction?: string; allowListed?: boolean },
  today: string,
): BuyDecision {
  if (status !== "active") return { ok: false, reason: `bond is ${status}` };
  if (today >= maturityDate(t)) return { ok: false, reason: "bond has matured" };
  if (buyer.kind === "agent") return { ok: false, reason: "agents cannot buy bonds" };
  if (buyer.hubId === t.issuerUserId) return { ok: false, reason: "the issuer cannot buy its own bonds" };
  if (t.restrictions?.allowListOnly && !buyer.allowListed) return { ok: false, reason: "this issue is private (allow-list only)" };
  const blocked = t.restrictions?.blockedJurisdictions ?? [];
  if (blocked.length && (!buyer.jurisdiction || blocked.includes(buyer.jurisdiction.toUpperCase())))
    return { ok: false, reason: buyer.jurisdiction ? "not available in your jurisdiction" : "jurisdiction unknown" };
  return { ok: true };
}
