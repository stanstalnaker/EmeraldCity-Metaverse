import { MeshBuilder, Vector3, type Mesh, type Scene, type UniversalCamera } from "@babylonjs/core";
import type { Portal } from "@emerald-city/world";

/**
 * Walking, running, jumping and flying, independent of frame rate.
 *
 * Babylon 9 folds anything written to `camera.cameraDirection` through its own inertial glide, so
 * driving the camera that way moved people about twice as fast as asked and never quite stopped.
 * Here an invisible body (a capsule-shaped ellipsoid at the feet) is moved with collisions every
 * frame and the camera rides on it at eye height. Babylon's inputs only turn the view (mouse, touch);
 * their translation is off (`camera.speed = 0`).
 *
 *   WASD / arrows  move (←/→ turn)        Shift  run          Space  jump (walk) · up (fly)
 *   C              down (fly)             double-click the floor: walk there (any key stops)
 *
 * Steps and kerbs: a blocked move retries lifted by up to STEP metres, so stairs and pavements are
 * climbed instead of stopping you. Terrain worlds stand on their heightmap (groundAt).
 */
export interface Mover {
  /** Called every frame with where the eye was and where it is now. */
  onMove: (fn: (from: Vector3, to: Vector3) => void) => void;
  readonly flying: boolean;
  setFlying(on: boolean): void;
  /** Walk to a point (double-click does this); stops when there, blocked, or on any key. */
  goTo(point: Vector3): void;
  /** Stick input from an on-screen joystick: x = right, y = forward, each -1..1. */
  setStick(x: number, y: number): void;
  /** After a teleport: put the body under the camera and stop. */
  sync(): void;
}

export const SPEED = { walk: 5, run: 12, fly: 28, flyFast: 90, turn: 1.9, jump: 5.6, gravity: 22, glide: 9 };
export const EYE = 1.7;
const STEP = 0.45;
const RADIUS = 0.45;

export function setupMovement(
  scene: Scene,
  camera: UniversalCamera,
  o: { groundAt?: ((x: number, z: number) => number | null) | null; flying?: boolean },
): Mover {
  // Babylon's inputs only look around now; we do all the moving.
  camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];
  camera.speed = 0;
  camera.checkCollisions = false;
  camera.applyGravity = false;

  // The body: an ellipsoid whose bottom is the feet. It never draws and nothing collides with it.
  const body: Mesh = MeshBuilder.CreateBox("player-body", { size: 0.01 }, scene);
  body.isVisible = false;
  body.isPickable = false;
  body.checkCollisions = false;
  body.ellipsoid = new Vector3(RADIUS, EYE / 2 + 0.05, RADIUS);
  body.ellipsoidOffset = new Vector3(0, EYE / 2 + 0.05, 0);
  const feetOf = (eye: Vector3) => new Vector3(eye.x, eye.y - EYE, eye.z);
  body.position.copyFrom(feetOf(camera.position));

  const down = new Set<string>();
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };
  let flying = !!o.flying;
  const vel = new Vector3();
  let vy = 0;
  let grounded = false;
  let target: Vector3 | null = null;
  let targetSince = 0;
  let lastProgress = 0;
  const stick = { x: 0, y: 0 };

  window.addEventListener("keydown", (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey) return;
    down.add(e.code);
    target = null; // any key takes over from walk-to
    if (e.code === "Space") {
      e.preventDefault();
      if (!flying && grounded) {
        vy = SPEED.jump;
        grounded = false;
      }
    }
  });
  window.addEventListener("keyup", (e) => down.delete(e.code));
  window.addEventListener("blur", () => down.clear());

  const prev = camera.position.clone();
  const listeners: ((from: Vector3, to: Vector3) => void)[] = [];
  const tmp = new Vector3();

  /** Move the body with collisions; climb a step if a horizontal move is blocked. */
  const moveBody = (d: Vector3) => {
    const before = body.position.clone();
    body.moveWithCollisions(d);
    const horiz = Math.hypot(d.x, d.z);
    if (horiz > 1e-4 && !flying) {
      const done = Math.hypot(body.position.x - before.x, body.position.z - before.z);
      if (done < horiz * 0.5) {
        const blocked = body.position.clone();
        body.position.copyFrom(before);
        body.moveWithCollisions(new Vector3(0, STEP, 0));
        const lifted = body.position.y - before.y;
        body.moveWithCollisions(new Vector3(d.x, 0, d.z));
        const done2 = Math.hypot(body.position.x - before.x, body.position.z - before.z);
        if (lifted > 0.05 && done2 > done + horiz * 0.3) {
          body.moveWithCollisions(new Vector3(0, -lifted, 0)); // settle onto the step
        } else {
          body.position.copyFrom(blocked);
        }
      }
    }
  };

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    if (dt <= 0) return;
    // Someone else moved the camera (teleport, map, Go to): follow it.
    if (Vector3.DistanceSquared(feetOf(camera.position), body.position) > 0.25) {
      body.position.copyFrom(feetOf(camera.position));
      vel.setAll(0);
      vy = 0;
      target = null;
    }
    const k = (c: string) => (down.has(c) ? 1 : 0);
    let fwd = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown") + stick.y;
    let side = k("KeyD") - k("KeyA") + stick.x;
    camera.rotation.y += (k("ArrowRight") - k("ArrowLeft")) * SPEED.turn * dt;
    const fast = down.has("ShiftLeft") || down.has("ShiftRight");
    let speed = flying ? (fast ? SPEED.flyFast : SPEED.fly) : fast ? SPEED.run : SPEED.walk;

    // Walk-to: face the target and go, until close, stuck or out of time.
    if (target) {
      const dx = target.x - body.position.x;
      const dz = target.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      const now = performance.now();
      if (dist < 0.8 || now - targetSince > 20000 || (now - lastProgress > 1200 && now - targetSince > 1200)) target = null;
      else {
        const want = Math.atan2(dx, dz);
        let diff = want - camera.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        camera.rotation.y += diff * Math.min(1, dt * 6);
        fwd = Math.cos(diff) > 0.3 ? Math.min(1, dist / 3 + 0.25) : 0;
        side = 0;
        speed = SPEED.glide;
      }
    }

    const yaw = camera.rotation.y;
    const f = flying ? camera.getDirection(Vector3.Forward()) : new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const want = f.scale(fwd).addInPlace(r.scale(side));
    if (want.lengthSquared() > 1) want.normalize();
    want.scaleInPlace(speed);
    if (flying) want.y += (k("Space") - k("KeyC")) * speed * 0.6;
    // Ease: quick to start, quicker to stop.
    const rate = want.lengthSquared() > 0.01 ? 10 : 16;
    Vector3.LerpToRef(vel, want, 1 - Math.exp(-rate * dt), vel);
    if (vel.lengthSquared() < 1e-4 && want.lengthSquared() === 0) vel.setAll(0);

    const before = body.position.clone();
    if (flying) {
      body.position.addInPlace(vel.scale(dt));
      vy = 0;
      grounded = false;
    } else {
      // Horizontal, with steps; then vertical, with gravity.
      moveBody(new Vector3(vel.x * dt, 0, vel.z * dt));
      vy = Math.max(vy - SPEED.gravity * dt, -40);
      const wantY = vy * dt;
      const y0 = body.position.y;
      body.moveWithCollisions(new Vector3(0, wantY, 0));
      const gotY = body.position.y - y0;
      if (wantY < 0 && gotY > wantY * 0.5) {
        grounded = true;
        vy = 0;
      } else if (wantY > 0 && gotY < wantY * 0.5) {
        vy = 0; // bumped a ceiling
      } else grounded = false;
      // Heightmap worlds: never below the terrain.
      const g = o.groundAt ? o.groundAt(body.position.x, body.position.z) : null;
      if (g !== null && body.position.y <= g) {
        body.position.y = g;
        vy = Math.max(vy, 0);
        grounded = true;
      }
    }
    if (target && Vector3.DistanceSquared(before, body.position) > 1e-4) lastProgress = performance.now();
    tmp.copyFrom(body.position);
    tmp.y += EYE;
    camera.position.copyFrom(tmp);
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
      vel.setAll(0);
      vy = 0;
    },
    goTo(point) {
      target = point.clone();
      targetSince = lastProgress = performance.now();
    },
    setStick(x, y) {
      stick.x = Math.max(-1, Math.min(1, x));
      stick.y = Math.max(-1, Math.min(1, y));
      if (x || y) target = null;
    },
    sync() {
      body.position.copyFrom(feetOf(camera.position));
      vel.setAll(0);
      vy = 0;
      target = null;
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
