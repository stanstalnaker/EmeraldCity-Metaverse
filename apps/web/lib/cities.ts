import "server-only";
import { cutParcels, generateStarterCity, parcelsToGeoJSON, type ParcelCollection } from "@emerald-city/parcels";
import { parcelPrice, type CityPricing } from "@emerald-city/core";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** Starter pricing until partners set their own (docs/PARCELS.md). */
export const STARTER_PRICING: CityPricing = { venPerHectare: 10, minimumVen: 5 };

export interface StarterCity {
  slug: string;
  parcels: ParcelCollection;
  summary: { parcels: number; medianHa: number; largestHa: number; roadsPct: number; waterPct: number };
}

/**
 * Virtual cities live in local metres. To show them in MapLibre (which wants lng/lat) without a
 * basemap, map metres onto a small patch around 0°,0°, where degrees are near-uniform.
 */
const toDisplay = ([x, y]: [number, number]): [number, number] => [x / 111_320, y / 110_574];

const cache = new Map<string, StarterCity>();

/** The generated starter plan for a virtual city, cut into parcels. Deterministic per slug, so cached. */
export function starterCity(slug: string): StarterCity {
  const hit = cache.get(slug);
  if (hit) return hit;
  const plan = generateStarterCity(slug);
  const result = cutParcels(slug, plan.layers);
  const parcels = parcelsToGeoJSON(result, toDisplay);
  for (const f of parcels.features) {
    if (f.properties.status === "free") (f.properties as Record<string, unknown>).priceVen = parcelPrice(f.properties.areaHa * 10_000, STARTER_PRICING);
  }
  const areas = result.parcels.map((p) => p.areaM2 / 10_000).sort((a, b) => a - b);
  const city: StarterCity = {
    slug,
    parcels,
    summary: {
      parcels: areas.length,
      medianHa: Math.round((areas[areas.length >> 1] ?? 0) * 100) / 100,
      largestHa: Math.round(areas.at(-1) ?? 0),
      roadsPct: Math.round((1000 * result.stats.roadsM2) / result.stats.landM2) / 10,
      waterPct: Math.round((1000 * result.stats.waterM2) / result.stats.landM2) / 10,
    },
  };
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  cache.set(slug, city);
  return city;
}
