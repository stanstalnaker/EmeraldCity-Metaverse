/**
 * How agents find their way: a walking graph built from a world's real streets and paths
 * (OpenStreetMap, see packages/world), A* over it, and a walker that moves along the route at
 * walking pace. Places come from the world manifest (pavilions, landmarks, arrival points), so an
 * agent can be told "go to the ICON" rather than given coordinates.
 */
import type { OsmTown, WorldManifest } from "@emerald-city/world";

export type XZ = [number, number];

export interface Place {
  id: string;
  label: string;
  x: number;
  z: number;
  /** "pavilion" (Hub Culture), "landmark", "arrival", "portal". */
  kind: string;
}

/** Ways agents walk on (not tracks up the mountain or motorways). */
const WALKABLE = new Set([
  "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service", "footway", "path", "steps", "cycleway",
]);

export class StreetGraph {
  private readonly nodes: XZ[] = [];
  private readonly edges: { to: number; d: number }[][] = [];
  private readonly index = new Map<string, number>();
  private readonly cell = 40;
  private readonly grid = new Map<string, number[]>();

  /** Snap tolerance: OSM ways share nodes, so 0.5 m is enough to join them. */
  private node(p: XZ): number {
    const key = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.nodes.length;
      this.nodes.push(p);
      this.edges.push([]);
      this.index.set(key, i);
      const g = `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`;
      (this.grid.get(g) ?? this.grid.set(g, []).get(g)!).push(i);
    }
    return i;
  }

  static fromTown(town: OsmTown): StreetGraph {
    const g = new StreetGraph();
    for (const r of town.roads) {
      if (!WALKABLE.has(r.c)) continue;
      for (let k = 0; k < r.p.length - 1; k++) {
        const a = g.node(r.p[k]!), b = g.node(r.p[k + 1]!);
        if (a === b) continue;
        const d = Math.hypot(r.p[k + 1]![0] - r.p[k]![0], r.p[k + 1]![1] - r.p[k]![1]);
        g.edges[a]!.push({ to: b, d });
        g.edges[b]!.push({ to: a, d });
      }
    }
    return g;
  }

  get size() {
    return this.nodes.length;
  }

  nearest(p: XZ): { i: number; d: number } | null {
    let best: { i: number; d: number } | null = null;
    const cx = Math.floor(p[0] / this.cell), cz = Math.floor(p[1] / this.cell);
    for (let r = 0; r <= 4 && !best; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          for (const i of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            const d = Math.hypot(this.nodes[i]![0] - p[0], this.nodes[i]![1] - p[1]);
            if (!best || d < best.d) best = { i, d };
          }
        }
    }
    return best;
  }

  /**
   * A walking route from `from` to `to`: straight to the nearest street, along the streets (A*),
   * then straight to the destination. Falls back to a straight line when the streets don't connect.
   */
  route(from: XZ, to: XZ): XZ[] {
    const direct = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const a = this.nearest(from), b = this.nearest(to);
    if (!a || !b || direct < a.d + b.d + 10) return [from, to];
    const open = new Map<number, number>([[a.i, this.h(a.i, b.i)]]);
    const g = new Map<number, number>([[a.i, 0]]);
    const came = new Map<number, number>();
    let guard = 0;
    while (open.size && guard++ < 200_000) {
      let cur = -1, best = Infinity;
      for (const [i, f] of open) if (f < best) (best = f), (cur = i);
      if (cur === b.i) {
        const path: XZ[] = [to];
        for (let i: number | undefined = cur; i !== undefined; i = came.get(i)) path.push(this.nodes[i]!);
        path.push(from);
        return simplifyPath(path.reverse());
      }
      open.delete(cur);
      for (const e of this.edges[cur]!) {
        const cost = g.get(cur)! + e.d;
        if (cost < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, cost);
          came.set(e.to, cur);
          open.set(e.to, cost + this.h(e.to, b.i));
        }
      }
    }
    return [from, to];
  }

  private h(i: number, j: number) {
    return Math.hypot(this.nodes[i]![0] - this.nodes[j]![0], this.nodes[i]![1] - this.nodes[j]![1]);
  }
}

function simplifyPath(p: XZ[]): XZ[] {
  return p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1]![0], q[1] - p[i - 1]![1]) > 0.3);
}

export function routeLength(path: XZ[]) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  return d;
}

/** Moves along a route at a steady pace; `step` returns where the walker is and which way it faces. */
export class Walker {
  private seg = 0;
  private along = 0;
  constructor(private readonly path: XZ[], private readonly speed = 1.4) {}

  get done() {
    return this.seg >= this.path.length - 1;
  }

  step(dt: number): { x: number; z: number; heading: number; done: boolean } {
    let left = dt * this.speed;
    while (!this.done) {
      const a = this.path[this.seg]!, b = this.path[this.seg + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (this.along + left < len) {
        this.along += left;
        break;
      }
      left -= len - this.along;
      this.seg++;
      this.along = 0;
    }
    const a = this.path[Math.min(this.seg, this.path.length - 1)]!;
    const b = this.path[Math.min(this.seg + 1, this.path.length - 1)]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = this.done ? 1 : this.along / len;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, heading: Math.atan2(b[0] - a[0], b[1] - a[1]), done: this.done };
  }
}

/** Named places agents can be sent to, from the world manifest. */
export function placesOf(world: WorldManifest): Place[] {
  const out: Place[] = [];
  for (const p of world.pavilions ?? []) {
    const t = world.teleports.find((tp) => tp.id === p.id);
    // Stand at the door (the teleport spot), not in the middle of the building.
    out.push({ id: p.id, label: p.label, x: t?.position.x ?? p.position[0], z: t?.position.z ?? p.position[2], kind: "pavilion" });
  }
  for (const t of world.teleports) {
    if (out.some((p) => p.id === t.id) || t.group !== "kiosk") continue;
    out.push({ id: t.id, label: t.label, x: t.position.x, z: t.position.z, kind: "landmark" });
  }
  out.push({ id: "arrival", label: "Arrival", x: world.defaultSpawn.position.x, z: world.defaultSpawn.position.z, kind: "arrival" });
  for (const p of world.portals ?? []) out.push({ id: `portal:${p.to}`, label: `Portal to ${p.label}`, x: p.position[0], z: p.position[2], kind: "portal" });
  return out;
}

/** A place by id or by (part of) its label, case-insensitive: "icon" finds "The ICON · Symondsstrasse 7". */
export function findPlace(places: Place[], q: string): Place | undefined {
  const s = q.trim().toLowerCase();
  const short = (id: string) => id.toLowerCase().replace(/^[a-z]+:/, "").replace(/^hub-/, "");
  return (
    places.find((p) => p.id.toLowerCase() === s) ??
    places.find((p) => short(p.id) === s) ??
    places.find((p) => p.label.toLowerCase().includes(s)) ??
    places.find((p) => short(p.id).includes(s))
  );
}
