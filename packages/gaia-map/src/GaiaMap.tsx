import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type MapGeoJSONFeature } from "maplibre-gl";
import type { Property } from "@emerald-city/core";
import type { Point } from "geojson";
import { addPropertyLayers, PROPERTY_SOURCE_POINTS } from "./layers";

export interface GaiaMapProps {
  properties: Property[];
  styleUrl: string;
  /** [lng, lat]; defaults to fitting all placed properties. */
  center?: [number, number];
  zoom?: number;
  onSelectProperty?: (id: number) => void;
  className?: string;
}

export function GaiaMap({ properties, styleUrl, center, zoom, onSelectProperty, className }: GaiaMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const select = useRef(onSelectProperty);
  select.current = onSelectProperty;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: styleUrl,
      center: center ?? [0, 20],
      zoom: zoom ?? 1.5,
      pitch: 45,
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.current = m;

    const pick = (e: { features?: MapGeoJSONFeature[] }) => {
      const f = e.features?.[0];
      if (!f) return;
      if (f.properties?.cluster) {
        const coords = (f.geometry as Point).coordinates as [number, number];
        m.easeTo({ center: coords, zoom: m.getZoom() + 2 });
      } else if (f.properties?.id != null) {
        select.current?.(Number(f.properties.id));
      }
    };
    for (const layer of ["ec-pins", "ec-clusters", "ec-parcels-3d"]) {
      m.on("click", layer, pick);
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is created once; props below are applied by the other effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      addPropertyLayers(m, properties);
      if (!center) fitToProperties(m, properties);
    };
    if (m.isStyleLoaded() && m.getSource(PROPERTY_SOURCE_POINTS) !== undefined) apply();
    else m.once("load", apply);
  }, [properties, center]);

  return <div ref={el} className={className} style={{ width: "100%", height: "100%" }} />;
}

function fitToProperties(m: MlMap, properties: Property[]) {
  const placed = properties.filter((p) => p.location && !p.isPrivate);
  if (placed.length === 0) return;
  const b = new maplibregl.LngLatBounds();
  for (const p of placed) b.extend([p.location!.lng, p.location!.lat]);
  m.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
}
