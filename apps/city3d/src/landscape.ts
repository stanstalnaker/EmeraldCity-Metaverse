import {
  Color3,
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
import { terrainHeight, type Placement, type Portal, type WorldManifest, type WorldMaterial } from "@emerald-city/world";

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
        const y = (heights[r * step * t.resolution + c * step]! / 65535) * t.height + t.origin[1];
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
      const sources = container.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      for (const pl of placements as (Placement & { mesh: string | null })[]) {
        const picks = pl.mesh ? sources.filter((s) => s.name === pl.mesh || s.name.startsWith(pl.mesh + "_") || s.parent?.name === pl.mesh) : sources;
        for (const src of picks) {
          const inst = src.clone(`${pl.name ?? src.name}`, null, true, false);
          if (!inst) continue;
          inst.parent = null;
          inst.setPreTransformMatrix(Matrix.Identity());
          place(inst, pl);
          if (pl.material?.texture || pl.material?.color) inst.material = material(scene, pl.material, assetBase);
          inst.checkCollisions = true;
          inst.setEnabled(true);
          scene.addMesh(inst);
          out.push(inst);
        }
      }
    }),
  );

  // ---- Portals to other worlds
  for (const p of world.portals ?? []) out.push(...portal(scene, p));

  return { meshes: out, groundAt, portals: world.portals ?? [] };
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

/** A glowing ring with a label; walking through it opens the other world. */
function portal(scene: Scene, p: Portal): Mesh[] {
  const root = new TransformNode(`portal-${p.to}`, scene);
  root.position.set(p.position[0], p.position[1], p.position[2]);
  const ring = MeshBuilder.CreateTorus(`portal-${p.to}-ring`, { diameter: 4.2, thickness: 0.28, tessellation: 48 }, scene);
  ring.parent = root;
  ring.position.y = 2.3;
  const glow = new StandardMaterial(`portal-${p.to}-mat`, scene);
  glow.emissiveColor = new Color3(0.15, 0.95, 0.65);
  glow.disableLighting = true;
  ring.material = glow;
  const disc = MeshBuilder.CreateDisc(`portal-${p.to}-veil`, { radius: 1.95, tessellation: 48, sideOrientation: Mesh.DOUBLESIDE }, scene);
  disc.parent = root;
  disc.position.y = 2.3;
  const veil = new StandardMaterial(`portal-${p.to}-veil-mat`, scene);
  veil.emissiveColor = new Color3(0.1, 0.6, 0.45);
  veil.alpha = 0.35;
  veil.disableLighting = true;
  disc.material = veil;
  const label = MeshBuilder.CreatePlane(`portal-${p.to}-label`, { width: 4, height: 0.9 }, scene);
  label.parent = root;
  label.position.y = 5.1;
  label.billboardMode = Mesh.BILLBOARDMODE_Y;
  const tex = new DynamicTexture(`portal-${p.to}-text`, { width: 512, height: 116 }, scene, true);
  tex.hasAlpha = true;
  tex.drawText(p.label, null, 80, "bold 64px system-ui, sans-serif", "#e9fff6", "transparent", true);
  const lm = new StandardMaterial(`portal-${p.to}-label-mat`, scene);
  lm.diffuseTexture = tex;
  lm.emissiveColor = Color3.White();
  lm.disableLighting = true;
  lm.useAlphaFromDiffuseTexture = true;
  label.material = lm;
  for (const m of [ring, disc, label]) m.metadata = { portal: p.to };
  scene.onBeforeRenderObservable.add(() => (ring.rotation.z += 0.004));
  return [ring, disc, label];
}
