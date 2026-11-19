import { CitySpecSchema, type CitySpec } from "@emerald-city/worldgen";
import { cellCentre, cellsAround, geolink, type Geolink, type LatLng } from "./geo";
import { venMarket, type TerritoryIndex, type VenMarket } from "./territories";

/**
 * An island is one world in the archipelago: a city people and agents can walk into.
 *
 *   ready-built  made by Hub Culture (Emerald City, Davos, Bermuda), explored as they are
 *   generated    made from a city spec (worldgen): an island for a DIRT place like Ibiza, or
 *                one of the islands in somebody's own archipelago (Andromeda)
 *
 * An island may be geolinked to a real place. That's a reference, not ownership: the link resolves
 * to a Gaia cell and, through it, to the DIRT territory and hub of that place, which is how the
 * island's properties, agents and trade connect to land and to the token economy.
 */
export interface Island {
  slug: string;
  name: string;
  kind: "ready-built" | "generated";
  summary: string;
  /** The world the 3D client opens (`?world=`), when the island is built. */
  world?: string;
  /** Spec for generated islands; the 3D client and worldgen build the city from it. */
  spec?: CitySpec;
  geolink?: Geolink;
  /** Archipelago it belongs to (`hub` for Hub Culture's own). */
  archipelago: string;
  /** HubID of whoever made it (Hub Culture for ready-built islands). */
  ownerHubId?: number;
}

/** Hub Culture's archipelago. Davos and Ibiza sit inside DIRT territories; Bermuda doesn't (yet). */
export const HUB_ARCHIPELAGO: Island[] = [
  { slug: "emerald-city", name: "Emerald City", kind: "ready-built", world: "emerald-city", archipelago: "hub",
    summary: "The island city: pavilions, plazas, screens and Zeke at arrival. Its land work is the Amazon restoration in Peru.",
    // Placeholder: a point in the Peruvian Amazon (Madre de Dios) until the restoration land is mapped.
    geolink: geolink({ lat: -12.5933, lng: -69.1891 }) },
  { slug: "davos", name: "Davos", kind: "ready-built", world: "davos", archipelago: "hub",
    summary: "Real Alpine terrain above Davos Platz, the chalet and the agents' town.", geolink: geolink({ lat: 46.8027, lng: 9.836 }) },
  { slug: "bermuda", name: "Bermuda", kind: "ready-built", world: "bermuda", archipelago: "hub",
    summary: "The beach house, pool and tennis court on a palm-lined island.", geolink: geolink({ lat: 32.3078, lng: -64.7505 }) },
  { slug: "ibiza", name: "Ibiza", kind: "generated", archipelago: "hub",
    summary: "A white-walled island town on the first live DIRT territory.", geolink: geolink({ lat: 38.9089, lng: 1.4329 }),
    spec: CitySpecSchema.parse({ name: "Ibiza", slug: "ibiza", summary: "Whitewashed old town, harbour and beach clubs on DIRT's Genesis island.", style: "tropical", sizeMeters: 1400, density: "medium", blockMeters: 70,
      districts: [{ name: "Dalt Vila", use: "civic", share: 0.2 }, { name: "Harbour", use: "commercial", share: 0.3 }, { name: "Beach clubs", use: "plaza", share: 0.2 }, { name: "Homes", use: "residential", share: 0.3 }],
      landmarks: [{ name: "Cathedral", kind: "hall", district: "Dalt Vila" }, { name: "Club pavilion", kind: "pavilion", district: "Beach clubs" }],
      palette: { walls: "#f4f1ea", roofs: "#d9cdb8", accent: "#19c6c0" } }) },
];

/** What an island connects to, through its geolink. */
export interface IslandLinks {
  island: Island;
  /** The DIRT territory its place lies in, if any. */
  territory: { symbol: string; name: string; status: string; hub?: string | null; hubPavilionId?: number | null } | null;
  /** Ven market for that territory on Ultra. */
  market: VenMarket | null;
}

export function linksFor(island: Island, territories: TerritoryIndex): IslandLinks {
  const t = island.geolink ? territories.at(island.geolink.h3) : null;
  return {
    island,
    territory: t ? { symbol: t.symbol, name: t.name, status: t.status, hub: t.hub, hubPavilionId: t.hub_pavilion_id } : null,
    market: t ? venMarket(t) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Andromeda: generate your own archipelago, geolinked to a place.

export interface ArchipelagoRequest {
  name: string;
  /** Any string; the same seed always gives the same archipelago. */
  seed: string;
  /** Where on Earth it is tied to. */
  anchor: LatLng;
  /** 1–7 islands. */
  islands?: number;
  ownerHubId?: number;
  style?: CitySpec["style"];
}

export interface Archipelago {
  slug: string;
  name: string;
  anchor: Geolink;
  islands: Island[];
}

const ISLAND_NAMES = ["Haven", "Reach", "Spire", "Commons", "Grove", "Harbour", "Lumen", "Terrace", "Atrium", "Drift", "Meridian", "Canopy"];
const DISTRICT_SETS: CitySpec["districts"][] = [
  [{ name: "Core", use: "civic", share: 0.25 }, { name: "Market", use: "commercial", share: 0.35 }, { name: "Homes", use: "residential", share: 0.4 }],
  [{ name: "Agents' quarter", use: "agent-hub", share: 0.35 }, { name: "Exchange", use: "commercial", share: 0.35 }, { name: "Gardens", use: "park", share: 0.3 }],
  [{ name: "Forum", use: "plaza", share: 0.3 }, { name: "Studios", use: "commercial", share: 0.3 }, { name: "Lanes", use: "residential", share: 0.4 }],
];
const PALETTES: CitySpec["palette"][] = [
  { walls: "#e9eef5", roofs: "#2b3a55", accent: "#17c38b" },
  { walls: "#f4efe6", roofs: "#a45a3c", accent: "#009ee3" },
  { walls: "#dfe6e1", roofs: "#3c4a3f", accent: "#e6007e" },
  { walls: "#1d2742", roofs: "#0d1428", accent: "#6be1fb" },
];

/** Small deterministic PRNG from a string (FNV-1a → mulberry32). */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "archipelago";

/**
 * An archipelago of islands around one real place. The first island sits on the anchor's parcel
 * cell; the rest on neighbouring cells, so every island has its own Gaia address yet all of them
 * resolve to the same DIRT territory and hub when the anchor is inside one.
 */
export function generateArchipelago(req: ArchipelagoRequest): Archipelago {
  const n = Math.max(1, Math.min(7, Math.round(req.islands ?? 4)));
  const anchor = geolink(req.anchor);
  const rand = rng(`${req.seed}|${anchor.h3}`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const base = slugify(req.name);
  const cells = [anchor.h3, ...cellsAround(anchor.h3, 1).filter((c) => c !== anchor.h3)].slice(0, n);
  const used = new Set<string>();
  const islands = cells.map((cell, i) => {
    let label = pick(ISLAND_NAMES);
    while (used.has(label)) label = pick(ISLAND_NAMES);
    used.add(label);
    const name = i === 0 ? req.name.slice(0, 60) : `${req.name.slice(0, 40)} ${label}`;
    const slug = slugify(i === 0 ? base : `${base}-${label}`);
    const districts = pick(DISTRICT_SETS);
    const spec = CitySpecSchema.parse({
      name, slug,
      summary: i === 0 ? `The main island of ${req.name}.` : `${label}, an island of ${req.name}.`,
      style: req.style ?? pick(["temperate", "futurist", "tropical", "alpine"] as const),
      sizeMeters: Math.round(500 + rand() * 1300),
      density: pick(["low", "medium", "high"] as const),
      blockMeters: Math.round(55 + rand() * 60),
      districts,
      landmarks: [{ name: i === 0 ? `${req.name.slice(0, 30)} Hall` : `${label} Pavilion`, kind: i === 0 ? "hall" : pick(["tower", "dome", "pavilion"] as const), district: districts[0]!.name }],
      palette: pick(PALETTES),
    });
    const c = cellCentre(cell);
    return { slug, name, kind: "generated", summary: spec.summary, spec, archipelago: base, ownerHubId: req.ownerHubId, geolink: geolink(c) } satisfies Island;
  });
  return { slug: base, name: req.name, anchor, islands };
}
