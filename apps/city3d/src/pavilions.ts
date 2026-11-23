/**
 * Hub Culture's pavilions (hubicon.co), built in place:
 *  - the ICON: a soft-edged, pill-shaped two-storey volume clad in warm timber shingles with
 *    vertical seams, pairs of tall rounded windows, raised on slim timber stilts;
 *  - the AGENT (Davos 2027): the same family in glass, full-height glazing under a translucent
 *    upper band with intelligent LED lighting, on a mirrored plinth.
 * Proportions follow the published photographs; there are no drawings yet.
 */
import {
  Color3, DynamicTexture, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Texture, TransformNode, Vector3, VertexData, type Scene,
} from "@babylonjs/core";
import type { Pavilion } from "@emerald-city/world";

/** Plan outline of a rounded rectangle (stadium when radius = width / 2), counter-clockwise, with outward normals. */
function outline(length: number, width: number, radius: number, segments = 14) {
  const pts: { x: number; z: number; nx: number; nz: number }[] = [];
  const hx = length / 2 - radius, hz = width / 2 - radius;
  const corners: [number, number, number][] = [[hx, hz, 0], [-hx, hz, Math.PI / 2], [-hx, -hz, Math.PI], [hx, -hz, (3 * Math.PI) / 2]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (i / segments) * (Math.PI / 2);
      pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius, nx: Math.cos(a), nz: Math.sin(a) });
    }
  }
  return pts;
}

/**
 * A closed volume swept around the outline, with rounded top and bottom edges (radius `soft`).
 * u runs around the perimeter in metres / `uScale`, v up in metres / `vScale`.
 */
function softVolume(scene: Scene, name: string, length: number, width: number, height: number, soft: number, uScale: number, vScale: number) {
  const ring = outline(length, width, Math.min(width / 2, length / 2) * 0.999);
  // Profile: (inset from the outline, height, normal-out, normal-up)
  const prof: [number, number, number, number][] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2); // bottom edge
    prof.push([soft - Math.cos(a) * soft, soft + Math.sin(a) * soft, Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2); // top edge
    prof.push([soft - Math.cos(a) * soft, height - soft + Math.sin(a) * soft, Math.cos(a), Math.sin(a)]);
  }
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  let run = 0;
  const per = prof.length;
  for (let i = 0; i <= ring.length; i++) {
    const p = ring[i % ring.length]!;
    if (i > 0) {
      const q = ring[i - 1]!;
      run += Math.hypot(p.x - q.x, p.z - q.z);
    }
    for (const [inset, y, no, nu] of prof) {
      positions.push(p.x - p.nx * inset, y, p.z - p.nz * inset);
      normals.push(p.nx * no, nu, p.nz * no);
      uvs.push(run / uScale, y / vScale);
    }
  }
  for (let i = 0; i < ring.length; i++) {
    for (let k = 0; k < per - 1; k++) {
      const a = i * per + k, b = a + 1, c = a + per, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Caps (fans from the centre): roof and underside.
  for (const [y, ny, k] of [[height, 1, per - 1], [0, -1, 0]] as const) {
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, ny, 0);
    uvs.push(0, 0);
    for (let i = 0; i < ring.length; i++) {
      const a = i * per + k, b = ((i + 1) % ring.length) * per + k;
      const ax = positions[a * 3]!, az = positions[a * 3 + 2]!;
      const idx = positions.length / 3;
      positions.push(ax, y, az);
      normals.push(0, ny, 0);
      uvs.push(ax / uScale, az / uScale);
      const bx = positions[b * 3]!, bz = positions[b * 3 + 2]!;
      positions.push(bx, y, bz);
      normals.push(0, ny, 0);
      uvs.push(bx / uScale, bz / uScale);
      if (ny > 0) indices.push(centre, idx + 1, idx);
      else indices.push(centre, idx, idx + 1);
    }
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  vd.applyToMesh(m);
  return { mesh: m, ring, perimeter: run };
}

/** Timber shingles in staggered courses, with a seam line every panel (u repeats per panel). */
function shingles(scene: Scene): Texture {
  const t = new DynamicTexture("icon-shingles", { width: 256, height: 256 }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.fillStyle = "#c79a63";
  g.fillRect(0, 0, 256, 256);
  const rows = 16;
  for (let r = 0; r < rows; r++) {
    const y = (r * 256) / rows;
    let x = (r % 2) * -24;
    while (x < 256) {
      const w = 40 + ((r * 37 + x) % 23);
      const shade = 0.9 + (((r * 13 + x * 7) % 17) / 17) * 0.2;
      g.fillStyle = `rgb(${Math.round(199 * shade)},${Math.round(154 * shade)},${Math.round(99 * shade)})`;
      g.fillRect(x + 1, y + 1, w - 2, 256 / rows - 2);
      x += w;
    }
    g.fillStyle = "rgba(90,60,30,0.35)";
    g.fillRect(0, y, 256, 1.5);
  }
  g.fillStyle = "rgba(60,40,20,0.75)"; // the vertical seam between panels
  g.fillRect(0, 0, 3, 256);
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}

function pbr(scene: Scene, name: string, colour: Color3, roughness: number, metallic = 0, alpha = 1): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = colour;
  m.roughness = roughness;
  m.metallic = metallic;
  m.alpha = alpha;
  if (alpha < 1) m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  return m;
}

/** Points on the outline's long straight sides (where windows go), with their outward normal. */
function facadeSpots(ring: ReturnType<typeof outline>, length: number, width: number, radius: number, count: number) {
  const straight = length - 2 * radius;
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const x = -straight / 2 + ((i + 0.5) / count) * straight;
      out.push({ x, z: (side * width) / 2, nx: 0, nz: side });
    }
  }
  void ring;
  return out;
}

function buildIcon(scene: Scene, p: Pavilion, root: TransformNode): Mesh[] {
  const [L, W] = p.size;
  const lift = 0.9, H = 7.2, soft = 0.9, radius = W / 2;
  const meshes: Mesh[] = [];
  const panel = 2.3; // seam spacing (m)
  const body = softVolume(scene, `${p.id}-body`, L, W, H, soft, panel, panel);
  body.mesh.position.y = lift;
  body.mesh.parent = root;
  const timber = pbr(scene, "icon-timber", new Color3(1, 1, 1), 0.82);
  timber.albedoTexture = shingles(scene);
  body.mesh.material = timber;
  body.mesh.checkCollisions = true;
  meshes.push(body.mesh);

  // Tall rounded windows in pairs, two storeys, on both long sides.
  const glass = pbr(scene, "icon-glass", new Color3(0.06, 0.09, 0.11), 0.05, 0.1);
  glass.indexOfRefraction = 1.5;
  const frame = pbr(scene, "icon-frame", new Color3(0.75, 0.74, 0.7), 0.35, 0.6);
  const spots = facadeSpots(body.ring, L, W, radius, 2);
  for (const s of spots) {
    for (const storey of [0, 1]) {
      for (const pair of [-0.62, 0.62]) {
        const win = MeshBuilder.CreateCapsule(`${p.id}-win`, { radius: 0.36, height: 2.4, tessellation: 16, subdivisions: 2 }, scene);
        win.scaling.z = 0.08;
        win.position.set(s.x * 1.5 + pair, lift + 1.9 + storey * 3.1, s.z * 1.002);
        win.parent = root;
        win.material = glass;
        meshes.push(win);
      }
    }
    // The slim metal strip between window pairs (as in the photographs).
    const strip = MeshBuilder.CreateBox(`${p.id}-strip`, { width: 0.06, height: H - 1.6, depth: 0.05 }, scene);
    strip.position.set(s.x * 1.5 + (s.x > 0 ? 1.4 : -1.4), lift + H / 2, s.z * 1.004);
    strip.parent = root;
    strip.material = frame;
    meshes.push(strip);
  }

  // Slim timber stilts around the underside.
  const stiltMat = pbr(scene, "icon-stilt", new Color3(0.72, 0.55, 0.34), 0.7);
  const ring = outline(L - 1.6, W - 1.6, (W - 1.6) / 2);
  for (let i = 0; i < ring.length; i += 5) {
    const s = ring[i]!;
    const stilt = MeshBuilder.CreateCylinder(`${p.id}-stilt`, { diameter: 0.16, height: lift + 0.6, tessellation: 8 }, scene);
    stilt.position.set(s.x, (lift + 0.6) / 2 - 0.6, s.z);
    stilt.parent = root;
    stilt.material = stiltMat;
    meshes.push(stilt);
  }
  // Steps up to the door on the front (+z) side.
  const step = MeshBuilder.CreateBox(`${p.id}-steps`, { width: 2.2, height: lift, depth: 1.4 }, scene);
  step.position.set(0, lift / 2 - 0.05, W / 2 + 0.6);
  step.parent = root;
  step.material = stiltMat;
  meshes.push(step);
  const door = MeshBuilder.CreateCapsule(`${p.id}-door`, { radius: 0.6, height: 2.6, tessellation: 16 }, scene);
  door.scaling.z = 0.08;
  door.position.set(0, lift + 1.3, (W / 2) * 1.003);
  door.parent = root;
  door.material = glass;
  meshes.push(door);
  return meshes;
}

function buildAgent(scene: Scene, p: Pavilion, root: TransformNode): Mesh[] {
  const [L, W] = p.size;
  const plinth = 1.0, glassH = 5.6, band = 1.5, radius = Math.min(W, L) * 0.42;
  const meshes: Mesh[] = [];

  const mirror = pbr(scene, "agent-mirror", new Color3(0.92, 0.94, 0.96), 0.08, 1);
  const base = softVolume(scene, `${p.id}-plinth`, L - 0.6, W - 0.6, plinth, 0.25, 4, 4);
  base.mesh.parent = root;
  base.mesh.material = mirror;
  base.mesh.checkCollisions = true;
  meshes.push(base.mesh);

  // Full-height glazing (translucent, so the interior and its people read from outside).
  const glazing = pbr(scene, "agent-glass", new Color3(0.82, 0.88, 0.92), 0.04, 0.2, 0.32);
  glazing.indexOfRefraction = 1.5;
  glazing.backFaceCulling = false;
  const wall = softVolume(scene, `${p.id}-glazing`, L, W, glassH, 0.01, 2.2, glassH);
  wall.mesh.position.y = plinth;
  wall.mesh.parent = root;
  wall.mesh.material = glazing;
  wall.mesh.checkCollisions = true;
  meshes.push(wall.mesh);

  // Mullions every bay.
  const mull = pbr(scene, "agent-mullion", new Color3(0.8, 0.82, 0.85), 0.3, 0.8);
  const ring = outline(L, W, radius);
  for (let i = 0; i < ring.length; i += 3) {
    const s = ring[i]!;
    const m = MeshBuilder.CreateBox(`${p.id}-mullion`, { width: 0.07, height: glassH, depth: 0.07 }, scene);
    m.position.set(s.x * 1.003, plinth + glassH / 2, s.z * 1.003);
    m.parent = root;
    m.material = mull;
    meshes.push(m);
  }

  // Translucent recycled upper band, soft-edged, with the intelligent LED line under it.
  const translucent = pbr(scene, "agent-band", new Color3(0.93, 0.94, 0.96), 0.35, 0.1, 0.92);
  const top = softVolume(scene, `${p.id}-band`, L + 0.2, W + 0.2, band, 0.6, 3, 3);
  top.mesh.position.y = plinth + glassH;
  top.mesh.parent = root;
  top.mesh.material = translucent;
  meshes.push(top.mesh);

  const led = new StandardMaterial("agent-led", scene);
  led.disableLighting = true;
  led.emissiveColor = new Color3(0.07, 0.58, 0.64); // Zeke teal at rest
  const ledLine = softVolume(scene, `${p.id}-led`, L + 0.26, W + 0.26, 0.12, 0.02, 3, 3);
  ledLine.mesh.position.y = plinth + glassH - 0.06;
  ledLine.mesh.parent = root;
  ledLine.mesh.material = led;
  meshes.push(ledLine.mesh);
  // Light as an interface: the LED band breathes slowly between Zeke teal and Hub blue.
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = (Math.sin(t * 0.6) + 1) / 2;
    led.emissiveColor.set(0.07 * (1 - k) + 0.09 * k, 0.58 * (1 - k) + 0.41 * k, 0.64 * (1 - k) + 0.74 * k);
  });

  // Interior floor, and the Zeke Space lobe: a soft glowing disc at the centre.
  const floor = softVolume(scene, `${p.id}-floor`, L - 0.3, W - 0.3, 0.1, 0.02, 3, 3);
  floor.mesh.position.y = plinth;
  floor.mesh.parent = root;
  floor.mesh.material = pbr(scene, "agent-floor", new Color3(0.82, 0.8, 0.76), 0.6);
  meshes.push(floor.mesh);
  const lobe = MeshBuilder.CreateSphere(`${p.id}-zeke-space`, { diameter: 1.6, segments: 24 }, scene);
  lobe.position.set(0, plinth + 1.9, 0);
  lobe.parent = root;
  const lobeMat = new StandardMaterial("agent-lobe", scene);
  lobeMat.disableLighting = true;
  lobeMat.emissiveColor = new Color3(0.3, 0.85, 0.9);
  lobeMat.alpha = 0.55;
  lobe.material = lobeMat;
  meshes.push(lobe);
  // Steps on the front (+z).
  const step = MeshBuilder.CreateBox(`${p.id}-steps`, { width: 2.6, height: plinth, depth: 1.4 }, scene);
  step.position.set(0, plinth / 2 - 0.05, W / 2 + 0.5);
  step.parent = root;
  step.material = mirror;
  meshes.push(step);
  return meshes;
}

/** Placeholder until its design is in: a two-storey lodge, glazed below, dark timber above, entrance on local +x. */
function buildTechlodge(scene: Scene, p: Pavilion, root: TransformNode): Mesh[] {
  const [L, W] = p.size;
  const ground = 3.4, upper = 3.2, meshes: Mesh[] = [];
  const add = (m: Mesh, mat: PBRMaterial | StandardMaterial, solid = false) => {
    m.parent = root;
    m.material = mat;
    m.checkCollisions = solid;
    meshes.push(m);
    return m;
  };
  const glass = pbr(scene, "lodge-glass", new Color3(0.2, 0.26, 0.3), 0.05, 0.3, 0.78);
  glass.backFaceCulling = false;
  const slab = pbr(scene, "lodge-slab", new Color3(0.85, 0.84, 0.8), 0.6);
  const timber = pbr(scene, "lodge-timber", new Color3(1, 1, 1), 0.8);
  const t = new DynamicTexture("lodge-boards", { width: 128, height: 128 }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  for (let i = 0; i < 8; i++) {
    const v = 52 + ((i * 29) % 13);
    g.fillStyle = `rgb(${v + 10},${v},${v - 8})`;
    g.fillRect(i * 16, 0, 15, 128);
  }
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  timber.albedoTexture = t;
  add(MeshBuilder.CreateBox(`${p.id}-base`, { width: L, height: 0.4, depth: W }, scene), slab, true).position.y = 0.2;
  add(MeshBuilder.CreateBox(`${p.id}-glazing`, { width: L - 0.4, height: ground, depth: W - 0.4 }, scene), glass, true).position.y = 0.4 + ground / 2;
  // Posts at the corners and every bay of the glazed storey.
  for (let x = -L / 2 + 0.15; x <= L / 2; x += (L - 0.3) / 6) {
    for (const zz of [-W / 2 + 0.15, W / 2 - 0.15]) {
      add(MeshBuilder.CreateBox(`${p.id}-post`, { width: 0.22, height: ground, depth: 0.22 }, scene), slab).position.set(x, 0.4 + ground / 2, zz);
    }
  }
  const up = add(MeshBuilder.CreateBox(`${p.id}-upper`, { width: L, height: upper, depth: W }, scene), timber, true);
  up.position.y = 0.4 + ground + upper / 2;
  add(MeshBuilder.CreateBox(`${p.id}-roof`, { width: L + 1.6, height: 0.35, depth: W + 1.6 }, scene), slab).position.y = 0.4 + ground + upper + 0.17;
  // Ribbon windows in the timber storey, both long sides.
  for (const side of [1, -1]) {
    const w = add(MeshBuilder.CreateBox(`${p.id}-ribbon`, { width: L - 3, height: 1.1, depth: 0.05 }, scene), glass);
    w.position.set(0, 0.4 + ground + 1.6, (side * W) / 2 + side * 0.03);
  }
  // Entrance canopy on the +x end.
  const canopy = add(MeshBuilder.CreateBox(`${p.id}-canopy`, { width: 2.4, height: 0.2, depth: 4.5 }, scene), slab);
  canopy.position.set(L / 2 + 1.2, 0.4 + ground - 0.1, 0);
  const led = new StandardMaterial("lodge-led", scene);
  led.disableLighting = true;
  led.emissiveColor = new Color3(0.0, 0.65, 0.56); // the Emerald City stone
  const line = add(MeshBuilder.CreateBox(`${p.id}-sign`, { width: 0.06, height: 0.5, depth: 4 }, scene), led);
  line.position.set(L / 2 + 0.04, 0.4 + ground + upper - 0.6, 0);
  return meshes;
}

export function buildPavilions(scene: Scene, pavilions: Pavilion[], ground: (x: number, z: number) => number): Mesh[] {
  const out: Mesh[] = [];
  for (const p of pavilions) {
    const root = new TransformNode(p.id, scene);
    const [x, , z] = p.position;
    // Stand on the lowest ground under the plan, so no corner floats.
    const r = Math.hypot(...p.size) / 2;
    let y = Infinity;
    for (let a = 0; a < 8; a++) y = Math.min(y, ground(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8));
    y = Math.min(y, ground(x, z));
    root.position = new Vector3(x, y, z);
    root.rotation.y = p.rotationY;
    const meshes = p.kind === "icon" ? buildIcon(scene, p, root) : p.kind === "agent" ? buildAgent(scene, p, root) : buildTechlodge(scene, p, root);
    for (const m of meshes) m.metadata = { pavilion: p.id };
    out.push(...meshes);
  }
  return out;
}
