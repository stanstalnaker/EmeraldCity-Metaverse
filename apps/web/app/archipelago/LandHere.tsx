"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { plotAt, plotView, type PlotLookup, type PlotView } from "@emerald-city/archipelago/plots";

export type PlotSlot = { loading: true } | { loading: false; lookup: PlotLookup; view: PlotView };

export const plotKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Plot lookups through this app's `/api/plots/at`, one point at a time (on select or click, never
 * every island at once). "Being mapped" answers are asked again after Gaia's retry_after_secs.
 */
export function usePlots() {
  const [slots, setSlots] = useState<Record<string, PlotSlot>>({});
  const asked = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = useCallback(async (p: { lat: number; lng: number }, tries: number) => {
    const k = plotKey(p);
    const lookup = await plotAt("/api", p.lat, p.lng, { timeoutMs: 8000 });
    const view = plotView(lookup);
    setSlots((s) => ({ ...s, [k]: { loading: false, lookup, view } }));
    if (view.tone === "pending" && tries < 4) {
      timers.current.push(setTimeout(() => void run(p, tries + 1), Math.min(60, Math.max(5, view.retryAfterSecs ?? 20)) * 1000));
    } else if (view.tone === "error") {
      asked.current.delete(k); // let a later select try again
    }
  }, []);

  const look = useCallback((p: { lat: number; lng: number } | null | undefined) => {
    if (!p) return;
    const k = plotKey(p);
    if (asked.current.has(k)) return;
    asked.current.add(k);
    setSlots((s) => ({ ...s, [k]: { loading: true } }));
    void run(p, 0);
  }, [run]);

  const get = useCallback((p: { lat: number; lng: number } | null | undefined) => (p ? slots[plotKey(p)] : undefined), [slots]);
  return { look, get };
}

/** The plot an island (or a clicked point) sits on: kind, size, price and status, and a way to buy it when it's free. */
export function LandHere({ slot, onLook }: { slot: PlotSlot | undefined; onLook?: () => void }) {
  if (!slot) {
    return onLook ? (
      <div className="arch-land idle">
        <span className="arch-land-k">Land here</span>
        <button type="button" className="arch-link" onClick={(e) => { e.stopPropagation(); onLook(); }}>See the Gaia plot</button>
      </div>
    ) : null;
  }
  if (slot.loading) {
    return <div className="arch-land idle"><span className="arch-land-k">Land here</span><span className="arch-land-s">Looking up the plot…</span></div>;
  }
  const v = slot.view;
  const quiet = v.tone === "not-live" || v.tone === "error" || v.tone === "none";
  return (
    <div className={`arch-land t-${v.tone}`} onClick={(e) => e.stopPropagation()}>
      <div className="arch-land-head">
        <span className="arch-land-k">Land here</span>
        {v.kindLabel && <span className={`arch-land-kind ${v.kind ?? ""}`}>{v.kindLabel}</span>}
      </div>
      <p className="arch-land-s">{v.status}</p>
      {!quiet && (v.size || v.price || v.detail) && (
        <dl>
          {v.size && <div><dt>Size</dt><dd>{v.size}</dd></div>}
          {v.price && <div><dt>Price</dt><dd>{v.price}</dd></div>}
          {v.detail && <div><dt>{v.tone === "closed" ? "Why" : v.tone === "pending" ? "Now" : "Where"}</dt><dd title={v.detail}>{v.detail}</dd></div>}
          {v.id && <div><dt>Plot</dt><dd title={v.id}>{v.id}</dd></div>}
        </dl>
      )}
      {v.commons && <p className="arch-land-commons">{v.commons}</p>}
      {(v.buy || v.listing) && (
        <div className="arch-land-act">
          {v.buy && <a className="arch-btn buy" href={v.buy.url} target="_blank" rel="noopener noreferrer">{v.buy.label}</a>}
          {v.listing && <a className="arch-btn" href={v.listing.url} target="_blank" rel="noopener noreferrer">{v.listing.label}</a>}
        </div>
      )}
      {v.tone === "free" && v.buy && <p className="arch-land-fine">Bought on gaia.club in Ven. A world's geolink is a reference, not ownership.</p>}
    </div>
  );
}

/** The plot id, once looked up, for a launch link's `gaia_plot`. */
export const plotIdOf = (slot: PlotSlot | undefined) => (slot && !slot.loading ? slot.view.id : undefined);
