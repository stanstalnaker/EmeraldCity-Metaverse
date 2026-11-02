/**
 * Starter topography for a new virtual city. When a partner launches a city it arrives as an
 * island with a coastline, a river (sometimes with a tributary), a ring road and avenues, a dense
 * core grid, a skewed suburban grid, farm tracks and a reserved central park. Partners then edit
 * the street plan; parcels are always cut with the platform rules (cut.ts).
 *
 * Deterministic: the city slug is the seed, so the same slug always produces the same plan.
 */
import type { CityLayers } from "./cut";
import type { PolygonRings, Ring, XY } from "./geom";
import { Random } from "./random";

export interface StarterOptions {
  /** Average island radius in metres. */
  radius?: number;
}

export interface StarterPlan {
  seed: string;
  layers: CityLayers;
  /** City centre (metres), where the core grid and park sit. */
  core: XY;
}

const TAU = Math.PI * 2;

export function generateStarterCity(slug: string, opts: StarterOptions = {}): StarterPlan {
  const r = new Random(`emerald-city/starter/${slug}`);
  const R = opts.radius ?? 3000;
  const coast = island(r, R);
  const core: XY = [r.uniform(-0.13, 0.13) * R, r.uniform(-0.13, 0.13) * R];

  // River coast to coast, sometimes with a tributary joining midway.
  const a = r.uniform(0, TAU);
  const river = meander(r, coastPoint(coast, a), coastPoint(coast, a + Math.PI + r.uniform(-0.6, 0.6)), 40, 180);
  const rivers = [river];
  if (r.chance(0.6)) {
    const mid = river[Math.floor(river.length * r.uniform(0.3, 0.7))]!;
    rivers.push(meander(r, coastPoint(coast, a + r.uniform(0.9, 2.2)), mid, 25, 120));
  }

  // Major roads: ring road plus 4–6 avenues from the core to the coast.
  const majors: Ring[] = [circle(core, r.uniform(0.3, 0.43) * R, 64)];
  const avenues = r.int(4, 6);
  for (let i = 0; i < avenues; i++) {
    const ang = (TAU * i) / avenues + r.uniform(-0.25, 0.25);
    majors.push(meander(r, core, coastPoint(coast, ang), 20, 60));
  }

  // Local streets: dense core grid, then a wider suburban grid at a skewed angle.
  const locals: Ring[] = [];
  const coreRadius = 0.53 * R;
  const rot = r.uniform(0, 90);
  locals.push(...grid(core, rot, r.uniform(90, 150), coreRadius, 0));
  const suburbRadius = r.uniform(0.77, 0.93) * R;
  locals.push(...grid(core, rot + r.uniform(-25, 25), r.uniform(260, 380), suburbRadius, coreRadius));

  // Farm tracks in the countryside (they become borders only inside large parcels).
  const tracks: Ring[] = [];
  const nTracks = r.int(10, 16);
  for (let i = 0; i < nTracks; i++) {
    const ang = r.uniform(0, TAU);
    const d = r.uniform(0.6, 1.07) * R;
    const from: XY = [core[0] + d * Math.cos(ang), core[1] + d * Math.sin(ang)];
    tracks.push(meander(r, from, [from[0] + r.uniform(-900, 900), from[1] + r.uniform(-900, 900)], 8, 80));
  }

  const parkCentre: XY = [core[0] + r.uniform(-0.23, 0.23) * R, core[1] + r.uniform(-0.23, 0.23) * R];
  const park: PolygonRings = [circle(parkCentre, r.uniform(180, 320), 24)];

  return {
    seed: slug,
    core,
    layers: {
      land: [[coast]],
      roads: [
        ...majors.map((line) => ({ line, cls: "major" as const })),
        ...locals.map((line) => ({ line, cls: "local" as const })),
        ...tracks.map((line) => ({ line, cls: "track" as const })),
      ],
      water: { lines: rivers.map((line) => ({ line, cls: "river" as const })), areas: [] },
      borders: [],
      reserved: [{ rings: park, reason: "park" }],
    },
  };
}

function island(r: Random, R: number): Ring {
  const k = [0, 0, 0, 0].map(() => r.uniform(0, TAU)) as [number, number, number, number];
  const pts: Ring = [];
  for (let i = 0; i < 96; i++) {
    const a = (TAU * i) / 96;
    const rad =
      R * (1 + 0.18 * Math.sin(2 * a + k[0]) + 0.1 * Math.sin(3 * a + k[1]) + 0.06 * Math.sin(5 * a + k[2]) + 0.03 * Math.sin(9 * a + k[3]));
    pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }
  pts.push(pts[0]!);
  return pts;
}

/** Point where a ray from the origin crosses the coastline. */
function coastPoint(coast: Ring, angle: number): XY {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: XY = coast[0]!;
  let bestT = -1;
  for (let i = 0; i < coast.length - 1; i++) {
    const [x1, y1] = coast[i]!;
    const [x2, y2] = coast[i + 1]!;
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (x1 * ey - y1 * ex) / den;
    const u = (x1 * dy - y1 * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t > bestT) {
      bestT = t;
      best = [dx * t, dy * t];
    }
  }
  return best;
}

function meander(r: Random, [x0, y0]: XY, [x1, y1]: XY, steps: number, wiggle: number): Ring {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  let off = 0;
  const pts: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    off = 0.75 * off + r.uniform(-wiggle, wiggle) * Math.sin(Math.PI * t);
    pts.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
  }
  return pts;
}

function circle([cx, cy]: XY, radius: number, n: number): Ring {
  const pts: Ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (TAU * i) / n;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

/** Grid streets (two perpendicular families) clipped to the annulus inner..outer around a centre. */
function grid([cx, cy]: XY, rotationDeg: number, spacing: number, outer: number, inner: number): Ring[] {
  const th = (rotationDeg * Math.PI) / 180;
  const [ux, uy] = [Math.cos(th), Math.sin(th)];
  const [vx, vy] = [-uy, ux];
  const out: Ring[] = [];
  const n = Math.ceil(outer / spacing);
  for (const [ax, ay, bx, by] of [[ux, uy, vx, vy], [vx, vy, ux, uy]] as const) {
    for (let k = -n; k <= n; k++) {
      const off = k * spacing;
      const half = Math.sqrt(Math.max(0, outer * outer - off * off));
      if (half <= 0) continue;
      const at = (s: number): XY => [cx + bx * off + ax * s, cy + by * off + ay * s];
      if (Math.abs(off) >= inner) out.push([at(-half), at(half)]);
      else {
        // Skip the inner disc: two segments either side of it.
        const gap = Math.sqrt(inner * inner - off * off);
        out.push([at(-half), at(-gap)], [at(gap), at(half)]);
      }
    }
  }
  return out;
}
