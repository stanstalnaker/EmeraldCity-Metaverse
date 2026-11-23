/**
 * A real town from OpenStreetMap (Davos): buildings extruded from their footprints with windows and
 * pitched or flat roofs, and streets, railway and river laid on the terrain.
 *
 * Geometry is merged per 250 m chunk (walls, roofs and ways separately), so the town costs a few
 * dozen draw calls, frustum culling still works, and collisions only test nearby chunks.
 * Map data © OpenStreetMap contributors, ODbL (credited in the world's attribution).
 */
import { Color3, DynamicTexture, Mesh, PBRMaterial, Texture, VertexData, type Scene } from "@babylonjs/core";
import earcut from "earcut";
import type { OsmBuilding, OsmTown } from "@emerald-city/world";

type Ground = (x: number, z: number) => number;

const CHUNK = 250;
const ROOF_PITCH = Math.tan((22 * Math.PI) / 180); // Davos roofs are low: snow stays on as insulation
const STOREY = 3.0;
const BAY = 3.2;

/** Plaster and timber the town is built of (wall colours), and roof tiles and sheet metal. */
const WALLS: [number, number, number][] = [
  [0.93, 0.91, 0.86], [0.96, 0.95, 0.92], [0.92, 0.85, 0.68], [0.86, 0.86, 0.84], [0.92, 0.86, 0.78], [0.84, 0.8, 0.72],
  [0.9, 0.81, 0.76], [0.82, 0.85, 0.8], [0.95, 0.9, 0.74], [0.8, 0.78, 0.76],
];
const TIMBER: [number, number, number] = [0.55, 0.4, 0.27];
const ROOFS: [number, number, number][] = [[0.27, 0.27, 0.29], [0.33, 0.3, 0.28], [0.22, 0.23, 0.25], [0.38, 0.33, 0.29]];
const FLAT_ROOF: [number, number, number] = [0.5, 0.5, 0.5];
const HUB_ROOF: [number, number, number] = [0.0, 0.55, 0.47]; // the Emerald City stone: Hub Culture pavilions read from the slopes
const WAYS: Record<string, [number, number, number]> = {
  motorway: [0.22, 0.22, 0.23], trunk: [0.22, 0.22, 0.23], primary: [0.24, 0.24, 0.25], secondary: [0.25, 0.25, 0.26],
  tertiary: [0.27, 0.27, 0.28], unclassified: [0.29, 0.29, 0.3], residential: [0.29, 0.29, 0.3], living_street: [0.33, 0.32, 0.31],
  service: [0.32, 0.32, 0.32], pedestrian: [0.58, 0.55, 0.5], footway: [0.6, 0.56, 0.48], path: [0.5, 0.49, 0.4],
  steps: [0.55, 0.53, 0.5], cycleway: [0.42, 0.35, 0.34], track: [0.47, 0.46, 0.37],
};

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  vertex(x: number, y: number, z: number, n: [number, number, number], c: [number, number, number], u = 0, v = 0) {
    this.positions.push(x, y, z);
    this.normals.push(...n);
    this.colors.push(c[0], c[1], c[2], 1);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  /** A flat quad or triangle fan with one normal; both windings are drawn (backFaceCulling off). */
  face(pts: [number, number, number][], n: [number, number, number], c: [number, number, number], uv?: [number, number][]) {
    const base = pts.map((p, i) => this.vertex(p[0], p[1], p[2], n, c, uv?.[i]?.[0] ?? 0, uv?.[i]?.[1] ?? 0));
    for (let i = 1; i < base.length - 1; i++) this.indices.push(base[0]!, base[i]!, base[i + 1]!);
  }

  mesh(name: string, scene: Scene): Mesh | null {
    if (!this.indices.length) return null;
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = this.colors;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    vd.applyToMesh(m);
    m.isPickable = false;
    m.freezeWorldMatrix();
    return m;
  }
}

/** Repeating facade bay: plaster with one window (frame, glass, a lighter sill). */
function facadeTexture(scene: Scene): Texture {
  const t = new DynamicTexture("town-facade", { width: 128, height: 128 }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#d9d4ca"; // frame
  g.fillRect(36, 30, 56, 64);
  g.fillStyle = "#3b4652"; // glass
  g.fillRect(41, 35, 46, 54);
  g.fillStyle = "#6d7a86"; // sky in the upper panes
  g.fillRect(41, 35, 46, 20);
  g.fillStyle = "#c9c2b6"; // sill
  g.fillRect(32, 94, 64, 5);
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  return t;
}

function hash(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Minimum-area rectangle around a footprint (tested along each edge's direction). */
function orientedBox(ring: [number, number][]) {
  let best = { area: Infinity, ux: 1, uz: 0, cx: 0, cz: 0, hu: 0, hv: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = { area, ux, uz, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, hu: (maxU - minU) / 2, hv: (maxV - minV) / 2 };
    }
  }
  // Ridge along the long side.
  if (best.hv > best.hu) best = { ...best, ux: -best.uz, uz: best.ux, hu: best.hv, hv: best.hu };
  return best;
}

function polygonArea(ring: [number, number][]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function addBuilding(b: OsmBuilding, ground: Ground, walls: Builder, roofs: Builder) {
  const ring = b.ring;
  const gs = ring.map(([x, z]) => ground(x, z));
  const minG = Math.min(...gs), maxG = Math.max(...gs);
  const base = minG - 0.6; // into the slope, so no gap shows on the downhill side
  // On a slope the downhill side shows a storey or so more; cap it so hillside houses don't become towers.
  const top = minG + b.h + Math.min(maxG - minG, 3);
  const r = hash(b.id);
  const bay = BAY * (0.85 + 0.45 * hash(b.id + 3)); // window spacing differs from house to house
  const storey = STOREY * (0.95 + 0.12 * hash(b.id + 5));
  const timber = b.roof === "pitched" && b.h < 9 && r < 0.35;
  const wall = b.hub ? [0.96, 0.96, 0.94] as [number, number, number] : timber ? TIMBER : WALLS[Math.floor(r * WALLS.length)]!;

  // Walls: one quad per edge, windows by storey and bay (u along the facade, v up).
  let run = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]!, [x1, z1] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) continue;
    const n: [number, number, number] = [(z1 - z0) / len, 0, -(x1 - x0) / len]; // outward for a counter-clockwise ring
    const u0 = run / bay, u1 = (run + len) / bay;
    run += len;
    // v: storeys from the lowest ground, so window rows line up all round the building
    walls.face(
      [[x0, base, z0], [x1, base, z1], [x1, top, z1], [x0, top, z0]], n, wall,
      [[u0, (base - minG) / storey], [u1, (base - minG) / storey], [u1, (top - minG) / storey], [u0, (top - minG) / storey]],
    );
  }

  const box = orientedBox(ring);
  const rectangular = polygonArea(ring) / (4 * box.hu * box.hv) > 0.72 && ring.length <= 10 && box.hv > 2;
  const roofColour = b.hub ? HUB_ROOF : b.roof === "flat" ? FLAT_ROOF : ROOFS[Math.floor(hash(b.id + 7) * ROOFS.length)]!;
  if (b.roof === "pitched" && rectangular) {
    const o = 0.5; // eaves overhang
    const hu = box.hu + o, hv = box.hv + o;
    const rise = Math.min(box.hv * ROOF_PITCH, 6);
    const P = (su: number, sv: number, y: number): [number, number, number] => [
      box.cx + box.ux * su * hu - box.uz * sv * hv, y, box.cz + box.uz * su * hu + box.ux * sv * hv,
    ];
    const eave = top - 0.15;
    const A = P(-1, -1, eave), B = P(1, -1, eave), C = P(1, 1, eave), D = P(-1, 1, eave);
    const R1: [number, number, number] = [box.cx - box.ux * hu, top + rise, box.cz - box.uz * hu];
    const R2: [number, number, number] = [box.cx + box.ux * hu, top + rise, box.cz + box.uz * hu];
    const slope = Math.hypot(hv, rise);
    roofs.face([A, B, R2, R1], [box.uz * rise / slope, hv / slope, -box.ux * rise / slope], roofColour);
    roofs.face([D, C, R2, R1], [-box.uz * rise / slope, hv / slope, box.ux * rise / slope], roofColour);
    // Gable ends in the wall colour (no windows: v kept inside the plain band of the texture).
    walls.face([P(-1, -1, top), P(-1, 1, top), [R1[0], R1[1], R1[2]]], [-box.ux, 0, -box.uz], wall, [[0.05, 0.05], [0.1, 0.05], [0.07, 0.15]]);
    walls.face([P(1, -1, top), P(1, 1, top), [R2[0], R2[1], R2[2]]], [box.ux, 0, box.uz], wall, [[0.05, 0.05], [0.1, 0.05], [0.07, 0.15]]);
  } else {
    const flat: number[] = [];
    for (const [x, z] of ring) flat.push(x, z);
    const tris = earcut(flat);
    const idx = ring.map(([x, z]) => roofs.vertex(x, top, z, [0, 1, 0], roofColour));
    for (const t of tris) roofs.indices.push(idx[t]!);
  }
}

/** A ribbon along a polyline, draped on the ground. */
function addWay(out: Builder, pts: [number, number][], width: number, colour: [number, number, number], lift: number, ground: Ground, step: number) {
  // Densify, so the ribbon follows the terrain between OSM nodes.
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i]!, [x1, z1] = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 0; k < n; k++) dense.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  dense.push(pts[pts.length - 1]!);
  if (dense.length < 2) return;
  const half = width / 2;
  let prevL = -1, prevR = -1;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[Math.max(0, i - 1)]!, b = dense[Math.min(dense.length - 1, i + 1)]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
    const [x, z] = dense[i]!;
    const lx = x + nx * half, lz = z + nz * half, rx = x - nx * half, rz = z - nz * half;
    const L = out.vertex(lx, ground(lx, lz) + lift, lz, [0, 1, 0], colour);
    const R = out.vertex(rx, ground(rx, rz) + lift, rz, [0, 1, 0], colour);
    if (prevL >= 0) out.indices.push(prevL, prevR, L, L, prevR, R);
    prevL = L;
    prevR = R;
  }
}

export function buildTown(scene: Scene, town: OsmTown, ground: Ground): Mesh[] {
  const chunks = new Map<string, { walls: Builder; roofs: Builder; ways: Builder; water: Builder }>();
  const chunk = (x: number, z: number) => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { walls: new Builder(), roofs: new Builder(), ways: new Builder(), water: new Builder() }));
    return c;
  };

  for (const b of town.buildings) {
    const [x, z] = b.ring[0]!;
    const c = chunk(x, z);
    addBuilding(b, ground, c.walls, c.roofs);
  }
  for (const r of town.roads) {
    const [x, z] = r.p[0]!;
    const minor = r.w < 3;
    addWay(chunk(x, z).ways, r.p, r.w, WAYS[r.c] ?? WAYS.residential!, minor ? 0.1 : 0.14, ground, minor ? 8 : 5);
  }
  for (const line of town.rail) {
    const [x, z] = line[0]!;
    addWay(chunk(x, z).ways, line, 3.2, [0.34, 0.31, 0.28], 0.16, ground, 5);
  }
  for (const river of town.rivers) {
    const [x, z] = river.p[0]!;
    addWay(chunk(x, z).water, river.p, river.w, [0.16, 0.33, 0.39], 0.06, ground, 5);
  }

  const facade = facadeTexture(scene);
  const mat = (name: string, opts: { texture?: Texture; roughness?: number; zOffset?: number } = {}) => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.White();
    if (opts.texture) m.albedoTexture = opts.texture;
    m.metallic = 0;
    m.roughness = opts.roughness ?? 0.85;
    m.backFaceCulling = false;
    if (opts.zOffset) m.zOffset = opts.zOffset;
    return m;
  };
  const wallMat = mat("town-walls", { texture: facade });
  const roofMat = mat("town-roofs", { roughness: 0.7 });
  const wayMat = mat("town-ways", { roughness: 0.95, zOffset: -2 });
  const waterMat = mat("town-water", { roughness: 0.08, zOffset: -2 });

  const meshes: Mesh[] = [];
  for (const [key, c] of chunks) {
    const w = c.walls.mesh(`town-walls-${key}`, scene);
    if (w) {
      w.material = wallMat;
      w.checkCollisions = true; // walk along streets, not through houses
      meshes.push(w);
    }
    const r = c.roofs.mesh(`town-roofs-${key}`, scene);
    if (r) {
      r.material = roofMat;
      r.checkCollisions = true;
      meshes.push(r);
    }
    const ways = c.ways.mesh(`town-ways-${key}`, scene);
    if (ways) {
      ways.material = wayMat;
      meshes.push(ways);
    }
    const water = c.water.mesh(`town-river-${key}`, scene);
    if (water) {
      water.material = waterMat;
      meshes.push(water);
    }
  }
  return meshes;
}
