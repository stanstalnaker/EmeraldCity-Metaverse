import { parentAt } from "./geo";

/**
 * DIRT territories as Gaia serves them (`GET /gaia/dirt/territories`) and as the DIRT launchpad
 * publishes them (`dirt.community/gaia/dirt-territories.geojson`, `export-gaia`). One Solana SPL
 * token per territory; each is covered by H3 cells at `h3_res` (9 for places up to ~420 km², 6 for
 * larger ones) and governed by a Hub Culture hub, which is a HubID Pavilion.
 */
export interface DirtTerritory {
  slug: string;
  symbol: string;
  name: string;
  wave: number;
  status: "available" | "reserved" | "launching" | "live" | string;
  country?: string;
  area_km2?: number;
  supply?: number;
  mint?: string | null;
  /** The governing hub: a HubID Pavilion. Its Propel decides on the territory. */
  hub_pavilion_id?: number | null;
  hub?: string | null;
  hub_confirmed?: boolean;
  propel?: string | null;
  /** True once the hub is confirmed and a Propel decision recorded: the Ven pair may open. */
  pair_ready?: boolean;
  gaia_address?: string;
  h3_r9?: string;
  h3_res?: number;
  h3_cells?: string[];
}

export interface TerritoryIndex {
  all: DirtTerritory[];
  /** Which territory (if any) a cell at any resolution ≥ the territory's lies in. */
  at(h3: string): DirtTerritory | null;
  bySymbol(symbol: string): DirtTerritory | null;
}

/** Index territories by their cover cells. Territories never overlap (a DIRT eligibility rule). */
export function indexTerritories(territories: DirtTerritory[]): TerritoryIndex {
  const byRes = new Map<number, Map<string, DirtTerritory>>();
  for (const t of territories) {
    if (!t.h3_cells?.length || t.h3_res === undefined) continue;
    let m = byRes.get(t.h3_res);
    if (!m) byRes.set(t.h3_res, (m = new Map()));
    for (const c of t.h3_cells) m.set(c, t);
  }
  const resolutions = [...byRes.keys()].sort((a, b) => b - a); // finest first
  const symbols = new Map(territories.map((t) => [t.symbol.toUpperCase(), t]));
  return {
    all: territories,
    at(h3) {
      for (const r of resolutions) {
        const p = parentAt(h3, r);
        const hit = p ? byRes.get(r)!.get(p) : undefined;
        if (hit) return hit;
      }
      return null;
    },
    bySymbol: (s) => symbols.get(s.toUpperCase()) ?? null,
  };
}

/** Read territories from Gaia's API shape or the DIRT GeoJSON layer. */
export function territoriesFrom(data: unknown): DirtTerritory[] {
  const d = data as { features?: { properties: DirtTerritory }[]; territories?: DirtTerritory[] } | DirtTerritory[];
  if (Array.isArray(d)) return d;
  if (d.features) return d.features.map((f) => f.properties).filter((p) => p?.symbol);
  if (d.territories) return d.territories;
  return [];
}

/**
 * The territory's Ven market on Ultra: the same mint, listed as `ud<SYMBOL>` against Ven (HubID
 * `POST /admin/ultra/listings`). It opens only when the token is live, the hub is confirmed and its
 * Propel has ruled. Until then agents and members trade it on Raydium (DIRT/SOL) or not at all.
 */
export interface VenMarket {
  ticker: string;
  state: "trading" | "awaiting-hub" | "awaiting-propel" | "not-launched";
  /** Plain words for a person or an agent. */
  note: string;
}

export function venMarket(t: DirtTerritory): VenMarket {
  const ticker = `ud${t.symbol.toUpperCase()}`;
  if (t.status !== "live") return { ticker, state: "not-launched", note: `${t.name} DIRT isn't minted yet (wave ${t.wave}, ${t.status}).` };
  if (!t.hub_confirmed) return { ticker, state: "awaiting-hub", note: `${t.name} DIRT is live on Solana; its hub must be confirmed before the Ven pair opens.` };
  if (!t.propel && !t.pair_ready) return { ticker, state: "awaiting-propel", note: `${t.name} DIRT is live; the ${t.hub ?? "hub"} Propel decision is pending.` };
  return { ticker, state: "trading", note: `${ticker} trades against Ven on Ultra.` };
}

/** Ultra's ticker rule (HubID routes: `u[a-z][A-Z0-9]{2,10}`). */
export const isUltraTicker = (t: string) => /^u[a-z][A-Z0-9]{2,10}$/.test(t);
