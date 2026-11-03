import "server-only";
import { cutParcels, generateStarterCity, parcelsToGeoJSON, RULES, toHubIdImport, type ParcelCollection } from "@emerald-city/parcels";
import { parcelPrice, type CityPricing } from "@emerald-city/core";
import type { HubCity, HubParcel } from "@emerald-city/hubid-client";
import { hubid } from "./hubid";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** Starter pricing for previews, until a partner launches the city and sets its own. */
export const STARTER_PRICING: CityPricing = { venPerHectare: 10, minimumVen: 5 };

export interface CitySummary {
  parcels: number;
  medianHa: number;
  largestHa: number;
}

export interface LoadedCity {
  slug: string;
  /** "hubid": launched city with stored parcels and real claims. "preview": generated starter layout. */
  source: "hubid" | "preview";
  city: HubCity | null;
  parcels: ParcelCollection;
  summary: CitySummary;
  pricing: CityPricing;
}

/**
 * Virtual cities live in local metres. To show them in MapLibre (lng/lat) without a basemap,
 * map metres onto a small patch around 0°,0°, where degrees are near-uniform.
 */
const toDisplay = ([x, y]: [number, number]): [number, number] => [x / 111_320, y / 110_574];

const previewCache = new Map<string, LoadedCity>();

/** The generated starter plan for a city slug, cut into parcels. Deterministic, so cached. */
export function starterCity(slug: string): LoadedCity {
  const hit = previewCache.get(slug);
  if (hit) return hit;
  const result = cutParcels(slug, generateStarterCity(slug).layers);
  const parcels = parcelsToGeoJSON(result, toDisplay);
  for (const f of parcels.features) {
    if (f.properties.status === "free") (f.properties as Record<string, unknown>).priceVen = parcelPrice(f.properties.areaHa * 10_000, STARTER_PRICING);
  }
  const city: LoadedCity = { slug, source: "preview", city: null, parcels, summary: summarise(result.parcels.map((p) => p.areaM2)), pricing: STARTER_PRICING };
  if (previewCache.size > 50) previewCache.delete(previewCache.keys().next().value!);
  previewCache.set(slug, city);
  return city;
}

/** A launched city from HubID (stored parcels, live claims), or the starter preview if it isn't launched. */
export async function loadCity(slug: string): Promise<LoadedCity> {
  let hubCity: HubCity | null = null;
  try {
    hubCity = await hubid.getCity(slug);
  } catch (err) {
    console.error(`loadCity(${slug}): HubID unavailable, showing preview`, err);
  }
  if (!hubCity) return starterCity(slug);

  const { items } = await hubid.cityParcels(slug);
  const project = hubCity.kind === "gaia" ? (p: [number, number]) => p : toDisplay;
  return {
    slug,
    source: "hubid",
    city: hubCity,
    parcels: { type: "FeatureCollection", features: items.map((p) => hubParcelFeature(p, project)) },
    summary: summarise(items.filter((p) => p.status !== "reserved" && p.status !== "public").map((p) => Number(p.area_m2))),
    pricing: { venPerHectare: Number(hubCity.ven_per_hectare), minimumVen: hubCity.minimum_ven == null ? undefined : Number(hubCity.minimum_ven) },
  };
}

function hubParcelFeature(p: HubParcel, project: (pt: [number, number]) => [number, number]) {
  return {
    type: "Feature" as const,
    id: p.id,
    geometry: { type: "Polygon" as const, coordinates: p.geometry.map((r) => r.map(project)) },
    properties: {
      id: p.id,
      status: p.status,
      tier: p.tier,
      areaHa: Math.round(Number(p.area_m2) / 100) / 100,
      ...(p.reserved_reason ? { reservedReason: p.reserved_reason } : {}),
      ...(p.price_ven != null ? { priceVen: Number(p.price_ven) } : {}),
      ...(p.pavilion_id ? { pavilionId: p.pavilion_id } : {}),
    },
  };
}

function summarise(areasM2: number[]): CitySummary {
  const ha = areasM2.map((a) => a / 10_000).sort((a, b) => a - b);
  return {
    parcels: ha.length,
    medianHa: Math.round((ha[ha.length >> 1] ?? 0) * 100) / 100,
    largestHa: Math.round(ha.at(-1) ?? 0),
  };
}

/** Engine parcels for a starter layout, in the shape HubID's import endpoint expects (local metres). */
export function starterImportPayload(slug: string) {
  const payload = toHubIdImport(cutParcels(slug, generateStarterCity(slug).layers), RULES.version);
  return { rulesVersion: payload.rules_version, parcels: payload.parcels };
}
