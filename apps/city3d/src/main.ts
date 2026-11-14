/**
 * Emerald City 3D (Babylon.js 9). Renders a world manifest: streams the city's models, spawns at a
 * property (?pavilion_id=, compatible with the live site's links), teleports via the arrival kiosk
 * and lifts, and makes the ~150 property screens interactive.
 *
 * ?look=legacy  flat legacy lighting for comparison · ?renderer=webgl  force WebGL2 · ?shot  no HUD
 * ?off=ssao,shadows,detail  switch individual effects off (debugging) · ?fly&pos=x,y,z&yaw=&pitch=  camera
 */
import { Scene, UniversalCamera, Vector3, type AbstractMesh } from "@babylonjs/core";
import type { ScreenContent, WorldManifest } from "@emerald-city/world";
import emeraldCity from "@emerald-city/world/data/emerald-city.world.json";
import { spawnFor } from "@emerald-city/world";
import { createEngine } from "./engine";
import { setupLegacyLook, setupRealism } from "./realism";
import { WorldStreamer } from "./streaming";

const params = new URLSearchParams(location.search);
const world = emeraldCity as unknown as WorldManifest;
const assetBase = (import.meta.env.VITE_ASSET_BASE as string | undefined) ?? "/legacy/";
const legacyLook = params.get("look") === "legacy";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const canvas = $<HTMLCanvasElement>("c");
  const { engine, kind } = await createEngine(canvas);
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.45, 0);
  if (params.has("shot")) document.querySelectorAll<HTMLElement>("#hud, #loading").forEach((e) => (e.style.display = "none"));

  // First-person camera at the requested property (or the world default).
  const spawn = spawnFor(world, params.get("pavilion_id"));
  const camera = new UniversalCamera("eye", new Vector3(spawn.position.x, spawn.position.y + 1.7, spawn.position.z), scene);
  camera.rotation.y = spawn.rotationY;
  camera.minZ = 0.2;
  camera.maxZ = 9000;
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
    : setupRealism(scene, camera, kind, { shadows: !off.has("shadows"), ssao: !off.has("ssao"), detail: !off.has("detail") });

  // Screens: mesh name → what it shows.
  const screens = new Map(world.screens.map((s) => [s.mesh, s.content]));
  const wireScreens = (meshes: AbstractMesh[]) => {
    for (const mesh of meshes) if (screens.has(mesh.name)) mesh.isPickable = true;
  };

  const terrainMeshes: AbstractMesh[] = [];
  const streamer = new WorldStreamer(scene, world, assetBase, {
    onLoaded(model, container) {
      look.adopt(container.meshes);
      wireScreens(container.meshes);
      if (model.id === "terrain") terrainMeshes.push(...container.meshes);
    },
    onUnloaded(_model, container) {
      look.release(container.meshes);
    },
    onProgress(loading, loaded) {
      $("loading").textContent = loading ? `Loading ${loading} building${loading > 1 ? "s" : ""}… (${loaded} loaded)` : `${loaded} buildings loaded`;
    },
  });

  // Load what's around the spawn before showing the first frame (avoids falling through terrain).
  camera.applyGravity = false;
  await streamer.preload(camera.position);
  camera.applyGravity = !params.has("fly");
  setInterval(() => streamer.update(camera.position), 500);

  // Click a screen to see what it shows.
  scene.onPointerDown = (_evt, pick) => {
    const content = pick?.hit && pick.pickedMesh ? screens.get(pick.pickedMesh.name) : undefined;
    if (content) showScreen(pick!.pickedMesh!.name, content);
  };

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
  (window as unknown as { __ready: boolean }).__ready = true;
}

function showScreen(mesh: string, c: ScreenContent) {
  const panel = $("panel");
  panel.style.display = "block";
  const close = `<p><button onclick="this.closest('#panel').style.display='none'">Close</button></p>`;
  if (c.kind === "link") {
    panel.innerHTML = `<h3>Screen · ${mesh}</h3><p>Shows a live page:</p><p><a href="${c.url}" target="_blank" rel="noopener">${c.url}</a></p>${close}`;
  } else if (c.kind === "zone") {
    panel.innerHTML =
      `<h3>${c.pavilionName}</h3><p>Zone <b>${c.zoneName}</b> (${c.zoneType || "zone"}) · ${c.slot === "media" ? "media" : "files"} slot ${c.index + 1}</p>` +
      `<p>Shows what the property owner uploads to this zone on hubculture.city. Live content arrives when this client connects to HubID property zones.</p>` +
      (c.fallbackUrl ? `<p><a href="${c.fallbackUrl}" target="_blank" rel="noopener">Fallback page</a></p>` : "") +
      close;
  } else {
    panel.innerHTML = `<h3>Screen · ${mesh}</h3><p>${c.html.replace(/</g, "&lt;")}</p>${close}`;
  }
}

main().catch((err) => {
  console.error(err);
  $("loading").textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
