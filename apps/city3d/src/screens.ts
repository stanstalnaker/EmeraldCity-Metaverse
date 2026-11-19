import {
  Color3,
  DynamicTexture,
  InstancedMesh,
  Mesh,
  VertexBuffer,
  StandardMaterial,
  Texture,
  Vector3,
  VideoTexture,
  type AbstractMesh,
  type BaseTexture,
  type Scene,
  type UniversalCamera,
} from "@babylonjs/core";
import type { ScreenContent } from "@emerald-city/world";

/**
 * Live screens inside the world. Each screen mesh's own surface (its texture coordinates, so it
 * follows the model exactly, tilted boards included) shows, in order of preference:
 *   - the property zone's uploaded image or video (from the beta site's /api/zones/{id});
 *   - a YouTube video's still;
 *   - a title card (property and zone, or the live page's name) with "click to open".
 * Images and video come through the beta site's /api/media proxy, which adds the CORS headers
 * WebGL needs. Video plays muted, and only while you're within 30 m.
 */
const NEAR_M = 30;

export class Screens {
  private readonly zoneCache = new Map<number, Promise<ZoneData[]>>();
  private readonly videos: { tex: VideoTexture; anchor: AbstractMesh }[] = [];
  private readonly original = new Map<AbstractMesh, AbstractMesh["material"]>();
  /** Screens whose texture must be mirrored horizontally to read correctly. */
  private readonly flipped = new Map<AbstractMesh, boolean>();
  /** Own copies made for instanced screens: copy -> the hidden instance. */
  private readonly copies = new Map<AbstractMesh, AbstractMesh>();

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly api: string | null,
  ) {
    let t = 0;
    scene.onBeforeRenderObservable.add(() => {
      if ((t = (t + 1) % 30)) return; // twice a second is plenty
      for (const v of this.videos) {
        const near = Vector3.Distance(camera.position, v.anchor.getAbsolutePosition()) < NEAR_M;
        const el = v.tex.video;
        if (near && el.paused) void el.play().catch(() => {});
        if (!near && !el.paused) el.pause();
      }
    });
  }

  /** Put live content on every screen mesh in a freshly loaded model. */
  adopt(meshes: AbstractMesh[], content: Map<string, ScreenContent>) {
    for (const found of meshes) {
      const c = content.get(found.name);
      if (!c || found.getTotalVertices() === 0) continue;
      // Converted models share one geometry between identical screens (instances), but each screen
      // shows its own content: give an instance its own copy, in the same place.
      let mesh: AbstractMesh = found;
      if (found instanceof InstancedMesh) {
        const own = found.sourceMesh.clone(`${found.name}`, found.parent, true, false);
        if (!own) continue;
        own.position.copyFrom(found.position);
        own.rotationQuaternion = found.rotationQuaternion?.clone() ?? null;
        own.rotation.copyFrom(found.rotation);
        own.scaling.copyFrom(found.scaling);
        own.checkCollisions = found.checkCollisions;
        found.setEnabled(false);
        this.copies.set(own, found);
        mesh = own;
        // The copy shares vertex buffers with the source until made unique; make them its own.
        own.makeGeometryUnique();
      }
      if (!mesh.isVerticesDataPresent("uv") && mesh instanceof Mesh) planarUVs(mesh);
      if (!mesh.isVerticesDataPresent("uv")) continue;
      // Converted (glTF) models hang under a mirrored root, which reverses the screen's texture.
      this.flipped.set(mesh, mesh.computeWorldMatrix(true).determinant() < 0);
      const mat = new StandardMaterial(`screen-${mesh.name}`, this.scene);
      mat.disableLighting = true;
      // Unlit at full brightness: Babylon's standard shader computes (emissive + lighting) x diffuse
      // texture, so with lighting off a white emissive colour shows the texture as it is.
      mat.diffuseColor = Color3.White();
      mat.emissiveColor = Color3.White();
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      mat.diffuseTexture = this.orient(mesh, card(this.scene, titleFor(c), subtitleFor(c)));
      this.original.set(mesh, mesh.material);
      mesh.material = mat;
      void this.fill(mat, mesh, c);
    }
  }

  release(meshes: AbstractMesh[]) {
    for (const m of meshes) {
      if (!this.original.has(m)) continue;
      const mat = m.material as StandardMaterial | null;
      const i = this.videos.findIndex((v) => v.anchor === m);
      if (i >= 0) {
        this.videos[i]!.tex.video.pause();
        this.videos.splice(i, 1);
      }
      mat?.diffuseTexture?.dispose();
      mat?.dispose();
      m.material = this.original.get(m) ?? null;
      this.original.delete(m);
    }
    for (const [copy, instance] of [...this.copies]) {
      if (!meshes.includes(instance)) continue;
      this.release([copy]);
      copy.dispose();
      this.copies.delete(copy);
    }
  }

  private async fill(mat: StandardMaterial, mesh: AbstractMesh, c: ScreenContent) {
    let url: string | null = null;
    if (c.kind === "link") url = c.url;
    if (c.kind === "zone" && this.api) {
      const zones = await this.zones(c.pavilionId);
      const zone = zones.find((z) => z.zoneId === c.zoneId);
      url = (c.slot === "media" ? zone?.media : zone?.files)?.[c.index] ?? null;
      if (!url && zone) {
        mat.diffuseTexture?.dispose();
        mat.diffuseTexture = this.orient(mesh, card(this.scene, c.pavilionName, `${c.zoneName} · nothing uploaded yet`));
      }
    }
    if (!url || !this.api) return;
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
    const media = yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : /\.(jpe?g|png|gif|webp|mp4|webm)(\?|$)/i.test(url) ? url : null;
    if (!media) return; // a page: keep the title card
    const proxied = `${this.api}/api/media?url=${encodeURIComponent(media)}`;
    let tex: BaseTexture;
    if (/\.(mp4|webm)(\?|$)/i.test(media)) {
      const v = new VideoTexture(`video-${mesh.name}`, proxied, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, { autoPlay: false, muted: true, loop: true, autoUpdateTexture: true });
      this.videos.push({ tex: v, anchor: mesh });
      tex = v;
    } else {
      tex = await new Promise<BaseTexture>((resolve, reject) => {
        const t: Texture = new Texture(proxied, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, () => resolve(t), () => reject(new Error("image failed")));
      }).catch(() => null as unknown as BaseTexture);
      if (!tex) return;
    }
    mat.diffuseTexture?.dispose();
    mat.diffuseTexture = this.orient(mesh, tex);
  }

  private orient<T extends BaseTexture>(mesh: AbstractMesh, tex: T): T {
    if (this.flipped.get(mesh) && tex instanceof Texture) {
      tex.uScale = -1;
      tex.uOffset = 1;
    }
    return tex;
  }

  private zones(pavilionId: number): Promise<ZoneData[]> {
    let p = this.zoneCache.get(pavilionId);
    if (!p) {
      p = fetch(`${this.api}/api/zones/${pavilionId}`, { credentials: import.meta.env.VITE_GATE_URL ? "include" : "same-origin" })
        .then((r) => (r.ok ? r.json() : { zones: [] }))
        .then((j: { zones: ZoneData[] }) => j.zones ?? [])
        .catch(() => []);
      this.zoneCache.set(pavilionId, p);
    }
    return p;
  }
}

interface ZoneData {
  zoneId: number;
  media: string[];
  files: string[];
}

function titleFor(c: ScreenContent): string {
  if (c.kind === "zone") return c.pavilionName;
  if (c.kind === "html") return "Welcome to Emerald City";
  try {
    const u = new URL(c.url);
    if (/radio/.test(u.pathname)) return "Hub Culture Radio";
    if (/youtube|youtu\.be/.test(u.hostname)) return "Video";
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ");
    return last ? last.replace(/\b\w/g, (ch) => ch.toUpperCase()) : u.hostname;
  } catch {
    return "Screen";
  }
}

function subtitleFor(c: ScreenContent): string {
  if (c.kind === "zone") return `${c.zoneName} · click to open`;
  if (c.kind === "html") return c.html.replace(/<[^>]+>/g, "").slice(0, 60);
  return /live\./.test(c.url) ? "Live · click to join" : "Click to open";
}

/** An emerald title card. */
function card(scene: Scene, title: string, subtitle: string): DynamicTexture {
  const tex = new DynamicTexture(`card-${title.slice(0, 20)}`, { width: 1024, height: 576 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 1024, 576);
  g.addColorStop(0, "#0b3d2c");
  g.addColorStop(1, "#06171f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 576);
  ctx.strokeStyle = "#1fa37a";
  ctx.lineWidth = 10;
  ctx.strokeRect(24, 24, 976, 528);
  ctx.fillStyle = "#e9fff6";
  ctx.textAlign = "center";
  ctx.font = "700 78px system-ui, sans-serif";
  wrap(ctx, title, 512, 250, 900, 86);
  ctx.fillStyle = "#8ff0cd";
  ctx.font = "500 40px system-ui, sans-serif";
  ctx.fillText(subtitle.slice(0, 48), 512, 470);
  tex.update();
  return tex;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  lines.push(line);
  const top = y - ((lines.slice(0, 3).length - 1) * lh) / 2;
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, x, top + i * lh));
}

/**
 * Screens whose texture coordinates were dropped in conversion get planar ones: the two largest
 * local axes become u and v, so the content fills the face.
 */
function planarUVs(mesh: Mesh) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!pos) return;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, pos[i + k]!);
      max[k] = Math.max(max[k]!, pos[i + k]!);
    }
  const ext = [0, 1, 2].map((k) => max[k]! - min[k]!);
  const [a, b] = [0, 1, 2].sort((x, y) => ext[y]! - ext[x]!) as [number, number, number];
  // Prefer y as the vertical axis when it is one of the two large ones.
  const [u, v] = b === 1 || a === 1 ? [a === 1 ? b : a, 1] : [a, b];
  const uvs = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    uvs[j] = (pos[i + u]! - min[u]!) / (ext[u] || 1);
    uvs[j + 1] = (pos[i + v]! - min[v]!) / (ext[v] || 1);
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}
