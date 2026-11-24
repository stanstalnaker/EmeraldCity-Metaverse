/**
 * A world manifest is everything that defines a 3D city as data: which models stream in where,
 * every interactive screen and the property zone it shows, spawn points per property, and
 * teleport destinations. The same 3D client renders any manifest, so partner cities are data,
 * not code. Emerald City's manifest is imported from the legacy vr.hubculture.city scene
 * (scripts/extract-legacy.ts) without changing the live site.
 *
 * Coordinates are the legacy Babylon world units (≈ metres), y up.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WorldModel {
  /** Stable id, e.g. "city-hall". */
  id: string;
  /** Path relative to the world's asset base, e.g. "models/city-hall.babylon". */
  file: string;
  /** Stream the model in when the viewer is within `radius` of `anchor`. Null = always loaded (terrain). */
  anchor: Vec3 | null;
  radius: number | null;
  /** Placement applied to the whole model after loading (position, uniform scale, yaw in radians). */
  transform?: { position: Vec3; scale: number; rotationY: number };
  /** Load the compressed GLB conversion by default (it is clearly smaller for this model). */
  glb?: boolean;
}

/** What an in-world screen shows. */
export type ScreenContent =
  | { kind: "link"; url: string }
  | { kind: "html"; html: string }
  | {
      kind: "zone";
      /** HubID pavilion (property) whose zone content feeds the screen. */
      pavilionId: number;
      pavilionName: string;
      zoneId: number;
      zoneName: string;
      zoneType: string;
      /** "media" screens show the zone's media URLs; "file" screens its uploaded files. */
      slot: "media" | "file";
      /** Which item of the zone's list this screen shows. */
      index: number;
      /** Shown if the zone has nothing at `index`. */
      fallbackUrl?: string;
    };

export interface WorldScreen {
  /** Mesh name in the model files. */
  mesh: string;
  content: ScreenContent;
}

export interface WorldZone {
  pavilionId: number;
  pavilionName: string;
  zoneId: number;
  name: string;
  type: string;
  mediaScreens: string[];
  fileScreens: string[];
}

export interface Spawn {
  position: Vec3;
  /** Camera yaw in radians. */
  rotationY: number;
}

export interface TeleportDestination {
  id: string;
  label: string;
  position: Vec3;
  /** "kiosk" = arrival kiosk, "lift" = lift floor buttons, "other". */
  group: "kiosk" | "lift" | "other";
  /** Direction to face on arrival (radians), when it matters (e.g. facing a building). */
  rotationY?: number;
}

export interface WorldMaterial {
  name?: string;
  color?: [number, number, number, number];
  /** Asset path of the texture, relative to the world's asset base (converted to .png). */
  texture?: string;
  tiling?: [number, number];
  smoothness?: number;
  metallic?: number;
  transparent?: boolean;
}

/** Placement with a full rotation (quaternion x,y,z,w) and non-uniform scale, left-handed y-up. */
export interface Placement {
  name?: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  material?: WorldMaterial;
}

export interface Primitive extends Placement {
  shape: "cube" | "cylinder" | "sphere" | "capsule" | "plane" | "quad";
}

export interface PlacedMesh extends Placement {
  /** Source model (FBX path in the Unity project; served converted as .glb). */
  file: string;
  /** Mesh inside the model; null places the whole model. */
  mesh: string | null;
}

export interface Terrain {
  /** Raw little-endian uint16 heightmap, row 0 = north (max z) edge (see `layout`). */
  heightmap: string;
  /**
   * How rows and columns map to the world. "north-up" (default): row 0 is the max-z edge, columns
   * run along +x (real elevation data). "unity": Unity's export, where rows run along x from the
   * max-x edge and columns along +z (the imported Bermuda island).
   */
  layout?: "north-up" | "unity";
  resolution: number;
  size: [number, number];
  /** Height in world units of the value 65535. */
  height: number;
  /** World position of the terrain's min corner (x, base y, z). */
  origin: [number, number, number];
  /** Real elevation of y=0, when the terrain is real. */
  base?: number;
  style: "alpine" | "tropical" | "temperate";
}

export interface WorldEnvironment {
  style: "alpine" | "tropical" | "temperate";
  snowline?: number;
  treeline?: number;
  fog?: number;
  water?: { kind: "lake" | "ocean"; center: [number, number, number]; radius: number }[];
}

export interface Portal {
  to: string;
  label: string;
  position: [number, number, number];
  /** Which way the opening faces (radians about y; 0 = facing ±z). Default: towards the world's arrival point. */
  rotationY?: number;
}

/** A portal's facing: its own, or turned towards where people arrive so they walk straight in. */
export function portalFacing(p: Portal, arrival: { x: number; z: number }): number {
  if (p.rotationY !== undefined) return p.rotationY;
  return Math.atan2(arrival.x - p.position[0], arrival.z - p.position[2]);
}

/**
 * One instanced batch: the same shape and material repeated. Each transform is
 * [x, y, z, rotationY, scaleX, scaleY, scaleZ, r, g, b]; y is the bottom of the shape and r, g, b
 * (0-1) tint that instance (material.color is used when they are absent).
 */
export interface InstanceBatch {
  shape: "box" | "gable" | "cylinder" | "cone" | "dome";
  material: { color: [number, number, number]; roughness?: number; emissive?: [number, number, number] };
  transforms: number[][];
}

export interface GeneratedCity {
  name: string;
  /** Spec it was built from (for rebuilds). */
  spec: string;
  batches: InstanceBatch[];
  /** Invisible collision boxes for buildings: [cx, cy, cz, sx, sy, sz, rotationY]. */
  colliders: number[][];
  /** Named places for the teleport list. */
  places: { name: string; position: [number, number, number] }[];
}

export interface WorldManifest {
  version: 1;
  slug: string;
  name: string;
  /** Where the data came from (for imported worlds). */
  source?: { repo: string; file: string; commit?: string; extractedAt: string } | string;
  attribution?: string;
  /** Subfolder of the asset host for this world's files (e.g. "unity"); default is the legacy city. */
  assetBase?: string;
  environment?: WorldEnvironment;
  terrain?: Terrain;
  trees?: { kind: "conifer" | "palm"; instances: [number, number, number, number][] };
  primitives?: Primitive[];
  meshes?: PlacedMesh[];
  portals?: Portal[];
  /**
   * Gaussian splats: photoreal captures of real places (.splat, .ply or .spz), e.g. a landmark
   * scanned from phone video. position is where the capture's origin goes.
   */
  splats?: { url: string; label?: string; position: [number, number, number]; rotationY?: number; scale?: number }[];
  /** Generated cities (packages/worldgen), drawn as instanced batches. */
  generated?: GeneratedCity[];
  /** A real town from OpenStreetMap, in this world's frame (file in data/, see OsmTown). */
  osm?: string;
  /** Glass villas built in code (Emerald City's deluxe lots), replacing the 2017 type-4 houses. */
  villas?: { id: string; position: [number, number, number]; rotationY: number; pool: [number, number] }[];
  /** Hub Culture pavilions (hubicon.co) standing in this world, by the address they're next to. */
  pavilions?: Pavilion[];
  models: WorldModel[];
  screens: WorldScreen[];
  zones: WorldZone[];
  defaultSpawn: Spawn;
  /** Spawn per HubID pavilion id ("" = the Lotus default used by the legacy site). */
  spawns: Record<string, Spawn>;
  teleports: TeleportDestination[];
}

/** Spawn for a property, falling back to the world default. */
export function spawnFor(world: WorldManifest, pavilionId?: string | number | null): Spawn {
  if (pavilionId === undefined || pavilionId === null) return world.defaultSpawn;
  return world.spawns[String(pavilionId)] ?? world.defaultSpawn;
}

/** Models that should be loaded for a viewer at `at` (always-loaded models included). */
export function modelsInRange(world: WorldManifest, at: Vec3, margin = 1): WorldModel[] {
  return world.models.filter((m) => {
    if (!m.anchor || m.radius === null) return true;
    const d = Math.hypot(at.x - m.anchor.x, at.y - m.anchor.y, at.z - m.anchor.z);
    return d <= m.radius * margin;
  });
}

/** All screens bound to a property, e.g. to show which in-world screens an owner's uploads appear on. */
export function screensForProperty(world: WorldManifest, pavilionId: number): WorldScreen[] {
  return world.screens.filter((s) => s.content.kind === "zone" && s.content.pavilionId === pavilionId);
}

/** Ground height of a terrain at world (x, z), bilinear. `heights` is the decoded heightmap. */
/** Grid coordinates (row, column, fractional) of world x/z in the heightmap, per the terrain's layout. */
export function terrainGrid(t: Terrain, x: number, z: number): { row: number; col: number } {
  const res = t.resolution;
  const fx = (x - t.origin[0]) / t.size[0];
  const fz = (z - t.origin[2]) / t.size[1];
  if (t.layout === "unity") return { row: (1 - fx) * (res - 1), col: fz * (res - 1) };
  return { row: (1 - fz) * (res - 1), col: fx * (res - 1) };
}

export function terrainHeight(t: Terrain, heights: Uint16Array, x: number, z: number): number {
  const res = t.resolution;
  const g = terrainGrid(t, x, z);
  let u = g.col;
  let v = g.row;
  u = Math.min(Math.max(u, 0), res - 1.001);
  v = Math.min(Math.max(v, 0), res - 1.001);
  const i = Math.floor(v), j = Math.floor(u), fu = u - j, fv = v - i;
  const h = (r: number, c: number) => heights[r * res + c]!;
  const raw = h(i, j) * (1 - fu) * (1 - fv) + h(i, j + 1) * fu * (1 - fv) + h(i + 1, j) * (1 - fu) * fv + h(i + 1, j + 1) * fu * fv;
  return (raw / 65535) * t.height + t.origin[1];
}

/**
 * A real town from OpenStreetMap (packages/world/scripts/build-osm-town.py), in the world's metric
 * frame: x east, z north. Map data © OpenStreetMap contributors, ODbL.
 */
export interface OsmTown {
  attribution: string;
  center: [number, number];
  buildings: OsmBuilding[];
  roads: { c: string; w: number; p: [number, number][]; bridge?: 1 }[];
  rail: [number, number][][];
  rivers: { w: number; p: [number, number][] }[];
}

export interface OsmBuilding {
  id: number;
  /** Footprint, counter-clockwise seen from above, not closed. */
  ring: [number, number][];
  /** Height to the eaves (m), from OSM or estimated. */
  h: number;
  roof: "flat" | "pitched";
  kind?: "church";
  name?: string;
  addr?: string;
  /** Set on Hub Culture pavilions (their id). */
  hub?: string;
}

/**
 * A Hub Culture pavilion: the ICON (timber, on stilts), its sibling the AGENT (glass, LED band), or
 * the Techlodge (placeholder lodge until its design is in).
 */
export interface Pavilion {
  id: string;
  kind: "icon" | "agent" | "techlodge";
  label: string;
  address: string;
  /** Centre of the plan, on the ground. */
  position: [number, number, number];
  /** Turns the plan's long axis (local x) to lie along the street. */
  rotationY: number;
  /** Plan length (along local x) and width (m). */
  size: [number, number];
}

/** Emerald City's streets, one for each sixth of the city around the arrival plaza (from north, clockwise). */
export const CITY_STREETS = ["Radiant Lane", "Canopy Row", "Lotus Crescent", "Emerald Way", "Orchid Terrace", "Rainforest Walk"] as const;

/**
 * A street address for every lot in a world, so a property feels like an address ("001 Radiant Lane")
 * rather than a number. The street is the sixth of the city the lot sits in, seen from the arrival
 * plaza; numbers run outward from the plaza along it. Stable: the same lots always get the same
 * addresses, and new lots further out take the next numbers.
 */
export function lotAddresses(world: WorldManifest, streets: readonly string[] = CITY_STREETS): Map<string, string> {
  const c = world.defaultSpawn.position;
  const lots = Object.entries(world.spawns)
    .filter(([id]) => /^\d+$/.test(id))
    .map(([id, sp]) => {
      const dx = sp.position.x - c.x, dz = sp.position.z - c.z;
      const bearing = (Math.atan2(dx, dz) + 2 * Math.PI) % (2 * Math.PI); // 0 = north (+z), clockwise
      return { id, street: Math.floor(bearing / ((2 * Math.PI) / streets.length)) % streets.length, d: Math.hypot(dx, dz) };
    });
  const out = new Map<string, string>();
  streets.forEach((name, s) => {
    lots.filter((l) => l.street === s).sort((a, b) => a.d - b.d || Number(a.id) - Number(b.id))
      .forEach((l, i) => out.set(l.id, `${String(i + 1).padStart(3, "0")} ${name}`));
  });
  return out;
}

/** The street of Emerald City's glass villas (their own, so other properties' numbers never shift). */
export const VILLA_STREET = "Villa Way";

/** "001 Villa Way" … for each glass villa, in the order of the rows (stable: by id). */
export function villaAddresses(world: WorldManifest): Map<string, string> {
  const out = new Map<string, string>();
  [...(world.villas ?? [])]
    .sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")))
    .forEach((v, i) => out.set(v.id, `${String(i + 1).padStart(3, "0")} ${VILLA_STREET}`));
  return out;
}
