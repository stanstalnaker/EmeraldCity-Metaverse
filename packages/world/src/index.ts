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
}

export interface WorldManifest {
  version: 1;
  slug: string;
  name: string;
  /** Where the data came from (for imported worlds). */
  source?: { repo: string; file: string; commit?: string; extractedAt: string };
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
