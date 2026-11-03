"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import type { ClaimQuote } from "@emerald-city/hubid-client";
import { claimParcelAction, quoteClaimAction } from "@/app/market-actions";

interface Selected {
  id: string;
  areaHa: number;
  tier: string;
  status: string;
  priceVen?: number;
  reservedReason?: string;
  pavilionId?: number;
}

export interface CityViewProps {
  slug: string;
  launched: boolean;
  signedIn: boolean;
  /** The member's properties not yet on a parcel (launched cities only). */
  myUnplaced: { id: number; name: string }[];
}

const TIER_COLORS = ["match", ["get", "tier"], "core", "#2e8b57", "urban", "#5fae6e", "suburban", "#a3cf7a", "#d9c56b"];

/** City viewer: no basemap, the island floats on water; parcels coloured by size band, claimed land highlighted. */
export default function CityView({ slug, launched, signedIn, myUnplaced }: CityViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: { version: 8, sources: {}, layers: [{ id: "sea", type: "background", paint: { "background-color": "#bcd9ea" } }] },
      center: [0, 0],
      zoom: 12.8,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      map.addSource("parcels", { type: "geojson", data: `/api/cities/${encodeURIComponent(slug)}/parcels`, promoteId: "id" });
      map.addLayer({
        id: "parcels",
        type: "fill",
        source: "parcels",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "status"], "reserved"], "#1b5e20",
            ["==", ["get", "status"], "claimed"], "#8e44ad",
            TIER_COLORS as never,
          ],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.85],
        },
      });
      map.addLayer({
        id: "parcel-lines",
        type: "line",
        source: "parcels",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#111111", "#ffffff"],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0.6],
        },
      });
      let current: string | number | undefined;
      map.on("click", "parcels", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        if (current !== undefined) map.setFeatureState({ source: "parcels", id: current }, { selected: false });
        current = f.id;
        if (current !== undefined) map.setFeatureState({ source: "parcels", id: current }, { selected: true });
        setSelected(f.properties as Selected);
      });
      map.on("mouseenter", "parcels", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "parcels", () => (map.getCanvas().style.cursor = ""));
    });
    return () => map.remove();
  }, [slug]);

  const refresh = () => {
    const src = mapRef.current?.getSource("parcels") as GeoJSONSource | undefined;
    src?.setData(`/api/cities/${encodeURIComponent(slug)}/parcels?t=${Date.now()}`);
  };

  return (
    <div className="city-view">
      <div ref={el} className="city-map" />
      <aside className="card city-panel">
        {selected ? (
          <ParcelPanel key={selected.id} slug={slug} parcel={selected} launched={launched} signedIn={signedIn} myUnplaced={myUnplaced} onClaimed={(pavilionId) => {
            setSelected({ ...selected, status: "claimed", pavilionId });
            refresh();
          }} />
        ) : (
          <p className="muted">Click a parcel to see its size, price and owner. Roads and rivers are public; reserved land is held by Hub Culture.</p>
        )}
        <ul className="legend">
          <li><i style={{ background: "#2e8b57" }} /> under 1 ha (core)</li>
          <li><i style={{ background: "#5fae6e" }} /> 1–5 ha</li>
          <li><i style={{ background: "#a3cf7a" }} /> 5–25 ha</li>
          <li><i style={{ background: "#d9c56b" }} /> over 25 ha (early-player land)</li>
          <li><i style={{ background: "#8e44ad" }} /> claimed</li>
          <li><i style={{ background: "#1b5e20" }} /> reserved</li>
        </ul>
      </aside>
    </div>
  );
}

function ParcelPanel({ slug, parcel, launched, signedIn, myUnplaced, onClaimed }: {
  slug: string; parcel: Selected; launched: boolean; signedIn: boolean; myUnplaced: CityViewProps["myUnplaced"]; onClaimed: (pavilionId: number) => void;
}) {
  const [quote, setQuote] = useState<ClaimQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [choice, setChoice] = useState<number | null>(myUnplaced[0]?.id ?? null);
  const [pending, start] = useTransition();
  const free = parcel.status === "free";

  useEffect(() => {
    if (!launched || !signedIn || !free) return;
    quoteClaimAction(parcel.id).then((r) => (r.quote ? setQuote(r.quote) : setError(r.error ?? null)));
  }, [parcel.id, launched, signedIn, free]);

  return (
    <>
      <h3>Parcel {parcel.id}</h3>
      <p>
        {parcel.areaHa} ha · {parcel.tier}
        <br />
        {parcel.status === "reserved" && <>Reserved ({parcel.reservedReason}) · held by Hub Culture</>}
        {parcel.status === "claimed" && (
          <>
            Claimed{parcel.pavilionId ? <> · <Link href={`/p/${parcel.pavilionId}`}>view property</Link></> : null}
          </>
        )}
        {free && <>Free · land price {parcel.priceVen} VEN</>}
      </p>

      {free && !launched && <p className="muted">This is a preview. Claiming opens when a partner launches this city.</p>}
      {free && launched && !signedIn && (
        <p>
          <Link href={`/login?next=/cities/${slug}`} className="btn">Sign in to claim</Link>
        </p>
      )}
      {free && launched && signedIn && (
        <div className="claim">
          {quote && (
            <p>
              Land {quote.land_ven} VEN
              {quote.extra_parcel_fee_ven > 0 && <> + extra-parcel fee {quote.extra_parcel_fee_ven} VEN</>}
              <br />
              <strong>Total {quote.total_ven} VEN</strong>
              {quote.included_parcels !== undefined && (
                <span className="muted"> · you hold {quote.parcels_held} of {quote.included_parcels} included parcels</span>
              )}
            </p>
          )}
          {myUnplaced.length === 0 ? (
            <p className="muted">
              Launch a property first, then claim land for it. <Link href="/properties/new">Launch a property</Link>
            </p>
          ) : (
            <>
              <label>
                Property to place here
                <select value={choice ?? ""} onChange={(e) => setChoice(Number(e.target.value))}>
                  {myUnplaced.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <button className="btn" disabled={pending || !choice} onClick={() => start(async () => {
                setError(null);
                const r = await claimParcelAction(slug, parcel.id, choice!);
                if (r.ok) {
                  setMessage(r.message ?? "Claimed.");
                  onClaimed(choice!);
                } else setError(r.error ?? "Couldn't claim.");
              })}>
                {pending ? "Claiming…" : "Claim this parcel"}
              </button>
            </>
          )}
        </div>
      )}
      {message && <p className="ok">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
