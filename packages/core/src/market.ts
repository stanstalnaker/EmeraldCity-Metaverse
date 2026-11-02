/**
 * Property transfers and listings.
 *
 * Decided: owners can transfer directly, peer to peer, with no fee (fast and simple). Or they can list
 * through a broker, who earns 1% of the sale value for promoting it. Brokers are people with the Real
 * Estate Agents profession, or AI agents with the `property:broker` scope, whose job is promoting
 * listings, including to other agents over the agent-to-agent protocol (intent "property.listing").
 */
import type { Actor } from "./actor";
import type { CityEntitlements } from "./membership";

export const BROKER_FEE_RATE = 0.01;

export type TransferKind = "p2p" | "brokered";

export interface Listing {
  parcelId: string;
  pavilionId: number;
  priceVen: number;
  /** HubID id of the seller (person or owner hub admin acting for it). */
  sellerHubId: number;
  /** Set for brokered listings: the person or AI agent promoting it. */
  brokerHubId?: number;
  createdAt: string;
}

export interface TransferQuote {
  kind: TransferKind;
  priceVen: number;
  brokerFeeVen: number;
  /** What the seller receives. The buyer pays priceVen. */
  sellerReceivesVen: number;
}

export function quoteTransfer(priceVen: number, kind: TransferKind): TransferQuote {
  const brokerFeeVen = kind === "brokered" ? Math.round(priceVen * BROKER_FEE_RATE * 100) / 100 : 0;
  return { kind, priceVen, brokerFeeVen, sellerReceivesVen: Math.round((priceVen - brokerFeeVen) * 100) / 100 };
}

/** Who may act as a broker: Real Estate Agents, or AI agents granted `property:broker`. */
export function canBroker(actor: Actor, humanEntitlements?: CityEntitlements): boolean {
  if (actor.kind === "agent") return actor.scopes.includes("property:broker");
  return humanEntitlements?.capabilities.has("broker") ?? false;
}
