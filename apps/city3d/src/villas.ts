/**
 * Emerald City's deluxe glass villas, built in code on the lots of the 2017 type-4 houses (which
 * were a roof slab on legs over a near-invisible glass room). Each villa: a glazed ground floor you
 * can walk into through its door, a white upper storey with ribbon windows cantilevered over the
 * garden, a roof terrace with glass railings and a pergola, and a pool in front.
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";

export interface VillaLot {
  id: string;
  position: [number, number, number];
  rotationY: number;
}

const L = 34; // length (local x)
const W = 15; // depth (local z); the door and the pool are on +z
const GROUND = 3.4;
const UPPER = 3.4;

function pbr(scene: Scene, name: string, c: Color3, roughness: number, alpha = 1, metallic = 0) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = c;
  m.roughness = roughness;
  m.metallic = metallic;
  if (alpha < 1) {
    m.alpha = alpha;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.backFaceCulling = false;
  }
  return m;
}

export function buildVillas(scene: Scene, lots: VillaLot[]): Mesh[] {
  const white = pbr(scene, "villa-white", new Color3(0.9, 0.9, 0.88), 0.6);
  const glass = pbr(scene, "villa-glass", new Color3(0.2, 0.28, 0.32), 0.05, 0.45, 0.1);
  const dark = pbr(scene, "villa-ribbon", new Color3(0.06, 0.08, 0.1), 0.08, 1, 0.2);
  const wood = pbr(scene, "villa-wood", new Color3(0.55, 0.4, 0.27), 0.7);
  const floor = pbr(scene, "villa-floor", new Color3(0.72, 0.7, 0.66), 0.5);
  const water = pbr(scene, "villa-water", new Color3(0.08, 0.42, 0.56), 0.04);
  const out: Mesh[] = [];

  for (const lot of lots) {
    const root = new TransformNode(lot.id, scene);
    root.position = new Vector3(...lot.position);
    root.rotation.y = lot.rotationY;
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: PBRMaterial, solid = false) => {
      const m = MeshBuilder.CreateBox(`${lot.id}-${name}`, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.parent = root;
      m.material = mat;
      m.checkCollisions = solid;
      m.isPickable = solid;
      out.push(m);
      return m;
    };

    // Plinth and the ground floor inside.
    box("plinth", L + 2, 0.4, W + 2, 0, 0.2, 0, white, true);
    box("floor", L - 0.6, 0.05, W - 0.6, 0, 0.43, 0, floor);
    // Glazed ground floor, with a door gap in the front wall.
    const y0 = 0.4 + GROUND / 2;
    const door = 2.4;
    box("glass-back", L, GROUND, 0.12, 0, y0, -W / 2, glass, true);
    box("glass-left", 0.12, GROUND, W, -L / 2, y0, 0, glass, true);
    box("glass-right", 0.12, GROUND, W, L / 2, y0, 0, glass, true);
    const half = (L - door) / 2;
    box("glass-front-a", half, GROUND, 0.12, -(door / 2 + half / 2), y0, W / 2, glass, true);
    box("glass-front-b", half, GROUND, 0.12, door / 2 + half / 2, y0, W / 2, glass, true);
    // Slim white mullions on the glass.
    for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 8) {
      box(`mullion-f${x}`, 0.12, GROUND, 0.16, x, y0, W / 2, white);
      box(`mullion-b${x}`, 0.12, GROUND, 0.16, x, y0, -W / 2, white);
    }
    // Upper storey, cantilevered 4 m over the garden on the right, with ribbon windows.
    const shift = 4;
    const y1 = 0.4 + GROUND + 0.25 + UPPER / 2;
    box("slab", L + 1.2, 0.5, W + 1.2, shift / 2, 0.4 + GROUND + 0.25, 0, white, true);
    box("upper", L, UPPER, W - 2, shift, y1, -1, white, true);
    box("ribbon-front", L - 4, 1.3, 0.1, shift, y1 + 0.2, (W - 2) / 2 - 1 + 0.06, dark);
    box("ribbon-back", L - 4, 1.3, 0.1, shift, y1 + 0.2, -(W - 2) / 2 - 1 - 0.06, dark);
    box("ribbon-end", 0.1, 1.3, W - 5, shift + L / 2 + 0.06, y1 + 0.2, -1, dark);
    // Columns under the cantilever.
    for (const z of [-W / 2 + 0.6, W / 2 - 0.6]) box(`column${z}`, 0.35, GROUND, 0.35, L / 2 + shift - 0.4, y0, z, white, true);
    // Roof terrace: deck, glass railing, pergola.
    const yr = 0.4 + GROUND + 0.5 + UPPER;
    box("roof", L + 0.6, 0.35, W - 1.4, shift, yr + 0.1, -1, white, true);
    box("deck", L - 6, 0.06, W - 5, shift - 2, yr + 0.31, -1, wood);
    for (const [n, w, d, x, z] of [
      ["rail-f", L, 0.06, shift, (W - 2) / 2 - 1 + 0.2],
      ["rail-b", L, 0.06, shift, -(W - 2) / 2 - 1 - 0.2],
      ["rail-l", 0.06, W - 2, shift - L / 2, -1],
      ["rail-r", 0.06, W - 2, shift + L / 2, -1],
    ] as const) box(n, w, 1.1, d, x, yr + 0.85, z, glass);
    for (let x = -6; x <= 6; x += 1.5) box(`pergola-${x}`, 0.18, 0.18, W - 6, shift + x - 6, yr + 2.6, -1, wood);
    for (const x of [-12.5, 0.5]) for (const z of [-(W - 6) / 2 - 1, (W - 6) / 2 - 1]) box(`post-${x}-${z}`, 0.2, 2.3, 0.2, shift + x, yr + 1.45, z, wood);
    // Pool and terrace in front of the door.
    box("terrace", 18, 0.25, 9, -4, 0.12, W / 2 + 5, floor, true);
    box("coping", 13, 0.3, 5.4, -4, 0.15, W / 2 + 6.2, white);
    box("pool", 12, 0.05, 4.4, -4, 0.31, W / 2 + 6.2, water);
  }
  return out;
}
