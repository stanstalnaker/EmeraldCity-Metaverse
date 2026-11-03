"use client";

import { useActionState, useTransition, useState } from "react";
import { LocationPicker } from "@emerald-city/gaia-map";
import type { LngLat } from "@emerald-city/core";
import { buyListingAction, linkRealPlaceAction, listForSaleAction, transferAction, withdrawListingAction, type ActionResult } from "@/app/market-actions";
import { SubmitButton } from "./SubmitButton";

export interface PropertyMarketProps {
  pavilionId: number;
  isOwner: boolean;
  signedIn: boolean;
  onParcel: boolean;
  listing: { id: number; priceVen: number; brokered: boolean } | null;
  location: LngLat | null;
  styleUrl: string;
}

function Result({ r }: { r: ActionResult }) {
  if (r.error) return <p className="error" role="alert">{r.error}</p>;
  if (r.message) return <p className="ok">{r.message}</p>;
  return null;
}

/** Sell, give, buy and link-to-a-real-place controls on a property page. */
export function PropertyMarket(p: PropertyMarketProps) {
  const [listState, listAction] = useActionState(listForSaleAction.bind(null, p.pavilionId), {});
  const [giveState, giveAction] = useActionState(transferAction.bind(null, p.pavilionId), {});
  const [linkState, linkAction] = useActionState(linkRealPlaceAction.bind(null, p.pavilionId), {});
  const [buyState, setBuyState] = useState<ActionResult>({});
  const [pending, start] = useTransition();

  return (
    <>
      {/* Outside the listing section: after a purchase the listing is gone, but the confirmation should stay. */}
      {(buyState.message || buyState.error) && (
        <section className="section">
          <Result r={buyState} />
        </section>
      )}
      {p.listing && (
        <section className="section">
          <h2>For sale</h2>
          <p>
            <strong>{p.listing.priceVen} VEN</strong>
            {p.listing.brokered && <span className="muted"> · listed through a broker</span>}
          </p>
          {p.isOwner ? (
            <form action={withdrawListingAction.bind(null, p.pavilionId, p.listing.id)}>
              <SubmitButton>Withdraw listing</SubmitButton>
            </form>
          ) : p.signedIn ? (
            <button className="btn" disabled={pending} onClick={() => start(async () => setBuyState(await buyListingAction(p.listing!.id, p.pavilionId)))}>
              {pending ? "Buying…" : `Buy for ${p.listing.priceVen} VEN`}
            </button>
          ) : (
            <p className="muted">Sign in to buy.</p>
          )}
        </section>
      )}

      {p.isOwner && p.onParcel && !p.listing && (
        <section className="section">
          <h2>Sell or give</h2>
          <form action={listAction} className="stack">
            <label>
              Price (VEN)
              <input name="price" type="number" min="0.01" step="0.01" required />
            </label>
            <label>
              Broker&apos;s HubID number (optional; they earn 1% for promoting it, AI agents welcome)
              <input name="broker" type="number" min="1" />
            </label>
            <SubmitButton>List for sale</SubmitButton>
            <Result r={listState} />
          </form>
          <form action={giveAction} className="stack" style={{ marginTop: 18 }}>
            <label>
              Give directly to a member (HubID number, no fee)
              <input name="to" type="number" min="1" required />
            </label>
            <SubmitButton>Transfer</SubmitButton>
            <Result r={giveState} />
          </form>
        </section>
      )}

      {p.isOwner && (
        <section className="section">
          <h2>Link to a real place</h2>
          <p className="muted">
            People standing there will see this world as a sphere they can tap to visit. Several worlds can share one place; the land owner may
            curate links or charge rent. A matching Google Maps address and your HubID address earn verification badges.
          </p>
          <form action={linkAction} className="stack">
            <label>
              Address (optional)
              <input name="address" maxLength={255} />
            </label>
            <LocationPicker styleUrl={p.styleUrl} value={p.location} inputNames={{ lat: "lat", lng: "lng" }} className="picker" />
            <SubmitButton>Link this property</SubmitButton>
            <Result r={linkState} />
          </form>
        </section>
      )}
    </>
  );
}
