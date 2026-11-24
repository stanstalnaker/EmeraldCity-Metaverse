import { Vector3, type UniversalCamera } from "@babylonjs/core";
import { setButton } from "./ui";

/**
 * HUD controls ported from the live client (helpers/ui.js): the map's Emerald City stops (the map
 * itself is map.ts),
 * destinations, compass bar, fly/walk toggle, mobile joysticks, keyboard help.
 */
export const MAP_STOPS: { icon: string; label: string; pos: [number, number, number]; yaw: number }[] = [
  { icon: "welcome", label: "Arrival plaza", pos: [52, 5.3, 388], yaw: 0 },
  { icon: "lounge", label: "Lounge", pos: [-657, 3.3, 278], yaw: 0 },
  { icon: "travel", label: "Travel", pos: [648, 3.3, 276], yaw: 0 },
  { icon: "welcome", label: "Welcome", pos: [670, 3.3, -281], yaw: 0 },
  { icon: "lotus", label: "Lotus", pos: [-10, 25.3, 30], yaw: 0 },
  { icon: "fashion", label: "Fashion Boulevard", pos: [232.37, 3.27, -898.15], yaw: 2.808 },
  { icon: "city_hall", label: "City Hall", pos: [-269, 3.6, 534], yaw: 0 },
  { icon: "emerald", label: "Emerald Plaza", pos: [247, 5, 587], yaw: 0 },
  { icon: "btg", label: "Bridging The Gap", pos: [462.76, 13.33, 950.72], yaw: 0.43 },
  { icon: "m", label: "Monument", pos: [-1214, 3.3, 112.5], yaw: 0 },
  { icon: "amphitheatre", label: "Amphitheatre", pos: [-380, 3.6, -550], yaw: 0 },
  { icon: "outdoor", label: "Outdoor", pos: [174, 22, -497], yaw: 0 },
  { icon: "cognizant", label: "Cognizant", pos: [1042.2, 3.3, -85.2], yaw: 0 },
  { icon: "university", label: "University", pos: [-478.41, 3.27, -824.66], yaw: -2.607 },
  { icon: "childrens", label: "Children's House", pos: [-835, 11.3, -1360], yaw: 0 },
];

export function setupHud(o: { camera: UniversalCamera; assetBase: string; onTeleport: () => void; fly: boolean; onFly?: (on: boolean) => void; onStick?: (x: number, y: number) => void }) {
  const { camera, assetBase } = o;
  const $ = (id: string) => document.getElementById(id)!;
  const ui = (f: string) => `${assetBase}models/ui/${f}`;

  // Fly / walk
  const flyBtn = $("fly-btn");
  let flying = o.fly;
  const setFly = (fly: boolean) => {
    flying = fly;
    o.onFly?.(fly);
    setButton("fly-btn", fly ? "Flying" : "Fly", fly);
  };
  setFly(o.fly);
  flyBtn.onclick = () => setFly(!flying);

  // Compass: a strip of headings every 15° (3 turns long, so it can wrap), slid under a fixed pointer.
  const strip = $("compass-strip");
  const STEP = 30; // px per 15°
  const names: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  let html = "";
  for (let turn = 0; turn < 3; turn++)
    for (let d = 0; d < 360; d += 15) html += names[d] ? `<span class="${d % 90 === 0 ? "c" : ""}">${names[d]}</span>` : `<span class="t">|</span>`;
  strip.innerHTML = html;
  const compass = $("compass");
  let lastX = NaN;
  setInterval(() => {
    const deg = ((((camera.rotation.y * 180) / Math.PI) % 360) + 360) % 360;
    // Centre of the heading's tick under the pointer; start in the middle turn.
    const x = compass.clientWidth / 2 - (360 / 15) * STEP - (deg / 15) * STEP - STEP / 2;
    if (Math.abs(x - lastX) > 0.2) strip.style.transform = `translateX(${x.toFixed(1)}px)`;
    lastX = x;
  }, 33);

  // Touch devices: virtual joysticks (the live site used VirtualJoysticksCamera).
  if ("ontouchstart" in window) {
    // A thumb stick for moving; dragging anywhere else turns the view (Babylon's touch input).
    const pad = document.createElement("div");
    pad.id = "stick";
    pad.innerHTML = "<i></i>";
    document.body.appendChild(pad);
    const knob = pad.firstElementChild as HTMLElement;
    let id: number | null = null;
    const R = 46;
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      let x = e.clientX - (r.left + r.width / 2);
      let y = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(x, y);
      if (d > R) { x = (x / d) * R; y = (y / d) * R; }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      o.onStick?.(x / R, -y / R);
    };
    pad.addEventListener("pointerdown", (e) => { id = e.pointerId; pad.setPointerCapture(id); move(e); e.preventDefault(); });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ""; o.onStick?.(0, 0); };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
    $("help").innerHTML = "<span>Left stick moves</span><span>right stick looks</span><span>tap screens, portals and buttons</span>";
  }

  // Screen panel
  $("screen-close").onclick = () => {
    $("screen").style.display = "none";
    $("screen-body").innerHTML = "";
  };
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "f" || e.key === "F") flyBtn.click();
    if (e.key === "Escape") {
      $("map").style.display = "none";
      $("screen-close").click();
    }
  });
}
