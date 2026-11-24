/**
 * Emerald City 3D (Babylon.js 9). Renders a world manifest: streams the city's models, spawns at a
 * property (?pavilion_id=, compatible with the live site's links), teleports via the arrival kiosk
 * and lifts, and makes the ~150 property screens interactive.
 *
 * ?world=davos|bermuda  other worlds (default Emerald City) · ?look=legacy  flat legacy lighting for comparison · ?renderer=webgl  force WebGL2 · ?shot  no HUD
 * ?off=ssao,shadows,detail  switch individual effects off (debugging) · ?fly&pos=x,y,z&yaw=&pitch=  camera
 */
import { Ray, Scene, Tools, UniversalCamera, Vector3, type AbstractMesh } from "@babylonjs/core";
import type { Portal, ScreenContent, WorldManifest } from "@emerald-city/world";
import { spawnFor } from "@emerald-city/world";
import davosHeights from "@emerald-city/world/data/davos.r16?url";
import bermudaHeights from "@emerald-city/world/data/bermuda.r16?url";
import davosTown from "@emerald-city/world/data/davos.osm.json?url";
import { lotAddresses, villaAddresses, type OsmTown } from "@emerald-city/world";
import { buildTown } from "./town";
import { buildPavilions } from "./pavilions";
import { buildVillas } from "./villas";
import { buildLandscape } from "./landscape";
import { People } from "./people";
import { chooseQuality, runBenchmark, startPerfOverlay } from "./perf";
import { Screens } from "./screens";
import { loadSplats } from "./splats";
import { setupInteractions } from "./interactions";
import { MAP_STOPS, setupHud } from "./hud";
import { setupMap, type MapMarker } from "./map";
import { createEngine } from "./engine";
import { setupLegacyLook, setupRealism } from "./realism";
import { WorldStreamer } from "./streaming";
import { crossesPortal, setupMovement } from "./movement";
import { setButton, setMember, setupUi, splash } from "./ui";
import { MemberApi, setupServices } from "./services";

const params = new URLSearchParams(location.search);
const WORLDS: Record<string, { load: () => Promise<{ default: unknown }>; heights?: string; town?: string }> = {
  "emerald-city": { load: () => import("@emerald-city/world/data/emerald-city.world.json") },
  davos: { load: () => import("@emerald-city/world/data/davos.world.json"), heights: davosHeights, town: davosTown },
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
const glbFormat: "auto" | "all" | "off" =
  params.get("assets") === "glb" || import.meta.env.VITE_ASSET_FORMAT === "glb" ? "all" : params.get("assets") === "legacy" || import.meta.env.VITE_ASSET_FORMAT === "legacy" ? "off" : "auto";
const glbBase = (import.meta.env.VITE_MODEL_BASE as string | undefined) ?? "/unity/legacy/";
const useGlb = glbFormat === "all";
const modelBase = assetBase;
const legacyLook = params.get("look") === "legacy";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  // Behind the beta gate, cross-site media (screens) must carry the beta session cookie.
  if (import.meta.env.VITE_GATE_URL) Tools.CorsBehavior = "use-credentials";
  world = (await WORLDS[worldSlug]!.load()).default as WorldManifest;
  const intro = splash(worldSlug, world.name);
  const canvas = $<HTMLCanvasElement>("c");
  const t0 = performance.now();
  let readyAt: number | null = null;
  const { engine, kind } = await createEngine(canvas);
  const q = chooseQuality(params.get("quality"));
  engine.setHardwareScalingLevel(q.hardwareScaling);
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.45, 0);
  if (params.has("shot")) document.querySelectorAll<HTMLElement>("#hud, #loading, #dock, #chat, #help, #compass, #splash").forEach((e) => (e.style.display = "none"));

  // First-person camera at the requested property (or the world default).
  const spawn = spawnFor(world, params.get("pavilion_id"));
  const camera = new UniversalCamera("eye", new Vector3(spawn.position.x, spawn.position.y + 1.7, spawn.position.z), scene);
  camera.rotation.y = spawn.rotationY;
  camera.minZ = 0.2;
  camera.maxZ = world.terrain ? 24000 : 9000;
  camera.angularSensibility = 2200;
  camera.inertia = 0.5; // mouse look settles quickly; movement easing lives in movement.ts
  // Collisions, gravity and steps belong to the player body in movement.ts.
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

  // Emerald City's deluxe glass villas (in place of the 2017 type-4 houses).
  if (world.villas?.length) look.adopt(buildVillas(scene, world.villas));
  let mapTown: OsmTown | null = null;
  // Landscape worlds (Davos, Bermuda): terrain, forest, water, imported shapes and models, portals.
  const landscape = world.terrain || world.primitives?.length || world.portals?.length || world.generated?.length
    ? await buildLandscape(scene, params.has("lite") ? { ...world, trees: undefined, meshes: [] } : world, WORLDS[worldSlug]!.heights ?? null, unityBase)
    : null;
  if (landscape) {
    look.adopt(landscape.meshes);
    // A real town from OpenStreetMap (Davos): buildings, streets, railway and river on the terrain.
    const townUrl = WORLDS[worldSlug]!.town;
    if (world.osm && townUrl && !params.has("notown")) {
      const town = (await (await fetch(townUrl)).json()) as OsmTown;
      mapTown = town;
      const ground = (x: number, z: number) => landscape.surfaceAt(x, z) ?? landscape.groundAt(x, z) ?? 0;
      const townMeshes = buildTown(scene, town, ground);
      landscape.meshes.push(...townMeshes);
      look.adopt(townMeshes);
    }
    // Hub Culture's pavilions (the ICON, the AGENT) on their open ground.
    if (world.pavilions?.length) {
      const ground = (x: number, z: number) => landscape.surfaceAt(x, z) ?? landscape.groundAt(x, z) ?? 0;
      const pav = buildPavilions(scene, world.pavilions, ground);
      landscape.meshes.push(...pav);
      look.adopt(pav);
    }
    // Heightmap worlds stand you on the terrain in movement.ts; the city keeps collision gravity.
    if (world.terrain) scene.gravity = Vector3.Zero();
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
      const text = loading ? `Loading ${loading} building${loading > 1 ? "s" : ""}… ${loaded} ready` : "";
      intro.status(text || "Almost there…");
      $("loading").textContent = text;
      $("loading").style.display = text ? "" : "none";
    },
  }, 1.3, glbFormat, glbBase);

  // Load what's around the spawn before showing the first frame (avoids falling through terrain).
  await streamer.preload(camera.position);
  if (landscape) terrainMeshes.push(...landscape.meshes.filter((m) => m.name === "terrain"));
  // City portals stand on the real floor under them (the city's ground is its models, known only now).
  if (!world.terrain)
    for (const p of landscape?.portals ?? []) {
      const hit = scene.pickWithRay(new Ray(new Vector3(p.position[0], p.position[1] + 20, p.position[2]), Vector3.Down(), 60), (m) => m.checkCollisions && m.isEnabled() && !m.name.startsWith("portal-"));
      const root = scene.getTransformNodeByName(`portal-${p.to}`);
      if (hit?.pickedPoint && root) root.position.y = p.position[1] = hit.pickedPoint.y;
    }
  setInterval(() => {
    streamer.update(camera.position);
    // Safety net: if you ever fall out of the world, return to the spawn point.
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
    const portalTo = pick.pickedMesh.metadata?.portal as string | undefined;
    const portal = landscape?.portals.find((p) => p.to === portalTo);
    if (portal) return travel(portal);
    if (interactions.click(pick.pickedMesh, pick.pickedPoint)) return;
    const name = (pick.pickedMesh.metadata?.screenOf as string | undefined) ?? pick.pickedMesh.name;
    const content = screens.get(name);
    if (content) showScreen(name, content);
  };
  scene.onBeforeRenderObservable.add(() => interactions.tick());
  // Walk, run, jump, fly; terrain worlds stand on the heightmap (cheaper than 260k-vertex collisions).
  const mover = setupMovement(scene, camera, { groundAt: landscape ? (x: number, z: number) => landscape.surfaceAt(x, z) ?? landscape.groundAt(x, z) : null, flying: params.has("fly") });
  // Portals: walk (or fly) through one, or click it, to travel to that world.
  let travelling = false;
  const travelTo = (slug: string, label: string) => {
    if (travelling) return;
    travelling = true;
    const q = new URLSearchParams(location.search);
    for (const k of ["pos", "yaw", "pitch", "pavilion_id"]) q.delete(k);
    if (slug === "emerald-city") q.delete("world");
    else q.set("world", slug);
    $("travel-to").textContent = label;
    $("travel").classList.add("on");
    setTimeout(() => (location.search = q.toString()), 650);
  };
  const travel = (p: Portal) => travelTo(p.to, p.label);
  mover.onMove((from, to) => {
    for (const p of landscape?.portals ?? []) if (crossesPortal(from, to, p)) return travel(p);
  });
  setupHud({ camera, assetBase, onTeleport: () => { mover.sync(); streamer.update(camera.position); }, fly: params.has("fly"), onFly: (on) => mover.setFlying(on), onStick: (x, y) => mover.setStick(x, y) });
  // Double-click the floor to walk there.
  canvas.addEventListener("dblclick", (e) => {
    const hit = scene.pick(e.offsetX * (engine.getRenderWidth() / canvas.clientWidth), e.offsetY * (engine.getRenderHeight() / canvas.clientHeight), (m) => m.isPickable && m.isEnabled() && m.isVisible);
    const n = hit?.getNormal(true);
    if (!hit?.pickedPoint || !n || n.y < 0.6 || Vector3.Distance(hit.pickedPoint, camera.position) > 300) return;
    mover.goTo(hit.pickedPoint);
    showRipple(e.clientX, e.clientY);
  });

  // Places to go in this world: arrival kiosk destinations and property entrances.
  const goTo = (pos: Vector3, yaw?: number) => {
    camera.position.copyFrom(pos.add(new Vector3(0, 1.7, 0)));
    if (yaw !== undefined) camera.rotation.y = yaw;
    mover.sync();
    streamer.update(camera.position);
  };
  // Services: People, Wallet (Ven), Profile, through the beta gate's member API.
  // On the live site (vr.hubculture.city) they come from hubculture.city/city/api instead (VITE_MEMBER_API).
  const gateUrl = (import.meta.env.VITE_GATE_URL as string | undefined) ?? null;
  const memberApi = (import.meta.env.VITE_MEMBER_API as string | undefined) ?? null;
  const siteUrl = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://beta.hubculture.city";
  setupServices({
    api: MemberApi.from(memberApi, gateUrl),
    here: () => people?.here() ?? [],
    goTo: (hubId) => {
      const spot = people?.spotNear(hubId);
      if (!spot) return false;
      camera.position.copyFrom(spot.position);
      camera.rotation.y = spot.yaw;
      mover.sync();
      streamer.update(camera.position);
      return true;
    },
    siteUrl,
    gateUrl,
    signOutUrl: gateUrl ? `${gateUrl}/_gate/logout` : memberApi ? `${siteUrl}/logout` : null,
    signInLinked: !!(gateUrl || import.meta.env.VITE_SIGNIN_URL),
  });
  // Properties go by name and street address ("Zeke Terrace · 001 Radiant Lane"), not by number.
  const addresses = lotAddresses(world);
  const names = new Map<string, string>(world.zones.map((z) => [String(z.pavilionId), z.pavilionName]));
  const villaOwners = new Map<string, string>(); // villa lot → the property standing there
  try {
    const feed = (await (await fetch(`${siteUrl}/city/api/property-designs`, { signal: AbortSignal.timeout(2500) })).json()) as {
      items?: { pavilionId: number; name?: string; lot?: string | null }[];
      names?: { pavilionId: number; name: string }[];
    };
    for (const it of [...(feed.names ?? []), ...(feed.items ?? [])]) if (it.name) names.set(String(it.pavilionId), it.name);
    for (const it of feed.items ?? []) if (it.lot && it.name) villaOwners.set(it.lot, it.name);
  } catch {
    // the site's feed is optional; names from the world data still show
  }
  const propertyLabel = (id: string) => [names.get(id) ?? `Property ${id}`, addresses.get(id)].filter(Boolean).join(" · ");
  const villaStreet = villaAddresses(world);
  const villaLabel = (id: string) => `${villaOwners.get(id) ?? "Glass villa (available)"} · ${villaStreet.get(id)}`;
  // The map (M), for every world: streets, portals, pavilions, landmarks, properties, people, you.
  {
    const ui = (f: string) => `${assetBase}models/ui/${f}`;
    const stand = (x: number, y: number, z: number, yaw?: number) => () => goTo(new Vector3(x, y, z), yaw);
    const toPortal = (p: Portal) => () => {
      // Stand a few metres in front of it, facing it, so one step forward goes through.
      const a = world.defaultSpawn.position;
      const dx = a.x - p.position[0], dz = a.z - p.position[2], d = Math.hypot(dx, dz) || 1;
      const x = p.position[0] + (dx / d) * 5, z = p.position[2] + (dz / d) * 5;
      goTo(new Vector3(x, p.position[1], z), Math.atan2(p.position[0] - x, p.position[2] - z));
    };
    const markers: MapMarker[] = [
      ...(world.portals ?? []).map((p) => ({ label: `Portal to ${p.label}`, x: p.position[0], z: p.position[2], kind: "portal" as const, go: toPortal(p) })),
    ];
    if (worldSlug === "emerald-city") {
      markers.push(...MAP_STOPS.map((st) => ({ label: st.label, x: st.pos[0], z: st.pos[2], kind: "stop" as const, icon: ui(`map_icons/${st.icon}_icon.png`), go: () => {
        camera.position.set(...st.pos);
        camera.rotation.y = st.yaw;
        mover.sync();
        streamer.update(camera.position);
      } })));
      for (const [id, sp] of Object.entries(world.spawns)) {
        if (/^\d+$/.test(id)) markers.push({ label: propertyLabel(id), x: sp.position.x, z: sp.position.z, kind: "property", go: stand(sp.position.x, sp.position.y, sp.position.z, sp.rotationY) });
      }
      for (const v of world.villas ?? []) {
        // Stand on the terrace by the pool, facing the door.
        const yaw = v.rotationY, fx = Math.sin(yaw), fz = Math.cos(yaw);
        const x = v.position[0] + fx * 16, z = v.position[2] + fz * 16;
        markers.push({ label: villaLabel(v.id), x: v.position[0], z: v.position[2], kind: "property", go: stand(x, v.position[1], z, yaw + Math.PI) });
      }
    } else {
      for (const t of world.teleports.filter((t) => t.group === "kiosk"))
        markers.push({ label: t.label, x: t.position.x, z: t.position.z, kind: t.id.startsWith("hub-") ? "pavilion" : "landmark", go: stand(t.position.x, t.position.y, t.position.z, t.rotationY) });
    }
    const t = world.terrain;
    const a = world.defaultSpawn.position;
    const bounds = worldSlug === "emerald-city"
      ? { minX: -1810, maxX: 1810, minZ: -1810, maxZ: 1810 } // the legacy map covers the terrain's square
      : mapTown
        ? { minX: a.x - 900, maxX: a.x + 900, minZ: a.z - 900, maxZ: a.z + 900 }
        : t
          ? { minX: t.origin[0], maxX: t.origin[0] + t.size[0], minZ: t.origin[2], maxZ: t.origin[2] + t.size[1] }
          : { minX: a.x - 500, maxX: a.x + 500, minZ: a.z - 500, maxZ: a.z + 500 };
    const ocean = world.environment?.water?.find((w) => w.kind === "ocean");
    setupMap({
      camera,
      worldName: world.name,
      bounds,
      baseImage: worldSlug === "emerald-city" ? ui("map.png") : undefined,
      ground: landscape ? (x, z) => landscape.surfaceAt(x, z) ?? landscape.groundAt(x, z) : null,
      waterY: ocean ? ocean.center[1] : null,
      style: world.terrain?.style ?? world.environment?.style as "alpine" | "tropical" | "temperate" | undefined,
      town: mapTown,
      markers,
      others: () => {
        try {
          return people?.positions() ?? [];
        } catch {
          return []; // presence not started yet
        }
      },
    });
  }
  setupUi({
    worldSlug,
    travel: travelTo,
    gateUrl: (import.meta.env.VITE_GATE_URL as string | undefined) ?? null,
    places: [
      ...world.teleports.filter((t) => t.group === "kiosk").map((t) => ({ label: t.label, group: t.id.startsWith("hub-") ? "Hub Culture" : "Landmark", go: () => goTo(new Vector3(t.position.x, t.position.y, t.position.z), t.rotationY) })),
      ...Object.entries(world.spawns).map(([id, sp]) => ({ label: id ? (/^\d+$/.test(id) ? propertyLabel(id) : id[0]!.toUpperCase() + id.slice(1)) : "Lotus", group: /^\d+$/.test(id) ? "Property" : "Place", go: () => goTo(new Vector3(sp.position.x, sp.position.y, sp.position.z), sp.rotationY) })),
      ...(world.villas ?? []).map((v) => ({ label: villaLabel(v.id), group: "Property", go: () => goTo(new Vector3(v.position[0] + Math.sin(v.rotationY) * 16, v.position[1], v.position[2] + Math.cos(v.rotationY) * 16), v.rotationY + Math.PI) })),
    ],
  });

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

  $("title").textContent = `${world.name}${legacyLook ? " · legacy look" : ""}`;
  $("title").title = kind === "webgpu" ? "Rendering with WebGPU" : "Rendering with WebGL2";
  let frame = 0;
  engine.runRenderLoop(() => {
    scene.render();
    if (++frame % 30 === 0) $("stats").textContent = `${engine.getFps().toFixed(0)} fps · ${kind === "webgpu" ? "WebGPU" : "WebGL2"}`;
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
  intro.done();
  const people = await startPeople(scene, camera, world, worldSlug);
  readyAt = performance.now() - t0;
  if (params.has("perf") || params.has("bench")) {
    const sample = startPerfOverlay(engine, scene, kind, q, () => readyAt);
    if (params.has("bench")) runBenchmark(scene, camera, sample, { world: worldSlug, quality: q.quality, renderer: kind, assets: useGlb ? "glb" : "legacy", readyMs: Math.round(readyAt) });
  }
  if (params.has("debug")) Object.assign(window, { __city: { scene, camera, interactions, people, streamer, mover } });
  (window as unknown as { __ready: boolean }).__ready = true;
}

/**
 * People in the world (presence server). On beta, the member signed in once with HubID at the beta
 * gate; the 3D city asks the gate for their HubID token (VITE_GATE_URL, cookie for
 * *.beta.hubculture.city). Locally the dev presence server accepts test identities.
 */
async function presenceToken(): Promise<string | null> {
  // Live: single sign-on with hubculture.city (VITE_SESSION_URL, e.g. https://hubculture.city/city/session).
  const session = import.meta.env.VITE_SESSION_URL as string | undefined;
  if (session) {
    try {
      const r = await fetch(session, { credentials: "include" });
      if (r.ok) {
        const me = (await r.json()) as { token: string; name: string };
        setMember({ name: me.name }, null, import.meta.env.VITE_SIGNIN_URL as string | undefined);
        return me.token;
      }
    } catch {
      /* fall through: signed out */
    }
    setMember(null, null, import.meta.env.VITE_SIGNIN_URL as string | undefined);
    return null;
  }
  const gate = import.meta.env.VITE_GATE_URL as string | undefined;
  if (gate) {
    try {
      const r = await fetch(`${gate}/_gate/token`, { credentials: "include" });
      if (r.ok) {
        const me = (await r.json()) as { token: string; name: string };
        setMember({ name: me.name }, gate);
        return me.token;
      }
    } catch {
      /* fall through */
    }
    setMember(null, gate);
    return null;
  }
  if (import.meta.env.DEV) {
    const name = (params.get("name") ?? `Visitor ${Math.floor(Math.random() * 900 + 100)}`).replace(/:/g, " ");
    setMember({ name }, null);
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
  // Zeke stands on whatever floor is under his spot (the arrival point's height can be a platform above it).
  const host = new Vector3(spawn.x + 3, spawn.y, spawn.z + 3);
  const floor = scene.pickWithRay(new Ray(host.add(new Vector3(0, 8, 0)), Vector3.Down(), 40), (m) => m.checkCollisions && m.isEnabled());
  if (floor?.pickedPoint) host.y = floor.pickedPoint.y;
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
      setButton("voice-btn", "Voice", false);
    } else {
      people.requestVoice();
      setButton("voice-btn", "Voice on", true);
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
  $("chat-mode").classList.toggle("zeke", mode === "zeke"); // Zeke's teal and soul icon
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
  const msg = `Couldn't start: ${err instanceof Error ? err.message : String(err)}`;
  $("splash-status").textContent = msg;
  $("loading").textContent = msg;
});

/** A soft emerald ring where you double-clicked, so walk-to feels answered. */
function showRipple(x: number, y: number) {
  const r = document.createElement("span");
  r.className = "ripple";
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 700);
}
