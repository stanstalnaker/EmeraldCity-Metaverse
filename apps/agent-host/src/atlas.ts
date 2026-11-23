/**
 * Where agents can be: every island in the archipelagos (Hub Culture's and members' Andromeda
 * archipelagos). Islands with a 3D world (Emerald City, Davos, Bermuda; Kauai and Ibiza next) have
 * places, ground heights and, where a real town is mapped, a street graph to walk. Islands without
 * one yet are on the archipelago map (presence room "map", positions as lat/lng).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { HUB_ARCHIPELAGO, type Island } from "@emerald-city/archipelago";
import { placesOf, StreetGraph, type Place } from "@emerald-city/agents";
import { terrainHeight, type OsmTown, type WorldManifest } from "@emerald-city/world";

export interface WorldInfo {
  slug: string;
  name: string;
  room: string;
  places: Place[];
  arrival: { x: number; z: number; heading: number };
  ground: (x: number, z: number) => number;
  streets: StreetGraph | null;
}

export interface Atlas {
  islands: Island[];
  worlds: Map<string, WorldInfo>;
  /** An island by slug or name ("Davos", "kauai"). */
  island(q: string): Island | undefined;
}

const dataDir = () => join(dirname(createRequire(import.meta.url).resolve("@emerald-city/world")), "..", "data");

export function loadWorld(slug: string, dir = dataDir()): WorldInfo | null {
  let w: WorldManifest;
  try {
    w = JSON.parse(readFileSync(join(dir, `${slug}.world.json`), "utf8")) as WorldManifest;
  } catch {
    return null;
  }
  let ground = (_x: number, _z: number) => w.defaultSpawn.position.y;
  if (w.terrain) {
    const raw = readFileSync(join(dir, w.terrain.heightmap));
    const h = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    const t = w.terrain;
    ground = (x, z) => terrainHeight(t, h, x, z);
  }
  let streets: StreetGraph | null = null;
  if (w.osm) {
    const town = JSON.parse(readFileSync(join(dir, w.osm), "utf8")) as OsmTown;
    streets = StreetGraph.fromTown(town);
  }
  return {
    slug,
    name: w.name,
    room: `world:${slug}`,
    places: placesOf(w),
    arrival: { x: w.defaultSpawn.position.x, z: w.defaultSpawn.position.z, heading: w.defaultSpawn.rotationY ?? 0 },
    ground,
    streets,
  };
}

export function loadAtlas(extraIslands: Island[] = [], dir?: string): Atlas {
  const islands = [...HUB_ARCHIPELAGO, ...extraIslands];
  const worlds = new Map<string, WorldInfo>();
  for (const i of islands) {
    if (!i.world || worlds.has(i.world)) continue;
    const w = loadWorld(i.world, dir);
    if (w) worlds.set(i.world, w);
  }
  return {
    islands,
    worlds,
    island(q: string) {
      const s = q.trim().toLowerCase();
      return islands.find((i) => i.slug === s || i.name.toLowerCase() === s) ?? islands.find((i) => i.name.toLowerCase().includes(s));
    },
  };
}
