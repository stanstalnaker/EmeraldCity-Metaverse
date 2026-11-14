import {
  Animation,
  Color3,
  CubicEase,
  EasingFunction,
  GlowLayer,
  HighlightLayer,
  Mesh,
  PointLight,
  Scene,
  Sound,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractMesh,
  type UniversalCamera,
} from "@babylonjs/core";
import "@babylonjs/core/Audio/audioSceneComponent";
import type { WorldManifest } from "@emerald-city/world";

/**
 * In-world behaviour ported from the live vr.hubculture.city client (demo3t.js), driven by mesh
 * names in the legacy models. Each block notes the legacy source so behaviour can be checked.
 */
export interface Interactions {
  /** Call for every newly loaded model's meshes. */
  adopt(meshes: AbstractMesh[]): void;
  /** Handle a click; returns true if the click was used. */
  click(mesh: AbstractMesh, point: Vector3 | null): boolean;
  /** Per-frame effects (underwater fog and glow). */
  tick(): void;
}

const MAGAZINE_PAGES: Record<string, number> = { magazine1: 60, magazine2: 60, magazine3: 64 };
const MEMORIAL_PHOTOS = [
  "models/ellen/EllenHagans.jpeg",
  "models/ellen/EllenHagans-Capri1.jpeg",
  "models/ellen/Ellen-Hagans-France.jpeg",
  "models/ellen/ellen_blue.jpg",
  "models/ellen/ellen_pool.jpg",
  "models/ellen/ellen.jpg",
];

export function setupInteractions(
  scene: Scene,
  camera: UniversalCamera,
  world: WorldManifest,
  assetBase: string,
  onTeleport: () => void,
  baseFog: { mode: number; density: number; color: Color3 },
): Interactions {
  // Lift buttons and arrival kiosk: instant teleports (legacy TELEPORT_COORDS, D:1083-1191).
  const teleports = new Map(world.teleports.map((t) => [t.id, t]));
  const pageOf = new Map<string, number>(Object.keys(MAGAZINE_PAGES).map((k) => [k, 2]));
  let photo = 0;
  const ease = new CubicEase();
  ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

  const emissiveTexture = (url: string, name: string) => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.White();
    m.diffuseTexture = new Texture(assetBase + url, scene);
    m.emissiveTexture = m.diffuseTexture;
    return m;
  };

  // Underwater wellness centre effects (D:1836-2145, observer D:1308-1350).
  const glow = new GlowLayer("wellness-glow", scene, { blurKernelSize: 32 });
  glow.intensity = 0;
  let glowing = 0; // an empty include list would make every emissive mesh glow
  const highlight = new HighlightLayer("highlights", scene);
  let wellnessLight: PointLight | null = null;
  let wellnessSphere: Mesh | null = null;
  const t0 = performance.now();

  let ambient: Sound | null = null;
  const startSound = () => {
    if (ambient) return;
    // Spatial ambient sound near the beach/memorial (audio.js).
    ambient = new Sound("namaste", assetBase + "models/audio/namaste.mp3", scene, null, {
      loop: true, autoplay: true, spatialSound: true, maxDistance: 100,
    });
    ambient.setPosition(new Vector3(-1580.1, 10, 332.2));
  };
  window.addEventListener("pointerdown", startSound, { once: true });

  return {
    adopt(meshes) {
      for (const mesh of meshes) {
        const n = mesh.name;
        if (teleports.has(n) || n in MAGAZINE_PAGES || n === "memorial_photo" || n === "university_seats" || n === "send_box") {
          mesh.isPickable = true;
        }
        // Planetarium (D:2646-2718): glowing sun and cyan orbits.
        if (n === "sun" && mesh instanceof Mesh) highlight.addMesh(mesh, Color3.Yellow());
        if (/^orbit\d$/.test(n) && mesh.material) {
          const m = new StandardMaterial(`${n}-mat`, scene);
          m.disableLighting = true;
          m.emissiveColor = new Color3(0, 0.87, 1);
          mesh.material = m;
          glow.addIncludedOnlyMesh(mesh as Mesh);
          glowing++;
        }
        // Underwater: glowing pyramid, translucent sea, sphere, jellyfish, star dome.
        if (mesh.material?.name === "wellnes_center_pyramid") {
          const m = new StandardMaterial("pyramid-glow", scene);
          m.emissiveColor = new Color3(0, 0.55, 0.5);
          m.alpha = 0.45;
          mesh.material = m;
          glow.addIncludedOnlyMesh(mesh as Mesh);
          glowing++;
        }
        if (/^wellness_center_0[04567]$/.test(n) || /^jellyfish_0\d$/.test(n)) mesh.visibility = 0.3;
        if (n === "wellness_center_02" && mesh instanceof Mesh) {
          mesh.visibility = 0.3;
          wellnessSphere = mesh;
          highlight.addMesh(mesh, new Color3(0, 1, 0.9));
          wellnessLight = new PointLight("wellness-light", new Vector3(-1233.84, -4.06, -170.7), scene);
          wellnessLight.range = 200;
          wellnessLight.diffuse = new Color3(0.4, 1, 0.95);
        }
        if (n === "wellness_center_16") {
          const m = emissiveTexture("models/wellness_underwater/wellnes_center_stars.jpg", "stars");
          mesh.material = m;
        }
      }
    },

    click(mesh, point) {
      const n = mesh.name;
      const t = teleports.get(n);
      if (t) {
        camera.position.set(t.position.x, t.position.y, t.position.z);
        onTeleport();
        return true;
      }
      if (n in MAGAZINE_PAGES) {
        // Flip to the next page (D:1511-1543).
        const page = pageOf.get(n)!;
        const num = String(page).padStart(4, "0");
        mesh.material = emissiveTexture(`models/${n}/${num}.jpg`, `${n}-${num}`);
        pageOf.set(n, page >= MAGAZINE_PAGES[n]! ? 1 : page + 1);
        return true;
      }
      if (n === "memorial_photo") {
        photo = (photo + 1) % MEMORIAL_PHOTOS.length;
        mesh.material = emissiveTexture(MEMORIAL_PHOTOS[photo]!, `memorial-${photo}`);
        return true;
      }
      if (n === "university_seats" && point) {
        // Sit: glide to the clicked seat (D:2593-2616).
        const to = new Vector3(point.x, 87.3, point.z);
        camera.applyGravity = false;
        Animation.CreateAndStartAnimation("sit", camera, "position", 45, 120, camera.position.clone(), to, 0, ease, () => {
          camera.applyGravity = true;
        });
        return true;
      }
      return false;
    },

    tick() {
      const y = camera.position.y;
      const underwater = y < 0 && camera.position.x < -1000 && camera.position.x > -1900;
      if (underwater) {
        scene.fogMode = Scene.FOGMODE_EXP;
        scene.fogDensity = 0.0021;
        scene.fogColor = new Color3(0.55, 0.8, 0.8);
      } else {
        scene.fogMode = baseFog.mode;
        scene.fogDensity = baseFog.density;
        scene.fogColor = baseFog.color;
      }
      if (glowing === 0) glow.intensity = 0;
      else if (!wellnessSphere) glow.intensity = 0.5;
      if (wellnessLight && wellnessSphere) {
        const s = (Math.sin(((performance.now() - t0) / 3000) * Math.PI * 2) + 1) / 2;
        wellnessLight.intensity = s;
        const d = Vector3.Distance(camera.position, wellnessSphere.getAbsolutePosition());
        glow.intensity = y > -15.8 ? 0.3 : (0.1 + s * 0.5) * Math.max(0.2, 1 - d / 400);
        highlight.blurHorizontalSize = highlight.blurVerticalSize = 2 + s * 10;
      }
    },
  };
}
