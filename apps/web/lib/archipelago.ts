import "server-only";
import { HUB_ARCHIPELAGO, indexTerritories, linksFor, territoriesFrom, type DirtTerritory, type IslandLinks, type TerritoryIndex } from "@emerald-city/archipelago";

/**
 * The DIRT register: the live public layer (dirt.community, the same file Gaia imports), falling
 * back to the snapshot in packages/archipelago/data when it can't be reached.
 */
const LAYER_URL = process.env.DIRT_LAYER_URL ?? "https://dirt.community/gaia/dirt-territories.geojson";

export interface TerritoryFeature {
  type: "Feature";
  geometry: unknown;
  properties: Omit<DirtTerritory, "h3_cells">;
}

interface Loaded {
  source: "live" | "snapshot";
  index: TerritoryIndex;
  /** For the map: outlines without the (large) cell covers. */
  features: TerritoryFeature[];
}

let cache: { at: number; value: Loaded } | null = null;

async function snapshot(): Promise<unknown> {
  return (await import("@emerald-city/archipelago/snapshot")).DIRT_SNAPSHOT;
}

export async function loadTerritories(): Promise<Loaded> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  let source: Loaded["source"] = "live";
  let raw: unknown;
  try {
    const r = await fetch(LAYER_URL, { signal: AbortSignal.timeout(4000), next: { revalidate: 300 } });
    if (!r.ok) throw new Error(String(r.status));
    raw = await r.json();
  } catch {
    source = "snapshot";
    raw = await snapshot();
  }
  const list = territoriesFrom(raw);
  const fc = raw as { features?: { geometry: unknown; properties: DirtTerritory }[] };
  const features: TerritoryFeature[] = (fc.features ?? []).map((f) => {
    const { h3_cells: _cells, ...properties } = f.properties;
    return { type: "Feature", geometry: f.geometry, properties };
  });
  const value = { source, index: indexTerritories(list), features };
  cache = { at: Date.now(), value };
  return value;
}

export async function hubIslands(): Promise<IslandLinks[]> {
  const { index } = await loadTerritories();
  return HUB_ARCHIPELAGO.map((i) => linksFor(i, index));
}

/** Where the 3D city lives (city.beta on beta). */
export const city3dUrl = () => process.env.CITY3D_URL ?? process.env.NEXT_PUBLIC_CITY3D_URL ?? "https://city.beta.hubculture.city";
/** Where properties are launched today (hubculture.city's launch flow). */
export const launchUrl = () => process.env.LAUNCH_PROPERTY_URL ?? "https://beta.hubculture.city/launch-properties";
export const ultraUrl = () => process.env.ULTRA_URL ?? "https://ultra.exchange";
