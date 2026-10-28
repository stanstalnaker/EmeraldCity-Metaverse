import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import type { LngLat, ServerMessage } from "@emerald-city/core";
import { toLocal } from "./projection";

const hud = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1411);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(200, 400, 100);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 50_000);
camera.position.set(0, 600, 900);
const controls = new OrbitControls(camera, renderer.domElement);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40_000, 40_000), new THREE.MeshStandardMaterial({ color: 0x15241e }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

interface ParcelFeature {
  id: number;
  geometry: { coordinates: [number, number][][] };
  properties: { name: string };
}

/** Geographic point at the scene origin, set once parcels load. */
let sceneOrigin: LngLat | null = null;

async function loadParcels() {
  const res = await fetch("/api/properties?shape=parcels");
  const fc = (await res.json()) as { features: ParcelFeature[] };
  if (fc.features.length === 0) {
    hud.textContent = "No placed properties yet.";
    return;
  }
  // Origin = first parcel's centre; a local tangent plane is accurate to well under a metre across a city.
  const ring0 = fc.features[0]!.geometry.coordinates[0]!;
  const origin: LngLat = { lng: (ring0[0]![0] + ring0[2]![0]) / 2, lat: (ring0[0]![1] + ring0[2]![1]) / 2 };
  sceneOrigin = origin;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1fa37a, transparent: true, opacity: 0.8 });

  for (const f of fc.features) {
    const ring = f.geometry.coordinates[0]!;
    const shape = new THREE.Shape(ring.map(([lng, lat]) => {
      const p = toLocal(origin, { lng, lat });
      return new THREE.Vector2(p.x, -p.z);
    }));
    const geom = new THREE.ExtrudeGeometry(shape, { depth: 30, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { propertyId: f.id, name: f.properties.name };
    scene.add(mesh);
  }
  hud.textContent = `${fc.features.length} properties`;
}

// Presence: avatars for everyone in the global map room.
const avatars = new Map<number, THREE.Mesh>();
function connectPresence(origin: () => LngLat | null) {
  const url = import.meta.env.VITE_PRESENCE_URL as string | undefined;
  const token = new URLSearchParams(location.search).get("token");
  if (!url || !token) return;
  const ws = new WebSocket(url, ["hubid", token]);
  ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: "map" }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data as string) as ServerMessage;
    const place = (hubId: number, kind: "human" | "agent", geo?: LngLat) => {
      let a = avatars.get(hubId);
      if (!a) {
        a = new THREE.Mesh(
          kind === "agent" ? new THREE.OctahedronGeometry(6) : new THREE.CapsuleGeometry(3, 8),
          new THREE.MeshStandardMaterial({ color: kind === "agent" ? 0x7aa7ff : 0xffffff }),
        );
        avatars.set(hubId, a);
        scene.add(a);
      }
      const o = origin();
      if (geo && o) {
        const p = toLocal(o, geo);
        a.position.set(p.x, 10, p.z);
      }
    };
    if (m.t === "roster") for (const x of m.members) place(x.actor.hubId, x.actor.kind, x.pos?.geo);
    if (m.t === "joined") place(m.actor.hubId, m.actor.kind);
    if (m.t === "moved" && avatars.has(m.hubId) && m.pos.geo) {
      const o = origin();
      if (o) {
        const p = toLocal(o, m.pos.geo);
        avatars.get(m.hubId)!.position.set(p.x, 10, p.z);
      }
    }
    if (m.t === "left") {
      const a = avatars.get(m.hubId);
      if (a) scene.remove(a);
      avatars.delete(m.hubId);
    }
  };
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

loadParcels().catch((err) => (hud.textContent = `Failed to load properties: ${err}`));
connectPresence(() => sceneOrigin);
