import {
  Color3,
  Color4,
  ParticleSystem,
  DynamicTexture,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { portalFacing, terrainHeight, type GeneratedCity, type InstanceBatch, type Placement, type Portal, type WorldManifest, type WorldMaterial } from "@emerald-city/world";

/**
 * Builds the landscape for worlds that have one (Davos, Bermuda, partner islands): terrain from a
 * 16-bit heightmap, instanced forests or palms, lakes and ocean, the imported Unity shapes and
 * models, and portals to other worlds. Materials are plain Standard ones here; realism.ts upgrades
 * them to physically based materials when the realistic look is on.
 */
export interface Landscape {
  meshes: AbstractMesh[];
  /** Ground height at (x, z), or null outside the terrain. */
  groundAt(x: number, z: number): number | null;
  portals: Portal[];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export async function buildLandscape(scene: Scene, world: WorldManifest, heightmapUrl: string | null, assetBase: string): Promise<Landscape> {
  const out: AbstractMesh[] = [];
  let heights: Uint16Array | null = null;
  const t = world.terrain;

  // ---- Terrain
  if (t && heightmapUrl) {
    heights = new Uint16Array(await (await fetch(heightmapUrl)).arrayBuffer());
    const step = t.resolution > 600 ? 2 : 1; // ~263k vertices for 1025² heightmaps
    const n = Math.floor((t.resolution - 1) / step) + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 4);
    const uvs = new Float32Array(n * n * 2);
    const env = world.environment;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const k = r * n + c;
        const x = t.origin[0] + (c / (n - 1)) * t.size[0];
        const z = t.origin[2] + (1 - r / (n - 1)) * t.size[1];
        // Unity's heightmaps run along x (from max x) by row and along z by column.
        const hr = t.layout === "unity" ? t.resolution - 1 - c * step : r * step;
        const hc = t.layout === "unity" ? t.resolution - 1 - r * step : c * step;
        const y = (heights[hr * t.resolution + hc]! / 65535) * t.height + t.origin[1];
        positions.set([x, y, z], k * 3);
        uvs.set([c / (n - 1), r / (n - 1)], k * 2);
      }
    }
    const indices: number[] = [];
    for (let r = 0; r < n - 1; r++)
      for (let c = 0; c < n - 1; c++) {
        const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
        indices.push(a, d, b, b, d, e); // clockwise seen from above (Babylon is left-handed)
      }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    // Colour by height and slope: meadow and forest floor, rock on steep faces, snow above the snowline.
    for (let k = 0; k < n * n; k++) {
      const y = positions[k * 3 + 1]!;
      const ny = normals[k * 3 + 1]!;
      const steep = smooth(0.82, 0.62, ny);
      let col: [number, number, number];
      if (t.style === "alpine") {
        const snowline = env?.snowline ?? 700;
        const noise = Math.sin(positions[k * 3]! * 0.013) * Math.cos(positions[k * 3 + 2]! * 0.011) * 60;
        const snow = smooth(snowline - 250, snowline + 50, y + noise) * (1 - steep * 0.85);
        const meadow: [number, number, number] = [0.3, 0.33, 0.19];
        const rock: [number, number, number] = [0.42, 0.4, 0.38];
        const base = meadow.map((m, i) => m * (1 - steep) + rock[i]! * steep) as [number, number, number];
        // November: a light snow cover in the valley too.
        const dust = 0.12 * (1 - steep);
        col = base.map((b) => b * (1 - Math.max(snow, dust)) + 0.92 * Math.max(snow, dust)) as [number, number, number];
      } else {
        const water = env?.water?.[0]?.center[1] ?? 0;
        const sand = smooth(water + 1.6, water + 0.4, y);
        const grass: [number, number, number] = [0.3, 0.42, 0.18];
        const sandC: [number, number, number] = [0.86, 0.79, 0.62];
        col = grass.map((g, i) => g * (1 - sand) + sandC[i]! * sand) as [number, number, number];
      }
      colors.set([...col, 1], k * 4);
    }
    const ground = new Mesh("terrain", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.colors = colors;
    vd.uvs = uvs;
    vd.applyToMesh(ground);
    const mat = new StandardMaterial("terrain-mat", scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    ground.material = mat;
    ground.receiveShadows = true;
    ground.isPickable = true;
    ground.freezeWorldMatrix();
    out.push(ground);
  }
  const groundAt = (x: number, z: number) => {
    if (!t || !heights) return null;
    if (x < t.origin[0] || z < t.origin[2] || x > t.origin[0] + t.size[0] || z > t.origin[2] + t.size[1]) return null;
    return terrainHeight(t, heights, x, z);
  };

  // ---- Water
  for (const w of world.environment?.water ?? []) {
    const disc = MeshBuilder.CreateDisc(`${w.kind}-water`, { radius: w.radius, tessellation: 96 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(w.center[0], w.center[1], w.center[2]);
    const m = new StandardMaterial("water", scene); // "water" → realistic water in realism.ts
    m.diffuseColor = new Color3(0.05, 0.25, 0.32);
    disc.material = m;
    disc.isPickable = false;
    out.push(disc);
  }

  // ---- Trees (thin instances: one draw call per tree kind)
  if (world.trees?.instances.length) {
    const tree = world.trees.kind === "palm" ? makePalm(scene) : makeConifer(scene, world.terrain?.style === "alpine");
    const mats = new Float32Array(world.trees.instances.length * 16);
    world.trees.instances.forEach(([x, y, z, s], i) => {
      const yaw = (i * 2.399) % (Math.PI * 2);
      Matrix.Compose(new Vector3(s, s * (0.9 + ((i * 7) % 5) * 0.05), s), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, y - 0.3, z)).copyToArray(mats, i * 16);
    });
    tree.thinInstanceSetBuffer("matrix", mats, 16, true);
    tree.isPickable = false;
    tree.alwaysSelectAsActiveMesh = true;
    out.push(tree);
  }

  // ---- Imported Unity shapes
  for (const p of world.primitives ?? []) {
    const m = primitive(scene, p.shape);
    if (!m) continue;
    place(m, p);
    m.material = material(scene, p.material, assetBase);
    m.checkCollisions = true;
    out.push(m);
  }

  // ---- Imported Unity models (converted FBX → GLB). Each model loads once; meshes are instanced.
  const byFile = new Map<string, Placement[]>();
  for (const m of world.meshes ?? []) byFile.set(m.file, [...(byFile.get(m.file) ?? []), m]);
  await Promise.all(
    [...byFile.entries()].map(async ([file, placements]) => {
      const url = assetBase + encodeURI(file.replace(/\.[^.]+$/, ".glb"));
      let container;
      try {
        container = await LoadAssetContainerAsync(url, scene);
      } catch {
        console.info("model not converted yet:", file);
        return;
      }
      container.addAllToScene(); // materials and textures belong to the scene; the sources stay hidden
      const sources = container.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      for (const m of container.meshes) m.setEnabled(false);
      // glTF is right-handed; Unity (and this scene) are left-handed. Unity's own FBX import negates
      // X, so bake the same mirror into each source mesh once (faces are flipped to match).
      for (const src of sources) {
        src.parent = null;
        src.bakeTransformIntoVertices(Matrix.Scaling(-1, 1, 1));
      }
      // Unity splits multi-material meshes into "<name>_MeshPartN" objects that share one transform;
      // the converted model keeps one mesh, so place it once.
      const seen = new Set<string>();
      for (const pl of placements as (Placement & { mesh: string | null })[]) {
        const base = pl.mesh?.replace(/_MeshPart\d+$/, "") ?? null;
        const key = `${base}@${pl.position.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const picks = base ? sources.filter((s) => s.name === base || s.name.startsWith(base + "_primitive") || s.parent?.name === base) : sources;
        for (const src of picks) {
          const inst = src.clone(`${pl.name ?? src.name}`, null, true, false);
          if (!inst) continue;
          inst.parent = null;
          place(inst, pl);
          if (pl.material?.texture || pl.material?.color) inst.material = material(scene, pl.material, assetBase);
          inst.checkCollisions = true;
          inst.setEnabled(true);
          out.push(inst);
        }
      }
    }),
  );

  // ---- Generated cities (packages/worldgen): one thin-instanced mesh per batch, invisible colliders.
  for (const city of world.generated ?? []) out.push(...generatedCity(scene, city));

  // ---- Portals to other worlds
  const portals = (world.portals ?? []).map((p) => ({ ...p, rotationY: portalFacing(p, world.defaultSpawn.position) }));
  for (const p of portals) out.push(...portal(scene, p));

  return { meshes: out, groundAt, portals };
}

/** Unit shapes with their bottom at y = 0, matching InstanceBatch transforms. */
function unitShape(scene: Scene, shape: InstanceBatch["shape"]): Mesh {
  let m: Mesh;
  switch (shape) {
    case "box":
      m = MeshBuilder.CreateBox("gen-box", { size: 1 }, scene);
      m.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
      return m;
    case "cylinder":
      m = MeshBuilder.CreateCylinder("gen-cyl", { height: 1, diameter: 1, tessellation: 20 }, scene);
      m.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
      return m;
    case "cone":
      m = MeshBuilder.CreateCylinder("gen-cone", { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 10 }, scene);
      m.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
      return m;
    case "dome":
      return MeshBuilder.CreateSphere("gen-dome", { diameterX: 1, diameterY: 2, diameterZ: 1, slice: 0.5, segments: 20 }, scene);
    case "gable": {
      // Triangular prism: 1 wide (x), 1 high (y), 1 deep (z), ridge along z.
      m = new Mesh("gen-gable", scene);
      const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
      const positions: number[] = [], indices: number[] = [];
      const quad = (a: number, b: number, c: number, d: number) => {
        const base = positions.length / 3;
        for (const v of [a, b, c, d]) positions.push(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      const tri = (a: number, b: number, c: number) => {
        const base = positions.length / 3;
        for (const v of [a, b, c]) positions.push(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
        indices.push(base, base + 1, base + 2);
      };
      tri(0, 2, 1); tri(3, 4, 5); quad(0, 3, 5, 2); quad(1, 2, 5, 4); quad(0, 1, 4, 3);
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      Object.assign(new VertexData(), { positions, indices, normals }).applyToMesh(m);
      // Faces must point outwards (the last quad is the floor, so its normal must point down);
      // inward faces render black under any light.
      const n = m.getVerticesData("normal")!;
      if (n[n.length - 2]! > 0) m.flipFaces(true);
      return m;
    }
  }
}

function generatedCity(scene: Scene, city: GeneratedCity): Mesh[] {
  const out: Mesh[] = [];
  for (const [i, b] of city.batches.entries()) {
    const mesh = unitShape(scene, b.shape);
    mesh.name = `gen-${city.spec}-${i}-${b.shape}`;
    const mat = new StandardMaterial(`gen-${city.spec}-${i}`, scene);
    mat.diffuseColor = new Color3(...b.material.color);
    mat.specularColor = new Color3(0.06, 0.06, 0.06);
    if (b.material.emissive) mat.emissiveColor = new Color3(...b.material.emissive);
    mesh.material = mat;
    const matrices = new Float32Array(b.transforms.length * 16);
    const colors = new Float32Array(b.transforms.length * 4);
    b.transforms.forEach((t, k) => {
      Matrix.Compose(new Vector3(t[4], t[5], t[6]), Quaternion.RotationAxis(Vector3.Up(), t[3]!), new Vector3(t[0], t[1], t[2])).copyToArray(matrices, k * 16);
      colors.set(t.length >= 10 ? [t[7]!, t[8]!, t[9]!, 1] : [1, 1, 1, 1], k * 4);
    });
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.thinInstanceSetBuffer("color", colors, 4, true);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    out.push(mesh);
  }
  // Buildings are solid: invisible boxes for walking collisions (never drawn).
  const proto = MeshBuilder.CreateBox(`gen-${city.spec}-collider`, { size: 1 }, scene);
  proto.isVisible = false;
  proto.isPickable = false;
  for (const [k, c] of city.colliders.entries()) {
    const box = proto.createInstance(`gen-${city.spec}-collider-${k}`);
    box.position.set(c[0]!, c[1]!, c[2]!);
    box.scaling.set(c[3]!, c[4]!, c[5]!);
    box.rotation.y = c[6]!;
    box.checkCollisions = true;
    box.isPickable = false;
    box.isVisible = false; // instances don't inherit the source's isVisible; without this they draw as black slabs
  }
  return out;
}

function place(m: Mesh, p: Placement) {
  m.position.set(p.position[0], p.position[1], p.position[2]);
  m.rotationQuaternion = new Quaternion(p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]);
  m.scaling.set(p.scale[0], p.scale[1], p.scale[2]);
}

/** Unity's built-in meshes, at Unity's sizes. */
function primitive(scene: Scene, shape: string): Mesh | null {
  switch (shape) {
    case "cube":
      return MeshBuilder.CreateBox("cube", { size: 1 }, scene);
    case "cylinder":
      return MeshBuilder.CreateCylinder("cylinder", { height: 2, diameter: 1, tessellation: 24 }, scene);
    case "sphere":
      return MeshBuilder.CreateSphere("sphere", { diameter: 1, segments: 16 }, scene);
    case "capsule":
      return MeshBuilder.CreateCapsule("capsule", { height: 2, radius: 0.5 }, scene);
    case "plane": {
      const m = MeshBuilder.CreateGround("plane", { width: 10, height: 10 }, scene);
      return m;
    }
    case "quad":
      return MeshBuilder.CreatePlane("quad", { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
  }
  return null;
}

const matCache = new Map<string, StandardMaterial>();
function material(scene: Scene, w: WorldMaterial | undefined, assetBase: string): StandardMaterial {
  const key = JSON.stringify(w ?? {});
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new StandardMaterial(w?.name ?? "unity", scene);
  const c = w?.color ?? [0.8, 0.8, 0.8, 1];
  m.diffuseColor = new Color3(c[0], c[1], c[2]);
  if (c[3] < 1 || w?.transparent) m.alpha = Math.max(0.25, c[3]);
  if (w?.texture) {
    const tex = new Texture(assetBase + encodeURI(w.texture.replace(/\.[^.]+$/, ".png")), scene);
    if (w.tiling) {
      tex.uScale = w.tiling[0];
      tex.vScale = w.tiling[1];
    }
    m.diffuseTexture = tex;
  }
  m.specularColor = new Color3(0.1, 0.1, 0.1).scale(1 + (w?.smoothness ?? 0) * 3);
  matCache.set(key, m);
  return m;
}

/** A layered spruce (snow-dusted in the Alps). */
function makeConifer(scene: Scene, snowy: boolean): Mesh {
  const parts: Mesh[] = [];
  const trunk = MeshBuilder.CreateCylinder("trunk", { height: 3, diameterTop: 0.3, diameterBottom: 0.5, tessellation: 6 }, scene);
  trunk.position.y = 1.5;
  parts.push(trunk);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const cone = MeshBuilder.CreateCylinder("layer", { height: 5.5 - i * 0.6, diameterTop: 0, diameterBottom: 5.2 - i * 1.1, tessellation: 8 }, scene);
    cone.position.y = 3.2 + i * 2.7;
    parts.push(cone);
  }
  const tree = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
  tree.name = "conifer";
  // Vertex colours: dark green needles with snow on top faces.
  const pos = tree.getVerticesData(VertexBuffer.PositionKind)!;
  const nor = tree.getVerticesData(VertexBuffer.NormalKind)!;
  const col = new Float32Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v++) {
    const isTrunk = pos[v * 3 + 1]! < 2.2 && Math.hypot(pos[v * 3]!, pos[v * 3 + 2]!) < 0.4;
    const up = nor[v * 3 + 1]!;
    const snow = snowy && !isTrunk ? smooth(0.25, 0.7, up) * 0.85 : 0;
    const base = isTrunk ? [0.25, 0.17, 0.1] : [0.09, 0.2, 0.11];
    col.set([...base.map((b) => b * (1 - snow) + 0.95 * snow), 1], v * 4);
  }
  tree.setVerticesData(VertexBuffer.ColorKind, col);
  const m = new StandardMaterial("conifer-mat", scene);
  m.diffuseColor = Color3.White();
  m.specularColor = Color3.Black();
  tree.material = m;
  return tree;
}

function makePalm(scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const trunk = MeshBuilder.CreateCylinder("palm-trunk", { height: 9, diameterTop: 0.35, diameterBottom: 0.6, tessellation: 8 }, scene);
  trunk.position.y = 4.5;
  trunk.rotation.z = 0.08;
  parts.push(trunk);
  for (let i = 0; i < 8; i++) {
    const leaf = MeshBuilder.CreateBox("frond", { width: 0.9, height: 0.06, depth: 4.2 }, scene);
    const a = (i / 8) * Math.PI * 2;
    leaf.position.set(Math.sin(a) * 1.9 + 0.35, 8.7, Math.cos(a) * 1.9);
    leaf.rotation.y = a;
    leaf.rotation.x = 0.45;
    parts.push(leaf);
  }
  const palm = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
  palm.name = "palm";
  const pos = palm.getVerticesData(VertexBuffer.PositionKind)!;
  const col = new Float32Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v++) {
    const frond = pos[v * 3 + 1]! > 8.2;
    col.set(frond ? [0.16, 0.38, 0.12, 1] : [0.45, 0.36, 0.24, 1], v * 4);
  }
  palm.setVerticesData(VertexBuffer.ColorKind, col);
  const m = new StandardMaterial("palm-mat", scene);
  m.diffuseColor = Color3.White();
  m.specularColor = Color3.Black();
  palm.material = m;
  return palm;
}

/** Each destination's colour, so a portal hints where it goes before you read the label. */
const PORTAL_TINT: Record<string, [string, string]> = {
  "emerald-city": ["#17c38b", "#7dffcf"],
  davos: ["#6fb8ff", "#e6f4ff"],
  bermuda: ["#19c6c0", "#ffd2a6"],
};

/**
 * A gateway to another world: an upright emerald ring with the Hub ring's three colours orbiting
 * it, a swirling veil tinted for the destination, a faceted plinth, rising sparks and a label.
 * Walk through it (or click it) to travel. All unlit, so it glows the same in any light.
 */
function portal(scene: Scene, p: Portal): Mesh[] {
  const [tint, light] = PORTAL_TINT[p.to] ?? ["#17c38b", "#e9fff6"];
  const root = new TransformNode(`portal-${p.to}`, scene);
  root.position.set(p.position[0], p.position[1], p.position[2]);
  root.rotation.y = p.rotationY ?? 0;
  const unlit = (name: string, color: Color3, alpha = 1) => {
    const m = new StandardMaterial(name, scene);
    m.emissiveColor = color;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.alpha = alpha;
    return m;
  };
  const CY = 2.4; // centre of the opening

  // Ring: upright (a torus lies flat by default), emerald.
  const ring = MeshBuilder.CreateTorus(`portal-${p.to}-ring`, { diameter: 4.3, thickness: 0.22, tessellation: 64 }, scene);
  ring.parent = root;
  ring.rotation.x = Math.PI / 2;
  ring.position.y = CY;
  ring.material = unlit(`portal-${p.to}-mat`, Color3.FromHexString("#17c38b").scale(1.6));

  // The Hub ring's magenta, indigo and cyan as three fine rings orbiting just outside it.
  const arcs: Mesh[] = [];
  ["#e6007e", "#5a4fd6", "#009ee3"].forEach((hex, k) => {
    const arc = MeshBuilder.CreateTorus(`portal-${p.to}-arc${k}`, { diameter: 4.7 + k * 0.14, thickness: 0.03, tessellation: 64 }, scene);
    arc.parent = root;
    arc.rotation.x = Math.PI / 2;
    arc.position.y = CY;
    arc.material = unlit(`portal-${p.to}-arc${k}-mat`, Color3.FromHexString(hex).scale(1.4), 0.85);
    arc.isPickable = false;
    arcs.push(arc);
  });

  // Veil: a soft vortex in the destination's colour, slowly turning.
  const vt = new DynamicTexture(`portal-${p.to}-swirl`, { width: 256, height: 256 }, scene, true);
  {
    const ctx = vt.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
    g.addColorStop(0, light);
    g.addColorStop(0.35, tint + "cc");
    g.addColorStop(0.85, tint + "55");
    g.addColorStop(1, tint + "00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = light + "40";
    ctx.lineWidth = 3;
    for (let arm = 0; arm < 5; arm++) {
      ctx.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const a = arm * ((Math.PI * 2) / 5) + t * 5.5;
        const r = 8 + t * 116;
        ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
      }
      ctx.stroke();
    }
    vt.hasAlpha = true;
    vt.update();
  }
  const disc = MeshBuilder.CreateDisc(`portal-${p.to}-veil`, { radius: 2.05, tessellation: 64, sideOrientation: Mesh.DOUBLESIDE }, scene);
  disc.parent = root;
  disc.position.y = CY;
  const veil = unlit(`portal-${p.to}-veil-mat`, Color3.White(), 0.9);
  veil.diffuseTexture = vt;
  veil.emissiveTexture = vt;
  veil.opacityTexture = vt;
  veil.backFaceCulling = false;
  disc.material = veil;

  // Plinth: a low hexagonal step with a glowing rim, so the portal stands on something.
  const plinth = MeshBuilder.CreateCylinder(`portal-${p.to}-plinth`, { height: 0.25, diameterTop: 3.6, diameterBottom: 4.0, tessellation: 6 }, scene);
  plinth.parent = root;
  plinth.position.y = 0.125;
  const stone = new StandardMaterial(`portal-${p.to}-stone`, scene); // lit; realism makes it PBR stone
  stone.diffuseColor = new Color3(0.16, 0.19, 0.23);
  plinth.material = stone;
  const rim = MeshBuilder.CreateTorus(`portal-${p.to}-rim`, { diameter: 3.65, thickness: 0.05, tessellation: 6 }, scene);
  rim.parent = root;
  rim.position.y = 0.26;
  rim.rotation.y = Math.PI / 6;
  rim.material = unlit(`portal-${p.to}-rim-mat`, Color3.FromHexString(tint).scale(1.3));
  rim.isPickable = false;

  // Sparks rising through the opening.
  const spark = new DynamicTexture(`portal-${p.to}-spark`, { width: 32, height: 32 }, scene, false);
  {
    const ctx = spark.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "#ffffffff");
    g.addColorStop(1, "#ffffff00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    spark.hasAlpha = true;
    spark.update();
  }
  const ps = new ParticleSystem(`portal-${p.to}-sparks`, 90, scene);
  ps.particleTexture = spark;
  ps.emitter = plinth; // follows the portal if it is moved onto the floor later
  ps.minEmitBox = new Vector3(-1.4, 0, -0.3);
  ps.maxEmitBox = new Vector3(1.4, 0, 0.3);
  ps.color1 = Color4.FromHexString(light + "ff");
  ps.color2 = Color4.FromHexString(tint + "ff");
  ps.colorDead = new Color4(0, 0, 0, 0);
  ps.minSize = 0.05;
  ps.maxSize = 0.14;
  ps.minLifeTime = 1.2;
  ps.maxLifeTime = 2.6;
  ps.emitRate = 30;
  ps.direction1 = new Vector3(-0.15, 1, -0.15);
  ps.direction2 = new Vector3(0.15, 1.6, 0.15);
  ps.minEmitPower = 0.6;
  ps.maxEmitPower = 1.2;
  ps.gravity = new Vector3(0, -0.15, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Label: small "PORTAL TO" over the destination's name, always facing you.
  const label = MeshBuilder.CreatePlane(`portal-${p.to}-label`, { width: 4.4, height: 1.3 }, scene);
  label.parent = root;
  label.position.y = CY + 3.1;
  label.billboardMode = Mesh.BILLBOARDMODE_Y;
  const tex = new DynamicTexture(`portal-${p.to}-text`, { width: 704, height: 208 }, scene, true);
  {
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 704, 208);
    ctx.textAlign = "center";
    ctx.fillStyle = light;
    ctx.font = "600 34px Montserrat, system-ui, sans-serif";
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "10px";
    ctx.fillText("PORTAL TO", 352, 52);
    ctx.fillStyle = "#ffffff";
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "6px";
    let size = 92; // shrink long names to fit
    do ctx.font = `800 ${size}px Montserrat, system-ui, sans-serif`;
    while (ctx.measureText(p.label.toUpperCase()).width > 640 && (size -= 4) > 40);
    ctx.shadowColor = tint;
    ctx.shadowBlur = 18;
    ctx.fillText(p.label.toUpperCase(), 352, 150);
    tex.hasAlpha = true;
    tex.update();
  }
  const lm = unlit(`portal-${p.to}-label-mat`, Color3.White());
  lm.diffuseTexture = tex;
  lm.useAlphaFromDiffuseTexture = true;
  lm.emissiveTexture = tex;
  label.material = lm;

  const parts = [ring, disc, label, plinth];
  for (const m of [...parts, ...arcs, rim]) m.metadata = { portal: p.to };
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt;
    if (veil.diffuseTexture) (veil.diffuseTexture as DynamicTexture).wAng = -t * 0.6;
    // Gyroscope: each ring tilts gently around a different axis.
    arcs.forEach((a, k) => {
      a.rotation.x = Math.PI / 2 + Math.sin(t * (0.5 + k * 0.17) + k * 2.1) * 0.22;
      a.rotation.y = Math.cos(t * (0.4 + k * 0.13) + k) * 0.22;
    });
    veil.alpha = 0.8 + Math.sin(t * 2.2) * 0.1;
  });
  return [...parts, ...arcs, rim];
}
