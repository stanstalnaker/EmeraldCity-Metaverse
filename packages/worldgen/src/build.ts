import type { GeneratedCity, InstanceBatch } from "@emerald-city/world";
import type { CitySpec } from "./spec";

/**
 * Lays out a city from a spec on a terrain: a street grid aligned to the ground, districts by role
 * (civic and plazas in the centre, commerce around them, homes outside, parks and an agent hub
 * mixed in), buildings from the style's kit on buildable slopes, and landmarks. Deterministic:
 * the same spec, site and seed give the same city.
 */
export interface Site {
  /** Centre of the built-up area (world x, z). */
  center: [number, number];
  /** Ground height at world (x, z), or null outside the terrain. */
  ground: (x: number, z: number) => number | null;
  /** Street grid rotation (radians); default follows the terrain's contour direction. */
  orientation?: number;
  /** Keep-out circles (x, z, radius), e.g. an existing chalet or a lake. */
  avoid?: [number, number, number][];
  seed?: number;
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Direction the ground falls fastest around the centre; streets run along the contour. */
function contourAngle(site: Site): number {
  const [cx, cz] = site.center, d = 150;
  const g = (x: number, z: number) => site.ground(x, z) ?? 0;
  const dx = g(cx + d, cz) - g(cx - d, cz), dz = g(cx, cz + d) - g(cx, cz - d);
  if (Math.hypot(dx, dz) < 1e-3) return 0;
  return Math.atan2(dz, dx) + Math.PI / 2;
}

type Use = CitySpec["districts"][number]["use"];

export function buildCity(spec: CitySpec, site: Site): GeneratedCity {
  const rand = rng(site.seed ?? 7);
  const theta = site.orientation ?? contourAngle(site);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const toWorld = (u: number, v: number): [number, number] => [site.center[0] + u * cos - v * sin, site.center[1] + u * sin + v * cos];
  const half = spec.sizeMeters / 2;
  const B = spec.blockMeters, street = Math.max(8, Math.round(B * 0.16));
  const n = Math.max(2, Math.floor(spec.sizeMeters / B));

  // Blocks, nearest the centre first.
  const blocks: { i: number; j: number; u: number; v: number; r: number }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const u = -half + (i + 0.5) * B, v = -half + (j + 0.5) * B;
      const r = Math.hypot(u, v) / half;
      if (r <= 1.05) blocks.push({ i, j, u, v, r });
    }
  blocks.sort((a, b) => a.r - b.r);

  // Districts by role, as rings: civic/plaza at the centre, then commercial, residential outside;
  // parks and the agent hub take their share spread through the middle rings.
  const order: Use[] = ["plaza", "civic", "agent-hub", "commercial", "park", "residential"];
  const total = spec.districts.reduce((s, d) => s + d.share, 0);
  const quota = new Map<string, number>();
  for (const d of spec.districts) quota.set(d.name, Math.max(1, Math.round((d.share / total) * blocks.length)));
  const districtsInOrder = [...spec.districts].sort((a, b) => order.indexOf(a.use) - order.indexOf(b.use));
  const assigned: { block: (typeof blocks)[number]; district: CitySpec["districts"][number] }[] = [];
  let k = 0;
  for (const d of districtsInOrder) {
    for (let c = 0; c < quota.get(d.name)! && k < blocks.length; c++, k++) assigned.push({ block: blocks[k]!, district: d });
  }
  for (; k < blocks.length; k++) assigned.push({ block: blocks[k]!, district: districtsInOrder[districtsInOrder.length - 1]! });

  const walls = hex(spec.palette.walls), roofs = hex(spec.palette.roofs), accent = hex(spec.palette.accent);
  const batch = new Map<string, InstanceBatch>();
  // One batch per shape (plus one per glowing accent colour); colours ride on each instance.
  const add = (shape: InstanceBatch["shape"], color: [number, number, number], t: number[], emissive?: [number, number, number]) => {
    const key = `${shape}|${emissive ? emissive.map((c) => c.toFixed(3)).join(",") : ""}`;
    let b = batch.get(key);
    if (!b) batch.set(key, (b = { shape, material: { color: [1, 1, 1], roughness: 0.8, ...(emissive ? { emissive } : {}) }, transforms: [] }));
    b.transforms.push([...t.map((x) => +x.toFixed(2)), ...color.map((c) => +c.toFixed(3))]);
  };
  const colliders: number[][] = [];
  const places: GeneratedCity["places"] = [];
  const blocked = (x: number, z: number) => (site.avoid ?? []).some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r);
  const slopeAt = (x: number, z: number) => {
    const g = site.ground, a = g(x + 6, z), b = g(x - 6, z), c = g(x, z + 6), d = g(x, z - 6);
    if (a === null || b === null || c === null || d === null) return Infinity;
    return Math.hypot(a - b, c - d) / 12;
  };

  // Streets: short draped segments along both grid directions.
  const road: [number, number, number] = [0.32, 0.33, 0.35];
  const seg = 24;
  for (let line = 0; line <= n; line++) {
    const fixed = -half + line * B;
    for (let s = -half; s < half; s += seg) {
      for (const horizontal of [true, false]) {
        const [u0, v0] = horizontal ? [s, fixed] : [fixed, s];
        const [u1, v1] = horizontal ? [s + seg, fixed] : [fixed, s + seg];
        const [x0, z0] = toWorld(u0, v0), [x1, z1] = toWorld(u1, v1);
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (Math.hypot(u0, v0) > half * 1.05 || blocked(mx, mz)) continue;
        const g0 = site.ground(x0, z0), g1 = site.ground(x1, z1);
        if (g0 === null || g1 === null || Math.abs(g1 - g0) > seg * 0.35) continue;
        const yaw = horizontal ? -theta : -theta - Math.PI / 2;
        add("box", road, [mx, (g0 + g1) / 2 - 0.05, mz, yaw, seg + 0.6, 0.25, street]);
      }
    }
  }

  // Landmarks go in the middle of their district's most central block.
  const landmarkBlocks = new Map<string, (typeof blocks)[number]>();
  for (const l of spec.landmarks) {
    const hit = assigned.find((a) => a.district.name === l.district && ![...landmarkBlocks.values()].includes(a.block)) ?? assigned.find((a) => ![...landmarkBlocks.values()].includes(a.block));
    if (hit) landmarkBlocks.set(l.name, hit.block);
  }

  const lot = B - street;
  for (const { block, district } of assigned) {
    const [bx, bz] = toWorld(block.u, block.v);
    const gy = site.ground(bx, bz);
    if (gy === null || blocked(bx, bz) || slopeAt(bx, bz) > 0.3) continue;
    const landmark = [...landmarkBlocks.entries()].find(([, b]) => b === block)?.[0];
    if (landmark) {
      const l = spec.landmarks.find((x) => x.name === landmark)!;
      placeLandmark(l.kind, bx, gy, bz, -theta, lot, walls, accent, add, colliders);
      places.push({ name: l.name, position: [+(bx + lot * 0.6).toFixed(1), +(gy + 1.7).toFixed(1), +(bz + lot * 0.6).toFixed(1)] });
      continue;
    }
    switch (district.use) {
      case "plaza": {
        add("box", [0.78, 0.76, 0.72], [bx, gy - 0.1, bz, -theta, lot, 0.3, lot]);
        add("cylinder", accent, [bx, gy + 0.2, bz, 0, 6, 0.8, 6], accent.map((c) => c * 0.25) as [number, number, number]);
        if (!places.some((p) => p.name === district.name)) places.push({ name: district.name, position: [+(bx + 8).toFixed(1), +(gy + 1.8).toFixed(1), +(bz + 8).toFixed(1)] });
        break;
      }
      case "park": {
        add("box", [0.27, 0.42, 0.2], [bx, gy - 0.12, bz, -theta, lot, 0.25, lot]);
        const trees = 6 + Math.floor(rand() * 8);
        for (let t = 0; t < trees; t++) {
          const [tx, tz] = toWorld(block.u + (rand() - 0.5) * lot * 0.85, block.v + (rand() - 0.5) * lot * 0.85);
          const ty = site.ground(tx, tz);
          if (ty === null) continue;
          const h = 7 + rand() * 6;
          add("cylinder", [0.32, 0.22, 0.14], [tx, ty, tz, 0, 0.5, h * 0.35, 0.5]);
          add("cone", spec.style === "tropical" ? [0.2, 0.45, 0.18] : [0.1, 0.26, 0.14], [tx, ty + h * 0.25, tz, 0, h * 0.45, h * 0.8, h * 0.45]);
        }
        break;
      }
      default: {
        // Building lots: 2x2 (dense) or 1-2 per block, sized by density and use.
        const per = spec.density === "high" ? 3 : spec.density === "medium" ? 2 : 2;
        const cell = lot / per;
        for (let a = 0; a < per; a++)
          for (let b = 0; b < per; b++) {
            if (spec.density === "low" && rand() < 0.35) continue;
            const [x, z] = toWorld(block.u - lot / 2 + (a + 0.5) * cell, block.v - lot / 2 + (b + 0.5) * cell);
            const y = site.ground(x, z);
            if (y === null || slopeAt(x, z) > 0.3 || blocked(x, z)) continue;
            placeBuilding(spec, district.use, x, y, z, -theta, cell * (0.62 + rand() * 0.18), rand, walls, roofs, accent, add, colliders);
          }
      }
    }
  }
  return { name: spec.name, spec: spec.slug, batches: [...batch.values()], colliders, places };
}

type Add = (shape: InstanceBatch["shape"], color: [number, number, number], t: number[], emissive?: [number, number, number]) => void;

function placeBuilding(spec: CitySpec, use: Use, x: number, y: number, z: number, yaw: number, size: number, rand: () => number, walls: [number, number, number], roofs: [number, number, number], accent: [number, number, number], add: Add, colliders: number[][]) {
  const w = size, d = size * (0.7 + rand() * 0.3);
  const vary = (c: [number, number, number]) => c.map((v) => Math.min(1, Math.max(0, v * (0.88 + rand() * 0.24)))) as [number, number, number];
  let h: number;
  if (spec.style === "alpine") {
    // Chalets: timber base, white upper floors, steep gable roof; commerce and the agent hub a bit taller.
    const floors = use === "residential" ? 2 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 3);
    h = floors * 3.1;
    add("box", vary(walls), [x, y, z, yaw, w, h, d]);
    add("box", [0.42, 0.29, 0.18], [x, y, z, yaw, w * 1.01, 3, d * 1.01]);
    add("gable", vary(roofs), [x, y + h, z, yaw, w * 1.18, Math.max(3, w * 0.45), d * 1.12]);
    if (use === "agent-hub") add("box", accent, [x, y + h * 0.5, z, yaw, w * 1.02, 0.5, d * 1.02], accent.map((c) => c * 0.6) as [number, number, number]);
  } else if (spec.style === "futurist") {
    const floors = use === "residential" ? 4 + Math.floor(rand() * 6) : 8 + Math.floor(rand() * 18);
    h = floors * 3.4;
    add("box", vary(walls), [x, y, z, yaw, w, h, d]);
    add("box", accent, [x, y + h, z, yaw, w * 0.6, 1.2, d * 0.6], accent.map((c) => c * 0.5) as [number, number, number]);
  } else {
    const floors = use === "residential" ? 1 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 4);
    h = floors * 3.2;
    add("box", vary(walls), [x, y, z, yaw, w, h, d]);
    add(spec.style === "tropical" ? "box" : "gable", vary(roofs), [x, y + h, z, yaw, w * 1.05, spec.style === "tropical" ? 0.5 : w * 0.3, d * 1.05]);
  }
  colliders.push([x, y + h / 2, z, w, h, d, yaw].map((v) => +v.toFixed(2)));
}

function placeLandmark(kind: CitySpec["landmarks"][number]["kind"], x: number, y: number, z: number, yaw: number, lot: number, walls: [number, number, number], accent: [number, number, number], add: Add, colliders: number[][]) {
  const glow = accent.map((c) => c * 0.4) as [number, number, number];
  const glass: [number, number, number] = [0.55, 0.7, 0.78];
  switch (kind) {
    case "hall": {
      const w = lot * 0.85, d = lot * 0.6, h = 16;
      add("box", walls, [x, y, z, yaw, w, h, d]);
      add("box", glass, [x, y + 2, z, yaw, w * 1.01, 9, d * 0.5]);
      add("box", accent, [x, y + h, z, yaw, w * 1.04, 1.2, d * 1.04], glow);
      colliders.push([x, y + h / 2, z, w, h, d, yaw]);
      break;
    }
    case "dome": {
      const r = lot * 0.38;
      add("cylinder", walls, [x, y, z, 0, r * 2, 6, r * 2]);
      add("dome", glass, [x, y + 6, z, 0, r * 2, r * 1.2, r * 2]);
      add("cylinder", accent, [x, y + 6 + r * 1.15, z, 0, 2, 3, 2], glow);
      colliders.push([x, y + 3, z, r * 2, 6, r * 2, 0]);
      break;
    }
    case "tower": {
      const w = lot * 0.28, h = 90;
      add("box", glass, [x, y, z, yaw, w, h, w]);
      add("box", walls, [x, y, z, yaw, w * 1.4, 8, w * 1.4]);
      add("box", accent, [x, y + h, z, yaw, w * 0.7, 6, w * 0.7], glow);
      colliders.push([x, y + h / 2, z, w * 1.4, h, w * 1.4, yaw]);
      break;
    }
    case "pavilion": {
      const w = lot * 0.6;
      add("box", walls, [x, y, z, yaw, w, 0.6, w]);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
        add("cylinder", walls, [x + a * w * 0.42, y, z + b * w * 0.42, 0, 0.8, 7, 0.8]);
      add("box", accent, [x, y + 7, z, yaw, w * 1.1, 0.8, w * 1.1], glow);
      colliders.push([x, y + 0.3, z, w, 0.6, w, yaw]);
      break;
    }
    case "arena": {
      const r = lot * 0.45;
      add("cylinder", walls, [x, y, z, 0, r * 2, 14, r * 2]);
      add("cylinder", [0.27, 0.45, 0.22], [x, y + 0.2, z, 0, r * 1.5, 0.5, r * 1.5]);
      colliders.push([x, y + 7, z, r * 2, 14, r * 2, 0]);
      break;
    }
  }
}
