/**
 * Emerald City 3D (Babylon.js 9). Renders a world manifest: streams the city's models, spawns at a
 * property (?pavilion_id=, compatible with the live site's links), teleports via the arrival kiosk
 * and lifts, and makes the ~150 property screens interactive.
 *
 * ?world=davos|bermuda  other worlds (default Emerald City) · ?look=legacy  flat legacy lighting for comparison · ?renderer=webgl  force WebGL2 · ?shot  no HUD
 * ?off=ssao,shadows,detail  switch individual effects off (debugging) · ?fly&pos=x,y,z&yaw=&pitch=  camera
 */
import { Scene, Tools, UniversalCamera, Vector3, type AbstractMesh } from "@babylonjs/core";
import type { ScreenContent, WorldManifest } from "@emerald-city/world";
import { spawnFor } from "@emerald-city/world";
import davosHeights from "@emerald-city/world/data/davos.r16?url";
import bermudaHeights from "@emerald-city/world/data/bermuda.r16?url";
import { buildLandscape } from "./landscape";
import { People } from "./people";
import { chooseQuality, runBenchmark, startPerfOverlay } from "./perf";
import { Screens } from "./screens";
import { loadSplats } from "./splats";
import { setupInteractions } from "./interactions";
import { setupHud } from "./hud";
import { createEngine } from "./engine";
import { setupLegacyLook, setupRealism } from "./realism";
import { WorldStreamer } from "./streaming";

const params = new URLSearchParams(location.search);
const WORLDS: Record<string, { load: () => Promise<{ default: unknown }>; heights?: string }> = {
  "emerald-city": { load: () => import("@emerald-city/world/data/emerald-city.world.json") },
  davos: { load: () => import("@emerald-city/world/data/davos.world.json"), heights: davosHeights },
  bermuda: { load: () => import("@emerald-city/world/data/bermuda.world.json"), heights: bermudaHeights },
};
const worldSlug = WORLDS[params.get("world") ?? ""] ? params.get("world")! : "emerald-city";
let world: WorldManifest;
/** Models and textures of the 2017-18 Unity worlds, converted (served like /legacy/, not committed). */
const unityBase = (import.meta.env.VITE_UNITY_ASSET_BASE as string | undefined) ?? "/unity/";
const assetBase = (import.meta.env.VITE_ASSET_BASE as string | undefined) ?? "/legacy/";
/**
 * Compressed city models (convert-legacy.mjs: GLB, meshopt geometry, WebP textures; about 12x
 * smaller). On with VITE_ASSET_FORMAT=glb or ?assets=glb; images (magazines, map, slideshow) still
 * come from assetBase.
 */
const useGlb = params.get("assets") === "glb" || (import.meta.env.VITE_ASSET_FORMAT as string | undefined) === "glb";
const modelBase = useGlb ? ((import.meta.env.VITE_MODEL_BASE as string | undefined) ?? "/unity/legacy/") : assetBase;
const legacyLook = params.get("look") === "legacy";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  // Behind the beta gate, cross-site media (screens) must carry the beta session cookie.
  if (import.meta.env.VITE_GATE_URL) Tools.CorsBehavior = "use-credentials";
  world = (await WORLDS[worldSlug]!.load()).default as WorldManifest;
  const canvas = $<HTMLCanvasElement>("c");
  const t0 = performance.now();
  let readyAt: number | null = null;
  const { engine, kind } = await createEngine(canvas);
  const q = chooseQuality(params.get("quality"));
  engine.setHardwareScalingLevel(q.hardwareScaling);
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.45, 0);
  if (params.has("shot")) document.querySelectorAll<HTMLElement>("#hud, #loading").forEach((e) => (e.style.display = "none"));

  // First-person camera at the requested property (or the world default).
  const spawn = spawnFor(world, params.get("pavilion_id"));
  const camera = new UniversalCamera("eye", new Vector3(spawn.position.x, spawn.position.y + 1.7, spawn.position.z), scene);
  camera.rotation.y = spawn.rotationY;
  camera.minZ = 0.2;
  camera.maxZ = world.terrain ? 24000 : 9000;
  camera.speed = 1.1;
  camera.angularSensibility = 2500;
  camera.keysUp.push(87); // W
  camera.keysDown.push(83); // S
  camera.keysLeft.push(65); // A
  camera.keysRight.push(68); // D
  camera.ellipsoid = new Vector3(0.6, 0.9, 0.6);
  camera.checkCollisions = true;
  camera.applyGravity = !params.has("fly");
  camera.attachControl(canvas, true);
  if (params.has("yaw")) camera.rotation.y = Number(params.get("yaw"));
  if (params.has("pitch")) camera.rotation.x = Number(params.get("pitch"));
  if (params.has("pos")) {
    const [x, y, z] = params.get("pos")!.split(",").map(Number);
    camera.position.set(x!, y!, z!);
  }

  const off = new Set((params.get("off") ?? "").split(","));
  const look = legacyLook
    ? setupLegacyLook(scene)
    : setupRealism(scene, camera, kind, {
        shadows: q.shadows && !off.has("shadows"), ssao: q.ssao && !off.has("ssao"), detail: params.has("detail"),
        shadowMapSize: q.shadowMapSize, cascades: q.cascades, msaa: q.msaa,
        // Mountains read best under a lower sun; the sky box must fit inside the larger far plane.
        // In Davos the winter sun is low in the south-southeast (north is +z); islands get a higher sun.
        ...(world.terrain
          ? { sunDirection: params.has("sun") ? new Vector3(...(params.get("sun")!.split(",").map(Number) as [number, number, number])) : world.environment?.style === "alpine" ? new Vector3(-0.3, -0.42, 0.86) : new Vector3(-0.4, -0.7, 0.5), skySize: 30000 }
          : {}),
      });

  if (world.environment?.fog !== undefined && !legacyLook) scene.fogDensity = world.environment.fog;
  if (world.terrain && !legacyLook) {
    // Snow and open valleys: a little more sky light than the city.
    const sun = scene.getLightByName("sun");
    const fill = scene.lights.find((l) => l.getClassName() === "HemisphericLight");
    if (sun) sun.intensity = 3.0;
    if (fill) fill.intensity = 0.35;
    scene.environmentIntensity = 0.7;
  }
  if (world.environment?.style === "alpine") scene.fogColor.set(0.7, 0.8, 0.92);

  // Landscape worlds (Davos, Bermuda): terrain, forest, water, imported shapes and models, portals.
  const landscape = world.terrain || world.primitives?.length || world.portals?.length || world.generated?.length
    ? await buildLandscape(scene, params.has("lite") ? { ...world, trees: undefined, meshes: [] } : world, WORLDS[worldSlug]!.heights ?? null, unityBase)
    : null;
  if (landscape) {
    look.adopt(landscape.meshes);
    camera.speed = 1.6;
    scene.gravity = Vector3.Zero(); // falling onto the terrain is handled below
  }

  const interactions = setupInteractions(scene, camera, world, assetBase, () => streamer.update(camera.position), {
    mode: scene.fogMode, density: scene.fogDensity, color: scene.fogColor.clone(),
  });

  // Live screens in the world (images, video, YouTube stills, title cards). The beta site serves zone
  // content and proxies media; without it (local dev) screens show title cards.
  const cityApi = (import.meta.env.VITE_CITY_API as string | undefined) ?? null;
  const liveScreens = legacyLook ? null : new Screens(scene, camera, cityApi);

  // Screens: mesh name → what it shows.
  const screens = new Map(world.screens.map((s) => [s.mesh, s.content]));
  const wireScreens = (meshes: AbstractMesh[]) => {
    for (const mesh of meshes) if (screens.has(mesh.name)) mesh.isPickable = true;
  };

  const terrainMeshes: AbstractMesh[] = [];
  const streamer = new WorldStreamer(scene, world, modelBase, {
    onLoaded(model, container) {
      // Make the world solid. The legacy client did this per model in callbacks we don't run;
      // without it, gravity drops you through the ground and you only see sky.
      for (const mesh of container.meshes) {
        if (mesh.getTotalVertices() === 0) continue;
        mesh.checkCollisions = true;
        if (/collider|collision/i.test(mesh.name)) mesh.isVisible = false;
      }
      look.adopt(container.meshes);
      interactions.adopt(container.meshes);
      liveScreens?.adopt(container.meshes, screens); // after look.adopt, so the realism pass leaves screen materials alone
      wireScreens(container.meshes);
      if (model.id === "terrain") terrainMeshes.push(...container.meshes);
    },
    onUnloaded(_model, container) {
      look.release(container.meshes);
      liveScreens?.release(container.meshes);
    },
    onProgress(loading, loaded) {
      $("loading").textContent = loading ? `Loading ${loading} building${loading > 1 ? "s" : ""}… (${loaded} loaded)` : `${loaded} buildings loaded`;
    },
  }, 1.3, useGlb);

  // Load what's around the spawn before showing the first frame (avoids falling through terrain).
  camera.applyGravity = false;
  await streamer.preload(camera.position);
  if (landscape) terrainMeshes.push(...landscape.meshes.filter((m) => m.name === "terrain"));
  camera.applyGravity = !params.has("fly");
  setInterval(() => {
    streamer.update(camera.position);
    // Safety net: if you ever fall out of the world, return to the spawn point.
    // Portals: walk into one to travel to that world.
    for (const p of landscape?.portals ?? []) {
      if (Math.hypot(camera.position.x - p.position[0], camera.position.z - p.position[2]) < 1.8 && Math.abs(camera.position.y - p.position[1] - 2) < 3) {
        const q = new URLSearchParams(location.search);
        q.delete("pos");
        if (p.to === "emerald-city") q.delete("world");
        else q.set("world", p.to);
        location.search = q.toString();
      }
    }
    if (camera.position.y < -150) {
      camera.position.set(spawn.position.x, spawn.position.y + 1.7, spawn.position.z);
      camera.rotation.y = spawn.rotationY;
    }
  }, 500);

  // Click a screen to see what it shows.
  scene.onPointerDown = (_evt, pick) => {
    if (!pick?.hit || !pick.pickedMesh) return;
    if (pick.pickedMesh.metadata?.zekeHost) {
      openChat("zeke");
      return;
    }
    if (interactions.click(pick.pickedMesh, pick.pickedPoint)) return;
    const name = (pick.pickedMesh.metadata?.screenOf as string | undefined) ?? pick.pickedMesh.name;
    const content = screens.get(name);
    if (content) showScreen(name, content);
  };
  scene.onBeforeRenderObservable.add(() => interactions.tick());
  // Stand on the terrain (cheaper than mesh collisions on a 260k-vertex ground).
  if (landscape) {
    let vy = 0;
    scene.onBeforeRenderObservable.add(() => {
      const g = landscape.groundAt(camera.position.x, camera.position.z);
      if (g === null || !camera.applyGravity) return;
      const eye = g + 1.7;
      if (camera.position.y <= eye + 0.05) {
        camera.position.y = eye;
        vy = 0;
      } else {
        vy = Math.min(vy + 0.02, 2);
        camera.position.y = Math.max(eye, camera.position.y - vy);
      }
    });
  }
  setupHud({ camera, assetBase, onTeleport: () => streamer.update(camera.position), fly: params.has("fly"), map: worldSlug === "emerald-city" });

  // Teleports: arrival kiosk destinations plus property spawns.
  const select = $<HTMLSelectElement>("teleport");
  const opts: { label: string; pos: Vector3; yaw?: number }[] = [
    ...world.teleports.filter((t) => t.group === "kiosk").map((t) => ({ label: `Kiosk · ${t.label}`, pos: new Vector3(t.position.x, t.position.y, t.position.z) })),
    ...Object.entries(world.spawns).map(([id, s]) => ({ label: `Property ${id || "Lotus"}`, pos: new Vector3(s.position.x, s.position.y, s.position.z), yaw: s.rotationY })),
  ];
  select.innerHTML = `<option value="">Teleport…</option>` + opts.map((o, i) => `<option value="${i}">${o.label}</option>`).join("");
  select.onchange = () => {
    const o = opts[Number(select.value)];
    if (!o) return;
    camera.position.copyFrom(o.pos.add(new Vector3(0, 1.7, 0)));
    if (o.yaw !== undefined) camera.rotation.y = o.yaw;
    streamer.update(camera.position);
    select.value = "";
    canvas.focus();
  };

  $<HTMLButtonElement>("look").textContent = legacyLook ? "Realistic look" : "Legacy look";
  $<HTMLButtonElement>("look").onclick = () => {
    const p = new URLSearchParams(location.search);
    if (legacyLook) p.delete("look");
    else p.set("look", "legacy");
    location.search = p.toString();
  };

  // Headset support (WebXR) with the terrain as the teleport floor.
  if (navigator.xr && !params.has("shot")) {
    try {
      await scene.createDefaultXRExperienceAsync({ floorMeshes: terrainMeshes });
    } catch (err) {
      console.warn("WebXR unavailable", err);
    }
  }

  $("title").textContent = `${world.name} · ${kind === "webgpu" ? "WebGPU" : "WebGL2"}${legacyLook ? " · legacy look" : ""}`;
  engine.runRenderLoop(() => {
    scene.render();
    $("stats").textContent = `${engine.getFps().toFixed(0)} fps`;
  });
  window.addEventListener("resize", () => engine.resize());
  // Debug switches for lighting: ?kill=fog,ibl,sun,fill,pipe
  const kill = new Set((params.get("kill") ?? "").split(","));
  if (kill.has("fog")) scene.fogEnabled = false;
  if (kill.has("ibl")) scene.environmentIntensity = 0;
  if (kill.has("sun")) scene.getLightByName("sun")!.intensity = 0;
  if (kill.has("fill")) scene.getLightByName("fill")!.intensity = 0;
  if (kill.has("pipe")) scene.postProcessRenderPipelineManager.supportedPipelines.forEach((pl) => scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(pl.name, camera));
  // Gaussian splats from the world, plus ?splat=<url> to try a capture in front of you.
  const trySplat = params.get("splat");
  void loadSplats(scene, [
    ...(world.splats ?? []),
    ...(trySplat ? [{ url: trySplat, label: "Test capture", position: camera.position.add(camera.getDirection(Vector3.Forward()).scale(6)).asArray() as [number, number, number] }] : []),
  ]).then((n) => look.adopt(n));
  const people = await startPeople(scene, camera, world, worldSlug);
  readyAt = performance.now() - t0;
  if (params.has("perf") || params.has("bench")) {
    const sample = startPerfOverlay(engine, scene, kind, q, () => readyAt);
    if (params.has("bench")) runBenchmark(scene, camera, sample, { world: worldSlug, quality: q.quality, renderer: kind, assets: useGlb ? "glb" : "legacy", readyMs: Math.round(readyAt) });
  }
  if (params.has("debug")) Object.assign(window, { __city: { scene, camera, interactions, people } });
  (window as unknown as { __ready: boolean }).__ready = true;
}

/**
 * People in the world (presence server). On beta, the member signed in once with HubID at the beta
 * gate; the 3D city asks the gate for their HubID token (VITE_GATE_URL, cookie for
 * *.beta.hubculture.city). Locally the dev presence server accepts test identities.
 */
async function presenceToken(): Promise<string | null> {
  const gate = import.meta.env.VITE_GATE_URL as string | undefined;
  if (gate) {
    try {
      const r = await fetch(`${gate}/_gate/token`, { credentials: "include" });
      if (r.ok) return ((await r.json()) as { token: string }).token;
    } catch {
      /* fall through */
    }
    return null;
  }
  if (import.meta.env.DEV) {
    const name = (params.get("name") ?? `Visitor ${Math.floor(Math.random() * 900 + 100)}`).replace(/:/g, " ");
    return `human:${Math.floor(Math.random() * 1e6) + 1000}:${name}`;
  }
  return null;
}

let chatMode: "everyone" | "zeke" = "everyone";
let people: People | null = null;

async function startPeople(scene: Scene, camera: UniversalCamera, w: WorldManifest, slug: string): Promise<People | null> {
  const url = (import.meta.env.VITE_PRESENCE_URL as string | undefined) ?? (import.meta.env.DEV ? `ws://${location.hostname}:8787` : null);
  const token = await presenceToken();
  const log = (line: string, kind: "chat" | "system" | "zeke" = "system") => {
    const el = document.createElement("div");
    el.className = `line ${kind}`;
    el.textContent = line;
    const box = $("chat-log");
    box.appendChild(el);
    while (box.children.length > 80) box.firstChild!.remove();
    box.scrollTop = box.scrollHeight;
  };
  if (!url || !token || params.has("shot")) {
    if (!params.has("shot")) log(url ? "Sign in with your HubID to meet people here." : "Presence is not configured.");
    return null;
  }
  const spawn = w.defaultSpawn.position;
  const host = new Vector3(spawn.x + 3, spawn.y, spawn.z + 3);
  people = new People({ scene, camera, worldSlug: slug, url, token, hostPosition: host, log });
  const form = $<HTMLFormElement>("chat-form");
  const input = $<HTMLInputElement>("chat-input");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !people) return;
    input.value = "";
    if (chatMode === "zeke") {
      log(`You → Zeke: ${text}`, "chat");
      log(`Zeke: ${await people.askZeke(text)}`, "zeke");
    } else people.say(text);
  };
  $("chat-mode").onclick = () => openChat(chatMode === "zeke" ? "everyone" : "zeke");
  $("voice-btn").onclick = async () => {
    if (!people) return;
    if (people.voiceOn) {
      await people.stopVoice();
      $("voice-btn").textContent = "Voice";
    } else {
      people.requestVoice();
      $("voice-btn").textContent = "Voice on";
    }
  };
  // Keys typed in chat must not walk the camera.
  input.addEventListener("keydown", (e) => e.stopPropagation());
  return people;
}

function openChat(mode: "everyone" | "zeke") {
  chatMode = mode;
  $("chat").classList.add("open");
  $("chat-mode").textContent = mode === "zeke" ? "Asking Zeke" : "Everyone here";
  $<HTMLInputElement>("chat-input").placeholder = mode === "zeke" ? "Ask Zeke anything about the city…" : "Say something to everyone here…";
  $<HTMLInputElement>("chat-input").focus();
}

function esc(t: string) {
  return t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/** YouTube links become embeds, as on the live site (VideoPlayer.js getMeshData). */
function embedUrl(url: string): string {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?rel=0&autoplay=1&modestbranding=1` : url;
}

function showScreen(mesh: string, c: ScreenContent) {
  const panel = $("screen");
  const body = $("screen-body");
  $("screen-title").textContent = c.kind === "zone" ? `${c.pavilionName} · ${c.zoneName}` : mesh.replace(/_/g, " ");
  if (c.kind === "link") {
    const url = embedUrl(c.url);
    if (/\.(jpe?g|png|gif|webp)$/i.test(url)) body.innerHTML = `<img src="${esc(url)}" alt="">`;
    else body.innerHTML = `<iframe src="${esc(url)}" allow="autoplay; fullscreen; camera; microphone" referrerpolicy="no-referrer"></iframe>`;
    $("screen-open").setAttribute("href", c.url);
  } else if (c.kind === "zone") {
    const page = `https://hubculture.city/c/${encodeURIComponent(c.pavilionName.replace(/\s+/g, "-"))}`;
    body.innerHTML =
      `<div class="empty"><p>This screen shows ${c.slot === "media" ? "media" : "file"} ${c.index + 1} from the zone <b>${esc(c.zoneName)}</b> of <b>${esc(c.pavilionName)}</b>.</p>` +
      `<p>Property owners upload content on their property page. Live zone content appears here once this beta is connected to HubID (staging).</p></div>`;
    $("screen-open").setAttribute("href", c.fallbackUrl ?? page);
  } else {
    body.innerHTML = `<div class="empty">${esc(c.html)}</div>`;
    $("screen-open").removeAttribute("href");
  }
  panel.style.display = "flex";
}

main().catch((err) => {
  console.error(err);
  $("loading").textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
