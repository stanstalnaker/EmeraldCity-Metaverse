/**
 * The map (M): a live, north-up map of the world you're in, for every world.
 *  - Emerald City: the city map, lined up with the world (it covers the terrain's ±1,810 m square),
 *    so its radial streets, villa rows, boulevards and plazas show as drawn.
 *  - Worlds with terrain (Davos, Bermuda): shaded relief with sea and lakes, and, where a real town is
 *    mapped (Davos), its streets, buildings, railway and river.
 *  - On top: portals (with where they go), Hub Culture pavilions, landmarks and properties, other
 *    people and agents, and you (an arrow pointing the way you face). Click a marker to go there.
 */
import type { UniversalCamera } from "@babylonjs/core";
import type { OsmTown } from "@emerald-city/world";

export interface MapMarker {
  label: string;
  x: number;
  z: number;
  kind: "portal" | "pavilion" | "landmark" | "property" | "stop";
  /** Icon image for the list (Emerald City's legacy icons), optional. */
  icon?: string;
  go: () => void;
}

export interface MapSetup {
  camera: UniversalCamera;
  worldName: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  baseImage?: string;
  ground?: ((x: number, z: number) => number | null) | null;
  waterY?: number | null;
  town?: OsmTown | null;
  markers: MapMarker[];
  /** Terrain palette: alpine (meadow, rock, snow) or tropical (sand, green, rock). */
  style?: "alpine" | "tropical" | "temperate";
  /** Everyone else in this world now (presence), for dots on the map. */
  others?: () => { x: number; z: number; kind: "human" | "agent" }[];
}

const SIZE = 900;
const COLOURS = {
  portal: "#4fe3cc",
  pavilion: "#00a58f",
  landmark: "#eaf2ff",
  property: "#1668bd",
  stop: "#eaf2ff",
  you: "#ffffff",
  human: "#1668bd",
  agent: "#1295a2",
};

export function setupMap(o: MapSetup) {
  const $ = (id: string) => document.getElementById(id)!;
  const overlay = $("map");
  const canvas = $("map-canvas") as HTMLCanvasElement;
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const { minX, maxX, minZ, maxZ } = o.bounds;
  const px = (x: number) => ((x - minX) / (maxX - minX)) * SIZE;
  const py = (z: number) => ((maxZ - z) / (maxZ - minZ)) * SIZE; // north up
  const mPerPx = (maxX - minX) / SIZE;

  $("map-world").textContent = o.worldName;
  $("map-btn").style.display = "";

  // ---- the base, drawn once
  const base = document.createElement("canvas");
  base.width = base.height = SIZE;
  const b = base.getContext("2d")!;
  b.fillStyle = "#02060f";
  b.fillRect(0, 0, SIZE, SIZE);
  let baseReady = false;
  const drawTown = () => {
    if (!o.town) return;
    b.lineCap = b.lineJoin = "round";
    for (const r of o.town.rivers) {
      b.strokeStyle = "#2f7fa3";
      b.lineWidth = Math.max(1, r.w / mPerPx);
      line(b, r.p);
    }
    for (const r of o.town.roads) {
      const minor = r.w < 3;
      b.strokeStyle = minor ? "rgba(234,242,255,.28)" : "rgba(234,242,255,.85)";
      b.lineWidth = Math.max(minor ? 0.7 : 1.4, r.w / mPerPx);
      line(b, r.p);
    }
    b.strokeStyle = "rgba(200,170,120,.8)";
    b.setLineDash([4, 3]);
    b.lineWidth = 1.5;
    for (const l of o.town.rail) line(b, l);
    b.setLineDash([]);
    b.fillStyle = "rgba(170,182,205,.75)";
    for (const bd of o.town.buildings) {
      b.beginPath();
      bd.ring.forEach(([x, z], i) => (i ? b.lineTo(px(x), py(z)) : b.moveTo(px(x), py(z))));
      b.closePath();
      b.fill();
    }
  };
  function line(g: CanvasRenderingContext2D, pts: [number, number][]) {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), py(z)) : g.moveTo(px(x), py(z))));
    g.stroke();
  }
  if (o.baseImage) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      b.drawImage(img, 0, 0, SIZE, SIZE);
      baseReady = true;
      draw();
    };
    img.src = o.baseImage;
  } else if (o.ground) {
    // Shaded relief: sea and lakes below the water line, meadow to rock to snow above it.
    const N = 180, cell = SIZE / N;
    const hs: number[] = [];
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const h = o.ground(minX + ((i + 0.5) / N) * (maxX - minX), maxZ - ((j + 0.5) / N) * (maxZ - minZ)) ?? NaN;
        hs.push(h);
        if (Number.isFinite(h)) (lo = Math.min(lo, h)), (hi = Math.max(hi, h));
      }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const h = hs[j * N + i]!;
        if (!Number.isFinite(h)) continue;
        const wet = o.waterY != null && h < o.waterY;
        const t = (h - lo) / Math.max(1, hi - lo);
        const east = hs[j * N + Math.min(N - 1, i + 1)]!, north = hs[Math.max(0, j - 1) * N + i]!;
        const shade = Number.isFinite(east) && Number.isFinite(north) ? Math.max(-0.25, Math.min(0.25, ((h - east) + (north - h)) / (mPerPx * cell) * 0.8)) : 0;
        const sea = o.waterY ?? -Infinity;
        const c = wet
          ? [22, 70, 104]
          : o.style === "tropical"
            ? h < sea + 1.2 ? [196, 182, 140] : t < 0.6 ? [62, 110, 58] : [84, 96, 70]
            : t < 0.45 ? [58, 92, 52] : t < 0.75 ? [96, 102, 84] : [210, 216, 224];
        b.fillStyle = `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v * (1 + shade))))).join(",")})`;
        b.fillRect(i * cell, j * cell, cell + 0.6, cell + 0.6);
      }
    drawTown();
    baseReady = true;
  } else {
    drawTown();
    baseReady = true;
  }

  // ---- markers and you
  let hovered: MapMarker | null = null;
  const draw = () => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (baseReady) ctx.drawImage(base, 0, 0);
    for (const p of o.others?.() ?? []) {
      ctx.fillStyle = COLOURS[p.kind];
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    for (const m of o.markers) {
      const x = px(m.x), y = py(m.z);
      if (x < -20 || y < -20 || x > SIZE + 20 || y > SIZE + 20) continue;
      ctx.lineWidth = 2;
      if (m.kind === "portal") {
        ctx.strokeStyle = COLOURS.portal;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = COLOURS.portal;
        ctx.fill();
      } else {
        ctx.fillStyle = COLOURS[m.kind];
        ctx.strokeStyle = "#02060f";
        ctx.beginPath();
        if (m.kind === "pavilion") ctx.rect(x - 6, y - 6, 12, 12);
        else ctx.arc(x, y, m.kind === "property" ? 5 : 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      const show = m.kind === "portal" || m.kind === "pavilion" || m === hovered;
      if (show) label(m.label, x + 11, y + 4, m.kind === "portal" ? COLOURS.portal : "#eaf2ff");
    }
    // You: an arrow the way you face.
    const c = o.camera;
    const x = px(c.position.x), y = py(c.position.z), a = c.rotation.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = COLOURS.you;
    ctx.strokeStyle = "#02060f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  function label(text: string, x: number, y: number, colour: string) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(2,6,15,.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  const at = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE, y = ((e.clientY - r.top) / r.height) * SIZE;
    let best: MapMarker | null = null, bestD = 16;
    for (const m of o.markers) {
      const d = Math.hypot(px(m.x) - x, py(m.z) - y);
      if (d < bestD) (bestD = d), (best = m);
    }
    return best;
  };
  canvas.onmousemove = (e) => {
    const m = at(e);
    if (m !== hovered) {
      hovered = m;
      canvas.style.cursor = m ? "pointer" : "default";
      canvas.title = m ? `Go to ${m.label}` : "";
      draw();
    }
  };
  canvas.onclick = (e) => {
    const m = at(e);
    if (!m) return;
    close();
    m.go();
  };

  // ---- the list beside the map
  const order: MapMarker["kind"][] = ["portal", "pavilion", "stop", "landmark", "property"];
  const listed = [...o.markers].sort((a, z) => order.indexOf(a.kind) - order.indexOf(z.kind));
  $("map-stops").innerHTML = listed
    .map((m, i) => `<button data-i="${i}" title="Go to ${esc(m.label)}">${m.icon ? `<img src="${m.icon}" alt="">` : `<i class="map-dot ${m.kind}"></i>`}<span>${esc(m.label)}</span></button>`)
    .join("");
  $("map-stops").onclick = (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    close();
    listed[Number(btn.dataset.i)]!.go();
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const nearest = () => {
    let best: MapMarker | null = null, d = Infinity;
    for (const m of o.markers) {
      const dd = Math.hypot(o.camera.position.x - m.x, o.camera.position.z - m.z);
      if (dd < d) (d = dd), (best = m);
    }
    $("map-near").textContent = best ? (d < 60 ? `You're at ${best.label}.` : `You're ${Math.round(d)} m from ${best.label}.`) : "";
  };
  const open = () => {
    nearest();
    draw();
    overlay.style.display = "flex";
    timer = setInterval(draw, 500);
  };
  const close = () => {
    overlay.style.display = "none";
    if (timer) clearInterval(timer);
    timer = null;
  };
  $("map-btn").onclick = () => (overlay.style.display === "flex" ? close() : open());
  $("map-close").onclick = close;
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "m" || e.key === "M") overlay.style.display === "flex" ? close() : open();
  });
  return { open, close };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
