/**
 * Realistic rendering for imported worlds: a physically based sky that also lights the scene
 * (image-based lighting through a reflection probe), a sun with cascaded soft shadows, PBR
 * materials, ambient occlusion, ACES tone mapping, bloom and atmospheric haze.
 */
import {
  DynamicTexture,
  Texture,
  MultiMaterial,
  Color3,
  Color4,
  CascadedShadowGenerator,
  NoiseProceduralTexture,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  ReflectionProbe,
  Scene,
  SSAO2RenderingPipeline,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
  type Camera,
  type Material,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials/sky";

export interface Realism {
  /** Call for every mesh added to the scene (streamed models). */
  adopt(meshes: AbstractMesh[]): void;
  /** Stop casting/receiving for meshes being removed. */
  release(meshes: AbstractMesh[]): void;
}

/** Sun direction for a pleasant late-morning light. */
const SUN_DIR = new Vector3(-0.45, -0.75, -0.35).normalize();

export interface RealismOptions {
  shadows?: boolean;
  ssao?: boolean;
  detail?: boolean;
  /** Direction the sunlight travels (default: late-morning sun for the city). */
  sunDirection?: Vector3;
  /** Size of the sky box; must stay inside the camera's far plane (default 9000). */
  skySize?: number;
  shadowMapSize?: number;
  cascades?: number;
  msaa?: number;
}

export function setupRealism(scene: Scene, camera: Camera, engineKind: "webgpu" | "webgl", opts: RealismOptions = {}): Realism {
  const useShadows = opts.shadows ?? true;
  const useSsao = opts.ssao ?? true;
  // Off by default: on Babylon 9 the procedural detail map cancelled direct sunlight on every
  // untextured surface (lawns, terrain, plain walls stayed lit by sky only). ?detail turns it back on.
  const useDetail = opts.detail ?? false;
  const SUN = (opts.sunDirection ?? SUN_DIR).normalizeToNew();
  scene.clearColor = new Color4(0.62, 0.74, 0.86, 1);

  // Physically based sky (Preetham model), oriented to the sun.
  const skyMat = new SkyMaterial("sky", scene);
  skyMat.backFaceCulling = false;
  skyMat.useSunPosition = true;
  skyMat.sunPosition = SUN.scale(-1000);
  skyMat.turbidity = 6;
  skyMat.luminance = 1;
  skyMat.rayleigh = 1.6;
  skyMat.mieDirectionalG = 0.82;
  const sky = MeshBuilder.CreateBox("skyBox", { size: opts.skySize ?? 9000 }, scene);
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false; // haze belongs to the landscape, not the sky dome

  // Image-based lighting from that same sky, so materials reflect and are lit by it.
  const probe = new ReflectionProbe("skyProbe", 128, scene);
  probe.renderList!.push(sky);
  probe.refreshRate = 0; // render once
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 0.6;

  // Sun and soft sky fill.
  const sun = new DirectionalLight("sun", SUN, scene);
  sun.intensity = 3.2;
  sun.diffuse = new Color3(1.0, 0.95, 0.86);
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.3; // keeps facet shading readable on façades facing away from the sun
  fill.groundColor = new Color3(0.25, 0.27, 0.22);

  // Cascaded shadows (stable across the large city).
  const shadows = new CascadedShadowGenerator(opts.shadowMapSize ?? 2048, sun);
  shadows.numCascades = opts.cascades ?? 4;
  shadows.stabilizeCascades = true;
  shadows.shadowMaxZ = 650;
  shadows.lambda = 0.85;
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.004;
  shadows.normalBias = 0.02;
  shadows.darkness = 0.15;

  // Atmospheric haze that matches the horizon.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.00075;
  scene.fogColor = new Color3(0.72, 0.8, 0.88);

  // Camera post-processing: HDR pipeline with ACES tone mapping, bloom, FXAA and a little sharpening.
  const pipeline = new DefaultRenderingPipeline("realism", true, scene, [camera]);
  pipeline.samples = opts.msaa ?? 4;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 0.9; // expose for bright plazas and snow (like a camera would)
  pipeline.imageProcessing.contrast = 1.12;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 0.6;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 1.4; // only genuinely bright highlights (sun glints, emissive signs)
  pipeline.bloomWeight = 0.06;
  pipeline.bloomKernel = 32;
  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.2;

  // Screen-space ambient occlusion grounds objects (WebGL2 path; WebGPU uses the same pipeline when available).
  if (useSsao) try {
    const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], engineKind === "webgpu");
    ssao.radius = 2.5;
    ssao.totalStrength = 1.1;
    ssao.samples = 16;
    ssao.maxZ = 400;
  } catch (err) {
    console.warn("SSAO unavailable", err);
  }

  // Subtle tiling surface detail so large untextured legacy surfaces (flat green lawns, plain walls)
  // stop reading as plastic. Procedural, so there is no extra download.
  const detail = new NoiseProceduralTexture("surfaceDetail", 512, scene);
  detail.octaves = 5;
  detail.persistence = 0.9;
  detail.animationSpeedFactor = 0;
  detail.uScale = 1;
  detail.vScale = 1;

  let turfTex: Texture | null = null;
  const turf = () => {
    if (turfTex) return turfTex;
    // Painted once: soft mottling at two scales, tiled across the lawns.
    const t = new DynamicTexture("turf", { width: 512, height: 512 }, scene, true);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#737373";
    ctx.fillRect(0, 0, 512, 512);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const r = 6 + rnd() * 40, x = rnd() * 512, y = rnd() * 512, v = Math.round(90 + rnd() * 50);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      for (const [dx, dy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) ctx.fillRect(x + dx! - r, y + dy! - r, r * 2, r * 2);
    }
    t.update();
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.uScale = t.vScale = 90;
    return (turfTex = t);
  };
  const upgraded = new Map<Material, Material>();
  const upgrade = (m: Material | null, meshName = ""): Material | null => {
    // Converted (GLB) models already carry PBR materials: only give their water and glass the same treatment.
    if (m instanceof PBRMaterial && !upgraded.has(m)) {
      if (/ocean|water|sea|pool/i.test(`${m.name} ${meshName}`)) {
        m.albedoColor = new Color3(0.03, 0.12, 0.16);
        m.roughness = 0.06;
        m.metallic = 0;
        m.indexOfRefraction = 1.33;
      } else if (/glass|window/i.test(m.name)) {
        m.roughness = 0.05;
        m.indexOfRefraction = 1.5;
      } else if (!m.albedoTexture) {
        // Same colour correction as legacy materials (the exporter keeps the old, too-dark flat colours),
        // done in gamma space because glTF colours are linear.
        m.albedoColor = realisticAlbedo(m.albedoColor.toGammaSpace()).toLinearSpace();
      }
      upgraded.set(m, m);
      return m;
    }
    // Most legacy city meshes carry a MultiMaterial: upgrade each part (cached, shared like the parts).
    if (m instanceof MultiMaterial) {
      const hit = upgraded.get(m);
      if (hit) return hit;
      const mm = new MultiMaterial(`${m.name}~pbr`, scene);
      mm.subMaterials = m.subMaterials.map((sub) => upgrade(sub, meshName));
      upgraded.set(m, mm);
      return mm;
    }
    if (!m || !(m instanceof StandardMaterial)) return m;
    // Unlit on purpose (portals, labels, signs, screens): leave as authored.
    if (m.disableLighting) return m;
    const hit = upgraded.get(m);
    if (hit) return hit;
    const p = new PBRMaterial(`${m.name}~pbr`, scene);
    p.albedoTexture = m.diffuseTexture;
    // Textures are mostly light bakes painted near white; at full strength they clip under the sun.
    p.albedoColor = m.diffuseTexture ? new Color3(0.8, 0.8, 0.8) : realisticAlbedo(m.diffuseColor);
    p.bumpTexture = m.bumpTexture;
    p.opacityTexture = m.opacityTexture;
    p.emissiveTexture = m.emissiveTexture;
    // Legacy emissive stood in for lighting in the flat old look (whole lawns glowed green). Under the
    // sun it only needs to read as an accent glow.
    p.emissiveColor = m.emissiveColor.scale(m.emissiveTexture ? 1 : 0.3);
    p.alpha = m.alpha;
    p.backFaceCulling = m.backFaceCulling;
    p.metallic = 0;
    // Glass and water read as smooth; everything else as matte-ish architectural surfaces.
    const isWater = /ocean|water|sea|pool/i.test(`${m.name} ${meshName}`);
    const glassy = !isWater && (m.alpha < 0.95 || /glass|window/i.test(m.name));
    p.roughness = glassy ? 0.05 : 0.78;
    if (isWater) {
      // Glossy water that mirrors the sky; the legacy water texture stays as subtle colour variation.
      p.albedoColor = new Color3(0.03, 0.12, 0.16);
      p.roughness = 0.06;
      p.metallic = 0;
      p.indexOfRefraction = 1.33;
    }
    if (glassy) p.indexOfRefraction = 1.5;
    p.environmentIntensity = 1;
    p.useHorizonOcclusion = true;
    if (useDetail && !m.diffuseTexture && !glassy) {
      p.detailMap.texture = detail;
      p.detailMap.isEnabled = true;
      p.detailMap.diffuseBlendLevel = 0.18;
      p.detailMap.roughnessBlendLevel = 0.25;
      p.detailMap.bumpLevel = 0;
    }
    upgraded.set(m, p);
    return p;
  };

  return {
    adopt(meshes) {
      for (const mesh of meshes) {
        if (mesh === sky || mesh.getTotalVertices() === 0) continue;
        if (mesh.name === "wall") {
          // The legacy island's 3.6 km boundary wall: keep it solid, but let the horizon open to sea and sky.
          mesh.isVisible = false;
          continue;
        }
        if (mesh.material) mesh.material = upgrade(mesh.material, mesh.name);
        // The island's lawns: one flat colour over kilometres. Give them turf colour and variation.
        if (/^terrain_\d/.test(mesh.name) && mesh.material instanceof PBRMaterial && !mesh.material.albedoTexture) {
          mesh.material.albedoColor = new Color3(0.24, 0.42, 0.12); // × the noise below averages ~(0.09, 0.16, 0.05): real grass
          mesh.material.albedoTexture = turf();
          mesh.material.roughness = 0.95;
        }
        mesh.receiveShadows = useShadows;
        if (useShadows && mesh instanceof Mesh && mesh.getBoundingInfo().boundingSphere.radiusWorld < 200) shadows.addShadowCaster(mesh, false);
      }
    },
    release(meshes) {
      for (const mesh of meshes) shadows.removeShadowCaster(mesh, false);
    },
  };
}

/** The flat legacy look (one hemispheric light, no post), for side-by-side comparison. */
export function setupLegacyLook(scene: Scene): Realism {
  scene.clearColor = new Color4(0.55, 0.7, 0.85, 1);
  const light = new HemisphericLight("legacy", new Vector3(0, 1, 0), scene);
  light.intensity = 1;
  return { adopt() {}, release() {} };
}

/**
 * Legacy materials were authored for three over-bright lights, so many flat colours are far darker
 * than real surfaces (the main lawn is 13% green). Under physically based lighting that reads as
 * near-black. Lift saturated, untextured colours into a realistic reflectance range, keeping hue;
 * leave greys and deliberate blacks alone.
 */
export function realisticAlbedo(c: Color3): Color3 {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (max === 0) return c.clone();
  // Nothing real is a perfect reflector: legacy pure whites clip to flat white under the sun.
  // Fresh white paint reflects ~80%, so cap there (gamma space).
  if (max > 0.8) return realisticAlbedo(c.scale(0.8 / max));
  // Neon greens and other loud, bright colours (the legacy lawns) read as plastic. Real grass and
  // painted surfaces are darker and less saturated.
  if (saturation > 0.5 && max > 0.5) {
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return Color3.Lerp(c, new Color3(lum, lum, lum), 0.22).scale(0.5 / max + 0.25);
  }
  if (saturation < 0.35 || max >= 0.22) return c.clone();
  const scale = 0.22 / max;
  const lifted = new Color3(c.r * scale, c.g * scale, c.b * scale);
  // Mix a quarter toward grey of the same luminance: the legacy lights washed colours out, so a
  // straight lift reads more saturated than the art ever looked.
  const lum = 0.2126 * lifted.r + 0.7152 * lifted.g + 0.0722 * lifted.b;
  return Color3.Lerp(lifted, new Color3(lum, lum, lum), 0.12);
}
