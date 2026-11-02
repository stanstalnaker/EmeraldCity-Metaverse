"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

interface Selected {
  id: string;
  areaHa: number;
  tier: string;
  status: string;
  priceVen?: number;
  reservedReason?: string;
}

const TIER_COLORS = ["match", ["get", "tier"], "core", "#2e8b57", "urban", "#5fae6e", "suburban", "#a3cf7a", "#d9c56b"];

/** Virtual city viewer: no basemap, the island floats on water; parcels coloured by size band. */
export default function CityView({ slug }: { slug: string }) {
  const el = useRef<HTMLDivElement>(null);
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
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      map.addSource("parcels", { type: "geojson", data: `/api/cities/${encodeURIComponent(slug)}/parcels`, promoteId: "id" });
      map.addLayer({
        id: "parcels",
        type: "fill",
        source: "parcels",
        paint: {
          "fill-color": ["case", ["==", ["get", "status"], "reserved"], "#1b5e20", TIER_COLORS as never],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.85],
        },
      });
      map.addLayer({ id: "parcel-lines", type: "line", source: "parcels", paint: { "line-color": "#ffffff", "line-width": 0.6 } });
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

  return (
    <div className="city-view">
      <div ref={el} className="city-map" />
      <aside className="card city-panel">
        {selected ? (
          <>
            <h3>Parcel {selected.id}</h3>
            <p>
              {selected.areaHa} ha · {selected.tier}
              <br />
              {selected.status === "reserved" ? `Reserved (${selected.reservedReason}) · held by Hub Culture` : "Free to claim"}
              {selected.priceVen !== undefined && (
                <>
                  <br />
                  Starter price: {selected.priceVen} VEN
                </>
              )}
            </p>
            <p className="muted">Claiming opens once HubID stores parcels (docs/PARCELS.md).</p>
          </>
        ) : (
          <p className="muted">Click a parcel to see its size, band and price. Roads and the river are public; the park is reserved.</p>
        )}
        <ul className="legend">
          <li><i style={{ background: "#2e8b57" }} /> under 1 ha (core)</li>
          <li><i style={{ background: "#5fae6e" }} /> 1–5 ha</li>
          <li><i style={{ background: "#a3cf7a" }} /> 5–25 ha</li>
          <li><i style={{ background: "#d9c56b" }} /> over 25 ha (early-player land)</li>
          <li><i style={{ background: "#1b5e20" }} /> reserved</li>
        </ul>
      </aside>
    </div>
  );
}
