"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import type { IslandLinks } from "@emerald-city/archipelago";
import { launchLink } from "@emerald-city/archipelago/plots";
import { LandHere, plotIdOf, usePlots } from "./LandHere";

type Territories = { type: "FeatureCollection"; features: { type: "Feature"; geometry: unknown; properties: Record<string, unknown> }[] };
type Tab = "islands" | "dirt" | "generate";
interface Generated { slug: string; name: string; anchor: { lat: number; lng: number; h3: string; gaiaAddress: string }; links: IslandLinks[] }

const MARKET_LABEL: Record<string, string> = {
  trading: "Trading on Ultra",
  "awaiting-hub": "Live · hub to confirm",
  "awaiting-propel": "Live · Propel pending",
  "not-launched": "Not minted yet",
};

export default function ArchipelagoMap(props: {
  styleUrl: string;
  islands: IslandLinks[];
  territories: Territories;
  source: "live" | "snapshot";
  links: { city3d: string; launch: string; ultra: string };
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [tab, setTab] = useState<Tab>("islands");
  const [selected, setSelected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({ name: "", seed: "", islands: 4 });
  const [gen, setGen] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genSel, setGenSel] = useState<string | null>(null);
  /** The point whose plot is outlined on the map. */
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const plots = usePlots();
  const tabRef = useRef<Tab>("islands");
  tabRef.current = tab;

  const territories = useMemo(
    () => props.territories.features.map((f) => f.properties as { slug: string; symbol: string; name: string; wave: number; status: string; country?: string; area_km2?: number; hub?: string }).sort((a, b) => a.wave - b.wave || a.name.localeCompare(b.name)),
    [props.territories],
  );

  // Map: DIRT territories, islands, and (on Generate) your archipelago.
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: props.styleUrl, center: [-20, 30], zoom: 1.6, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      m.addSource("dirt", { type: "geojson", data: props.territories as GeoJSON.FeatureCollection, attribution: "DIRT territories (hub-culture/thisisdirt) · boundaries © OpenStreetMap contributors (ODbL)" });
      m.addLayer({ id: "dirt-fill", type: "fill", source: "dirt", paint: { "fill-color": ["case", ["==", ["get", "status"], "live"], "#17c38b", "#7209b7"], "fill-opacity": ["case", ["==", ["get", "status"], "live"], 0.32, 0.18] } });
      m.addLayer({ id: "dirt-line", type: "line", source: "dirt", paint: { "line-color": ["case", ["==", ["get", "status"], "live"], "#17c38b", "#b98cff"], "line-width": 1.6 } });
      m.addLayer({ id: "dirt-label", type: "symbol", source: "dirt", minzoom: 4, layout: { "text-field": ["concat", "$", ["get", "symbol"]], "text-size": 12, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": "#eaf2ff", "text-halo-color": "#040a1c", "text-halo-width": 1.5 } });
      m.addSource("plot", { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "Plots: Gaia (gaia.club)" });
      m.addLayer({ id: "plot-fill", type: "fill", source: "plot", paint: { "fill-color": "#ffd166", "fill-opacity": 0.18 } });
      m.addLayer({ id: "plot-line", type: "line", source: "plot", paint: { "line-color": "#ffd166", "line-width": 2, "line-dasharray": [2, 1] } });
      m.addSource("mine", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "mine-ring", type: "circle", source: "mine", paint: { "circle-radius": 9, "circle-color": "#e6007e", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      m.on("click", "dirt-fill", (e) => {
        if (tabRef.current === "generate") return;
        const p = e.features?.[0]?.properties as { symbol?: string } | undefined;
        if (p?.symbol) { setTab("dirt"); setSelected(String(p.symbol)); }
      });
      m.on("mouseenter", "dirt-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "dirt-fill", () => (m.getCanvas().style.cursor = ""));
      m.on("click", (e) => { if (tabRef.current === "generate") setAnchor({ lat: +e.lngLat.lat.toFixed(5), lng: +e.lngLat.lng.toFixed(5) }); });
    });
    for (const l of props.islands) {
      if (!l.island.geolink) continue;
      const el = document.createElement("button");
      el.className = "arch-gem";
      el.title = l.island.name;
      el.innerHTML = `<span></span><b>${l.island.name}</b>`;
      el.onclick = (ev) => { ev.stopPropagation(); setTab("islands"); setSelected(l.island.slug); };
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([l.island.geolink.lng, l.island.geolink.lat]).addTo(m));
    }
    return () => { markers.current.forEach((mk) => mk.remove()); markers.current = []; m.remove(); };
  }, [props.styleUrl, props.territories, props.islands]);

  // Fly to what's selected.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const island = props.islands.find((l) => l.island.slug === selected)?.island;
    if (island?.geolink) return void m.flyTo({ center: [island.geolink.lng, island.geolink.lat], zoom: 8.5, speed: 1.4 });
    const f = props.territories.features.find((x) => x.properties.symbol === selected);
    const c = f && (f.properties as { h3_r9?: string }).h3_r9 ? centroid(f.geometry) : null;
    if (c) m.flyTo({ center: c, zoom: 8.5, speed: 1.4 });
  }, [selected, props.islands, props.territories]);

  // The plot under what's selected: looked up on select or click, one at a time.
  useEffect(() => {
    if (tab !== "islands" || !selected) return;
    const g = props.islands.find((l) => l.island.slug === selected)?.island.geolink;
    if (g) { plots.look(g); setFocus(g); }
  }, [tab, selected, props.islands, plots.look]);
  useEffect(() => {
    if (tab !== "generate") return;
    const g = gen?.links.find((l) => l.island.slug === genSel)?.island.geolink ?? gen?.links[0]?.island.geolink ?? anchor;
    if (g) { plots.look(g); setFocus(g); }
  }, [tab, anchor, gen, genSel, plots.look]);

  // Outline the focused plot.
  const focusSlot = plots.get(focus);
  useEffect(() => {
    const src = map.current?.getSource("plot") as GeoJSONSource | undefined;
    const f = focusSlot && !focusSlot.loading && focusSlot.lookup.state === "ok" ? focusSlot.lookup.at.plot : null;
    src?.setData({ type: "FeatureCollection", features: f?.geometry ? [{ type: "Feature", properties: {}, geometry: f.geometry as GeoJSON.Geometry }] : [] });
  }, [focusSlot]);

  // Your archipelago on the map.
  useEffect(() => {
    const src = map.current?.getSource("mine") as GeoJSONSource | undefined;
    const pts = gen ? gen.links.map((l) => l.island.geolink!) : anchor ? [anchor] : [];
    src?.setData({ type: "FeatureCollection", features: pts.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) });
    if (gen) map.current?.flyTo({ center: [gen.anchor.lng, gen.anchor.lat], zoom: 13.5, speed: 1.3 });
  }, [anchor, gen]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!anchor) return setError("Click the map to choose where your archipelago is tied to.");
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/archipelago", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, seed: form.seed || form.name, ...anchor }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't generate it.");
      setGen(j);
      setGenSel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const selT = territories.find((t) => t.symbol === selected);

  return (
    <div className="arch">
      <div ref={box} className="arch-map" />
      <aside className="arch-panel">
        <p className="arch-kicker">Hub Culture</p>
        <h1>The archipelago</h1>
        <p className="arch-sub">Worlds you can walk into, tied to real places on the Gaia map, where DIRT territories and their Ven markets live.</p>
        <nav className="arch-tabs">
          {(["islands", "dirt", "generate"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "islands" ? "Islands" : t === "dirt" ? "DIRT" : "Your own"}</button>
          ))}
        </nav>

        {tab === "islands" && (
          <div className="arch-list">
            {props.islands.map((l) => (
              <article key={l.island.slug} className={`arch-card${selected === l.island.slug ? " sel" : ""}`} onClick={() => setSelected(l.island.slug)}>
                <header><span className="arch-dot" /><b>{l.island.name}</b><small>{l.island.kind === "ready-built" ? "Ready-built" : "Generated"}</small></header>
                <p>{l.island.summary}</p>
                <dl>
                  <div><dt>Gaia cell</dt><dd title={l.island.geolink?.gaiaAddress}>{l.island.geolink?.h3 ?? "—"}</dd></div>
                  <div><dt>DIRT</dt><dd>{l.territory ? `$${l.territory.symbol} · ${l.territory.status}` : "No territory here yet"}</dd></div>
                  {l.territory?.hub && <div><dt>Hub</dt><dd>{l.territory.hub}{l.territory.hubPavilionId ? ` (Pavilion ${l.territory.hubPavilionId})` : ""}</dd></div>}
                  {l.market && <div><dt>Ven market</dt><dd>{l.market.ticker} · {MARKET_LABEL[l.market.state]}</dd></div>}
                </dl>
                <LandHere slot={plots.get(l.island.geolink)} onLook={l.island.geolink ? () => setSelected(l.island.slug) : undefined} />
                <footer>
                  {l.island.world ? <a className="arch-btn primary" href={`${props.links.city3d}/?world=${l.island.world === "emerald-city" ? "" : l.island.world}`} target="_blank" rel="noopener">Enter in 3D</a> : <span className="arch-btn ghost" title="Generated from its city spec; opens in 3D when built">Coming to 3D</span>}
                  <a className="arch-btn" href={launchLink(props.links.launch, { city: l.island.slug, geolink: l.island.geolink, plotId: plotIdOf(plots.get(l.island.geolink)) })}>Launch a property</a>
                  {l.market?.state === "trading" && <a className="arch-btn" href={`${props.links.ultra}/markets/${l.market.ticker}`} target="_blank" rel="noopener">Trade {l.market.ticker}</a>}
                </footer>
              </article>
            ))}
          </div>
        )}

        {tab === "dirt" && (
          <div className="arch-list">
            <p className="arch-note">Each territory is one Solana DIRT token covering a real place, governed by its Hub. Once it's live, its hub is confirmed and its Propel has ruled, it trades against Ven on Ultra as <code>ud&lt;SYMBOL&gt;</code>. Agents earn it for useful data they add to Gaia inside it.</p>
            {territories.map((t) => (
              <button key={t.slug} className={`arch-row${selected === t.symbol ? " sel" : ""}`} onClick={() => setSelected(t.symbol)}>
                <span className={`arch-pill ${t.status === "live" ? "live" : ""}`}>{t.status === "live" ? "Live" : `Wave ${t.wave}`}</span>
                <b>${t.symbol}</b><span>{t.name}</span><small>{t.area_km2 ? `${Math.round(t.area_km2)} km²` : ""}</small>
              </button>
            ))}
            {selT && <p className="arch-note">{selT.name}{selT.country ? `, ${selT.country}` : ""}{selT.hub ? ` · hub: ${selT.hub}` : ""}. Market: ud{selT.symbol}.</p>}
            <p className="arch-src">{props.source === "live" ? "Live from dirt.community" : "From the bundled DIRT snapshot (dirt.community unreachable)"}</p>
          </div>
        )}

        {tab === "generate" && (
          <form className="arch-gen" onSubmit={generate}>
            <p className="arch-note">Andromeda: make your own archipelago. Click the map to tie it to a place; each island gets its own Gaia cell around it, and if the place is inside a DIRT territory, your islands, properties and agents link to that territory and its hub.</p>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nova Terra" maxLength={60} required /></label>
            <label>Seed <small>(same seed, same islands)</small><input value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} placeholder="optional" maxLength={80} /></label>
            <label>Islands: {form.islands}<input type="range" min={1} max={7} value={form.islands} onChange={(e) => setForm({ ...form, islands: Number(e.target.value) })} /></label>
            <p className="arch-anchor">{anchor ? `Tied to ${anchor.lat}, ${anchor.lng}` : "Click the map to choose a place"}</p>
            {anchor && !gen && <LandHere slot={plots.get(anchor)} />}
            <button className="arch-btn primary" disabled={busy}>{busy ? "Generating…" : "Generate"}</button>
            {error && <p className="arch-err">{error}</p>}
            {gen && (
              <div className="arch-list">
                <p className="arch-note"><b>{gen.name}</b> · anchor cell {gen.anchor.h3}{gen.links[0]?.territory ? ` · inside $${gen.links[0].territory.symbol} DIRT` : " · outside any DIRT territory"}</p>
                {gen.links.map((l, i) => {
                  const on = genSel ? genSel === l.island.slug : i === 0;
                  const slot = plots.get(l.island.geolink);
                  return (
                    <article key={l.island.slug} className={`arch-card${on ? " sel" : ""}`} onClick={() => setGenSel(l.island.slug)}>
                      <header><span className="arch-dot mine" /><b>{l.island.name}</b><small>{i === 0 ? "Anchor · " : ""}{l.island.spec?.style} · {l.island.spec?.sizeMeters} m</small></header>
                      <p>{l.island.spec?.districts.map((d) => d.name).join(" · ")}</p>
                      <dl><div><dt>Gaia cell</dt><dd>{l.island.geolink?.h3}</dd></div>{l.market && <div><dt>Ven market</dt><dd>{l.market.ticker} · {MARKET_LABEL[l.market.state]}</dd></div>}</dl>
                      <LandHere slot={slot} onLook={() => setGenSel(l.island.slug)} />
                      {(on || slot) && (
                        <footer>
                          <a className="arch-btn" href={launchLink(props.links.launch, { city: l.island.slug, geolink: l.island.geolink, plotId: plotIdOf(slot) })} onClick={(e) => e.stopPropagation()}>Launch a property</a>
                        </footer>
                      )}
                    </article>
                  );
                })}
                <p className="arch-src">A preview: nothing is saved yet. Saving an archipelago needs the HubID cities work (docs/PARCELS.md).</p>
              </div>
            )}
          </form>
        )}
      </aside>
    </div>
  );
}

function centroid(g: unknown): [number, number] | null {
  const geom = g as { type: string; coordinates: number[][][] | number[][][][] };
  const ring = geom?.type === "Polygon" ? (geom.coordinates as number[][][])[0] : geom?.type === "MultiPolygon" ? (geom.coordinates as number[][][][])[0]?.[0] : null;
  if (!ring?.length) return null;
  let x = 0, y = 0;
  for (const [lng, lat] of ring) { x += lng!; y += lat!; }
  return [x / ring.length, y / ring.length];
}
