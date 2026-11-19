import { Vector3, type Scene, type UniversalCamera } from "@babylonjs/core";
import type { Portal } from "@emerald-city/world";

/**
 * Walking, running, jumping and flying, independent of frame rate.
 *
 * Babylon's built-in keyboard input moves a fixed amount per frame (fast on 120 Hz screens, slow on
 * phones) and stops dead. Here keys set a target velocity in metres per second and the camera eases
 * towards it, so starts and stops feel smooth. Mouse/touch look stays with Babylon's inputs.
 *
 *   WASD / arrows  move (←/→ turn when the mouse isn't used)
 *   Shift          run
 *   Space          jump (walk) · up (fly)
 *   C              down (fly)
 *
 * Ground: terrain worlds use the heightmap (groundAt); elsewhere the city's collision meshes and
 * gravity hold you up.
 */
export interface Mover {
  /** Called every frame with where the eye was and where it is now. */
  onMove: (fn: (from: Vector3, to: Vector3) => void) => void;
  readonly flying: boolean;
  setFlying(on: boolean): void;
}

export const SPEED = { walk: 6, run: 15, fly: 28, flyFast: 90, turn: 1.9, jump: 6.2, gravity: 20 };
const EYE = 1.7;

export function setupMovement(
  scene: Scene,
  camera: UniversalCamera,
  o: { groundAt?: ((x: number, z: number) => number | null) | null; flying?: boolean },
): Mover {
  // Our own keyboard handling replaces the per-frame one.
  camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];

  const down = new Set<string>();
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };
  window.addEventListener("keydown", (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey) return;
    down.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      if (!flying && grounded) {
        vy = SPEED.jump;
        jumping = true;
        grounded = false;
      }
    }
  });
  window.addEventListener("keyup", (e) => down.delete(e.code));
  window.addEventListener("blur", () => down.clear());

  let flying = !!o.flying;
  const vel = new Vector3();
  let vy = 0;
  let jumping = false;
  let grounded = true;
  let lastY = camera.position.y;
  const prev = camera.position.clone();
  const listeners: ((from: Vector3, to: Vector3) => void)[] = [];

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    if (dt <= 0) return;
    const k = (c: string) => (down.has(c) ? 1 : 0);
    const fwd = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown");
    const side = k("KeyD") - k("KeyA");
    camera.rotation.y += (k("ArrowRight") - k("ArrowLeft")) * SPEED.turn * dt;
    const fast = down.has("ShiftLeft") || down.has("ShiftRight");
    const speed = flying ? (fast ? SPEED.flyFast : SPEED.fly) : fast ? SPEED.run : SPEED.walk;

    // Target velocity: on the ground plane when walking; along the view (and Space/C) when flying.
    const yaw = camera.rotation.y;
    const f = flying ? camera.getDirection(Vector3.Forward()) : new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const target = f.scale(fwd).addInPlace(r.scale(side));
    if (target.lengthSquared() > 1) target.normalize();
    target.scaleInPlace(speed);
    if (flying) target.y += (k("Space") - k("KeyC")) * speed * 0.6;
    // Ease: quick to start, quicker to stop.
    const rate = target.lengthSquared() > 0.01 ? 9 : 14;
    Vector3.LerpToRef(vel, target, 1 - Math.exp(-rate * dt), vel);
    if (vel.lengthSquared() < 1e-4 && target.lengthSquared() === 0) vel.setAll(0);

    const step = vel.scale(dt);
    const g = !flying && o.groundAt ? o.groundAt(camera.position.x, camera.position.z) : null;
    if (flying) {
      vy = 0;
      grounded = false;
    } else if (g !== null) {
      // Heightmap ground: our own gravity, no collision-mesh gravity.
      vy -= SPEED.gravity * dt;
      const eye = g + EYE;
      let y = camera.position.y + vy * dt;
      if (y <= eye) {
        y = eye;
        vy = 0;
        jumping = false;
        grounded = true;
      } else grounded = false;
      step.y = y - camera.position.y;
    } else if (camera.applyGravity) {
      // City: Babylon adds scene.gravity each frame during collisions; a jump pushes against it.
      const sceneG = -scene.gravity.y;
      if (jumping) {
        vy -= SPEED.gravity * dt;
        if (vy <= 0) jumping = false;
        else step.y = vy * dt + sceneG;
      }
      const moved = camera.position.y - lastY;
      grounded = !jumping && moved > -0.02;
    }
    lastY = camera.position.y;
    // Replaces (not adds to) whatever is left from the last frame, so motion never doubles up.
    camera.cameraDirection.copyFrom(step);
  });

  scene.onAfterRenderObservable.add(() => {
    const now = camera.position;
    if (!now.equalsWithEpsilon(prev, 1e-4)) for (const fn of listeners) fn(prev, now);
    prev.copyFrom(now);
  });

  return {
    onMove: (fn) => listeners.push(fn),
    get flying() {
      return flying;
    },
    setFlying(on) {
      flying = on;
      vel.y = 0;
    },
  };
}

/**
 * Did the eye pass through a portal between two frames? The veil is a disc standing upright
 * (facing ±z) whose centre is 2.3 m above the portal's base; it counts if the path crosses its plane
 * within the opening, or ends right inside it. Testing the path, not just the end point, means
 * running or flying can't skip a portal between frames.
 */
export function crossesPortal(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, p: Portal, radius = 2.1): boolean {
  // Work in the portal's frame: opening across local x, facing local z.
  const [ox, py, oz] = p.position;
  const c = Math.cos(p.rotationY ?? 0);
  const s = Math.sin(p.rotationY ?? 0);
  const local = (q: { x: number; y: number; z: number }) => ({ x: (q.x - ox) * c - (q.z - oz) * s, y: q.y, z: (q.x - ox) * s + (q.z - oz) * c });
  from = local(from);
  to = local(to);
  const [px, pz] = [0, 0];
  const cy = py + 2.3;
  // The eye sits 1.7 m above the feet; the body passes through if the eye is within the opening's
  // height band (from just above the base to a little over the top).
  const inside = (x: number, y: number) => Math.abs(x - px) < radius && y > py + 0.2 && y < cy + radius + 1.5;
  const a = from.z - pz;
  const b = to.z - pz;
  if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) {
    const t = a === b ? 0 : a / (a - b);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (inside(x, y)) return true;
  }
  return Math.hypot(to.x - px, to.z - pz) < 1.2 && inside(to.x, to.y);
}
