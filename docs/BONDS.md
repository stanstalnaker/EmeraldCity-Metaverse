# Emerald City Bonds as Ultra assets

**Status: design plus core logic** (`packages/core/src/bonds.ts`, tested). The HubID side below is not built yet. It needs authorisation to change HubID and Ultra code, then review by the HubID team. No bond may be sold before legal sign-off (see "Before sale").

## What exists

| | Today |
|---|---|
| hubculture.city/investment | Emerald City Bonds: 1 year at 3%, 3 years at 5%, 5 years at 7%. Fixed annual returns. Sold in the Hub Culture store. Principal or returns can be exchanged for land and infrastructure credit in the city. **Citizen Project Bonds** need City Council approval. |
| hubculture.city/governance | HubID access control, property access levels, **Propel** liquid democracy at property and city level, and planned City Council elections. |
| Ultra (HubID + `hub/ultra-core`) | An asset is a row in `ultra_assets`. An artisan submits it, a Hub Culture admin approves it, and buyers fill from the issuer's supply at a fixed Ven price (`custom_ven_amount`). Sale Ven goes to the issuer. Holders trade on the order book (`MatchEngine`). Holdings are in `wallets` (per user and asset), with history in `wallet_transactions`. **There is no coupon, maturity or redemption support, and no `bond` category.** |

## Decisions (Nov 2026)

- **Face value in Ven.** For example, one bond = 100 Ven, bought at face and redeemed at face. Coupons are paid in Ven.
- **Any HubID member may buy.** Agents (Mandala agents and bot sub-profiles) never may. Per-issue allow-lists and jurisdiction blocks exist, switched off by default, so counsel can enable them without new code.
- **Tradeable on Ultra.** Whoever holds a bond when a payment runs receives it, so entitlement moves with trading.
- **A dedicated bonds account** (a HubID user) issues the city's bonds, receives sale proceeds, and pays coupons and principal. It is ring-fenced from the Zeke land treasury.

## How a bond works

1. **Issue.** The bonds account (city bonds) or a citizen (project bonds) creates an Ultra asset with:
   - category `bond`;
   - `weighting_type = custom_ven_amount` and `explicit_ven_amount = face value`;
   - a ticker such as `uEC3Y`;
   - supply as pending quantity;
   - the bond terms (term, rate, issue date, land-credit option);
   - the prospectus and terms attached through the existing `external_entity_doc` and `ultra_asset_terms`.
2. **Approve.**
   - Citizen project bonds first need a City Council approval: a Propel vote, recorded as `council_approval_ref`.
   - Then a Hub Culture admin approves the issuance with the existing `approveIssuance()`. The status becomes `active`.
3. **Sell.** Buyers purchase through Ultra as for any asset. `BuyerIssuerMatcher` fills from the issuer's supply at face, and the Ven goes to the bonds account. `canBuyBond()` gates every purchase, primary or secondary: it must be active, not matured, the buyer must not be an agent or the issuer, and any allow-list or jurisdiction rules apply.
4. **Pay coupons.**
   - A daily HubID command, `ultra:bond-payouts`, reads `wallets` for each active bond, calls `planPayouts()`, and pays each due coupon in Ven from the bonds account.
   - Every payment carries an idempotency key (`bond:{asset}:{period}:{kind}:{user}`) stored in a unique ledger column. A rerun or a crash can therefore never pay twice, and missed days catch up.
5. **Mature.**
   - On the last date the command pays the final coupon and the principal.
   - It then burns the holder's bonds: their wallet balance is debited and `num_assets` reduced.
   - Holders who chose **land credit** get principal as Emerald City credit instead. It is recorded against their HubID and spent on parcel claims or infrastructure in the parcels flow.
   - Trading stops at maturity.
6. **Shortfall.** If the bonds account lacks Ven for a run:
   - the command pays nothing for that bond;
   - it marks the run failed and alerts treasury;
   - it retries next day.

   It never pays some holders and not others.

`lifetimeObligation()` gives the most an issue can cost: for 1,000 bonds of 100 Ven at 5% over 3 years, that's 15,000 Ven in coupons plus 100,000 Ven principal. Admins see it before approving.

## HubID changes (to build after authorisation)

- **Tables** (SQL, ported to `Hub/db-migrations`):
  - `ultra_bond_terms`: `asset_id` (PK), `kind`, `issuer_user_id`, `face_value_ven`, `coupon_rate`, `term_years`, `issue_date`, `maturity_date`, `land_credit_redeemable`, `council_approval_ref`, `allow_list_only`, `blocked_jurisdictions`, `status`.
  - `ultra_bond_payouts`: `key` (unique), `asset_id`, `user_id`, `period`, `kind`, `units`, `amount_ven`, `status`, `transaction_ref`, `paid_at`.
  - `ultra_bond_allow_list`: `asset_id`, `user_id`.
  - `ultra_bond_land_credit`: `user_id`, `asset_id`, `amount_ven`, `spent_ven`.
- **Ultra:**
  - add `bond` to the asset categories, in ultra-core and in the ultra.exchange icon config;
  - a bond icon glyph;
  - the bond terms shown on the asset page: rate, maturity, next coupon.
- **Routes:**
  - `POST /ultra-bonds`: the bonds account or an artisan with council approval. It creates the asset and the terms in one transaction.
  - `GET /ultra-bonds/{asset}`: terms, schedule, outstanding supply.
  - `GET /me/bonds`: holdings, next payments, paid history.
  - `POST /me/bonds/{asset}/land-credit`: the holder elects land credit for principal.
- **Purchase gate:** the bond rules in both Ultra purchase paths and in order placement.
- **Command:** `ultra:bond-payouts {--date=} {--dry-run}`, scheduled daily, with a dry-run report for treasury.
- **Config:** `ULTRA_BONDS_ISSUER_USER_ID` (the bonds account).
- **Code:** PHP 5.6-compatible, since HubID's composer platform is 5.5.9. Port the TypeScript logic one to one, with the same tests.

**Prerequisite:** the Ultra asset routes have permission gaps that must be fixed before bonds go live. The details are kept privately, not in this public repo.

## Governance

- **City Council approval** for citizen project bonds uses Propel. The approval reference is stored on the bond and checked at admin approval.
- **Agents never buy bonds.** In the agent approval policy (`packages/approval`), `bond.issue` and `bond.redeem.land-credit` are classes an agent may only propose; the owner decides.
- Hub Culture admins keep the final approval on every issue, through the existing Ultra issuance review.

## Before sale

Interest-paying bonds sold to the public are regulated securities in most jurisdictions. Before any sale, counsel must decide:
- whether and where the offer can be made;
- whether the allow-list or jurisdiction blocks must be on;
- what disclosures and prospectus are required;
- how holders' tax reporting works.

The code supports each answer (`restrictions`, attached terms and prospectus), but making those decisions is not a code task.
