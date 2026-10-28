import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { propertiesToParcels, propertiesToPoints, type Property } from "@emerald-city/core";

export const PROPERTY_SOURCE_POINTS = "ec-properties";
export const PROPERTY_SOURCE_PARCELS = "ec-parcels";

const EMERALD = "#1fa37a";

/**
 * Adds (or refreshes) the property layers:
 *  - parcels: one-hectare footprints, extruded at street zoom
 *  - pins:    clustered points at city/world zoom
 */
export function addPropertyLayers(map: MlMap, properties: Property[]): void {
  const points = propertiesToPoints(properties);
  const parcels = propertiesToParcels(properties);

  const existing = map.getSource(PROPERTY_SOURCE_POINTS) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(points as FeatureCollection);
    (map.getSource(PROPERTY_SOURCE_PARCELS) as GeoJSONSource).setData(parcels as FeatureCollection);
    return;
  }

  map.addSource(PROPERTY_SOURCE_PARCELS, { type: "geojson", data: parcels as FeatureCollection });
  map.addSource(PROPERTY_SOURCE_POINTS, {
    type: "geojson",
    data: points as FeatureCollection,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 13,
  });

  map.addLayer({
    id: "ec-parcels-3d",
    type: "fill-extrusion",
    source: PROPERTY_SOURCE_PARCELS,
    minzoom: 14,
    paint: {
      "fill-extrusion-color": EMERALD,
      "fill-extrusion-opacity": 0.55,
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 40],
    },
  });
  map.addLayer({
    id: "ec-clusters",
    type: "circle",
    source: PROPERTY_SOURCE_POINTS,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": EMERALD,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 50, 28],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff",
    },
  });
  map.addLayer({
    id: "ec-cluster-count",
    type: "symbol",
    source: PROPERTY_SOURCE_POINTS,
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
    paint: { "text-color": "#fff" },
  });
  map.addLayer({
    id: "ec-pins",
    type: "circle",
    source: PROPERTY_SOURCE_POINTS,
    filter: ["!", ["has", "point_count"]],
    maxzoom: 15,
    paint: { "circle-color": EMERALD, "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
  });
}
