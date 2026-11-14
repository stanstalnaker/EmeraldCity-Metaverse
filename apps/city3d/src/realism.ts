/**
 * Realistic rendering for imported worlds: a physically based sky that also lights the scene
 * (image-based lighting through a reflection probe), a sun with cascaded soft shadows, PBR
 * materials, ambient occlusion, ACES tone mapping, bloom and atmospheric haze.
 */
import {
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
}

export function setupRealism(scene: Scene, camera: Camera, engineKind: "webgpu" | "webgl", opts: RealismOptions = {}): Realism {
  const useShadows = opts.shadows ?? true;
  const useSsao = opts.ssao ?? true;
  const useDetail = opts.detail ?? true;
  scene.clearColor = new Color4(0.62, 0.74, 0.86, 1);

  // Physically based sky (Preetham model), oriented to the sun.
  const skyMat = new SkyMaterial("sky", scene);
  skyMat.backFaceCulling = false;
  skyMat.useSunPosition = true;
  skyMat.sunPosition = SUN_DIR.scale(-1000);
  skyMat.turbidity = 6;
  skyMat.luminance = 1;
  skyMat.rayleigh = 1.6;
  skyMat.mieDirectionalG = 0.82;
  const sky = MeshBuilder.CreateBox("skyBox", { size: 9000 }, scene);
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false; // haze belongs to the landscape, not the sky dome

  // Image-based lighting from that same sky, so materials reflect and are lit by it.
  const probe = new ReflectionProbe("skyProbe", 128, scene);
  probe.renderList!.push(sky);
  probe.refreshRate = 0; // render once
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 0.85;

  // Sun and soft sky fill.
  const sun = new DirectionalLight("sun", SUN_DIR, scene);
  sun.intensity = 3.2;
  sun.diffuse = new Color3(1.0, 0.95, 0.86);
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5; // keeps facet shading readable on façades facing away from the sun
  fill.groundColor = new Color3(0.25, 0.27, 0.22);

  // Cascaded shadows (stable across the large city).
  const shadows = new CascadedShadowGenerator(2048, sun);
  shadows.numCascades = 4;
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
  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.05;
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

  const upgraded = new Map<Material, Material>();
  const upgrade = (m: Material | null, meshName = ""): Material | null => {
    if (!m || !(m instanceof StandardMaterial)) return m;
    const hit = upgraded.get(m);
    if (hit) return hit;
    const p = new PBRMaterial(`${m.name}~pbr`, scene);
    p.albedoTexture = m.diffuseTexture;
    p.albedoColor = m.diffuseTexture ? Color3.White() : realisticAlbedo(m.diffuseColor);
    p.bumpTexture = m.bumpTexture;
    p.opacityTexture = m.opacityTexture;
    p.emissiveTexture = m.emissiveTexture;
    p.emissiveColor = m.emissiveColor;
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
  if (saturation < 0.35 || max >= 0.5 || max === 0) return c.clone();
  const scale = 0.5 / max;
  const lifted = new Color3(c.r * scale, c.g * scale, c.b * scale);
  // Mix a quarter toward grey of the same luminance: the legacy lights washed colours out, so a
  // straight lift reads more saturated than the art ever looked.
  const lum = 0.2126 * lifted.r + 0.7152 * lifted.g + 0.0722 * lifted.b;
  return Color3.Lerp(lifted, new Color3(lum, lum, lum), 0.25);
}
