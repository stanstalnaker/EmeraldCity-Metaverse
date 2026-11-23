import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scalar,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type Scene,
  type UniversalCamera,
} from "@babylonjs/core";
import { deriveSigil, rooms, type Actor, type ClientMessage, type Position, type ServerMessage } from "@emerald-city/core";
import { mandalaTexture, sigilColour } from "./mandala-art";

/**
 * Other people and agents in the 3D world, through the presence server (apps/presence).
 *
 * Identity is never chosen by the client: the server derives it from the HubID token. Agents are
 * always drawn with a visible "AI" badge and an emerald ring, so humans can tell them apart
 * (project rule). Movement is sent a few times a second and smoothed on arrival. Chat appears as
 * bubbles over avatars and in the chat panel. Zeke is the host by the arrival point: questions go
 * to the presence service "zeke". Voice is LiveKit with each voice placed at its avatar.
 */
export interface PeopleOptions {
  scene: Scene;
  camera: UniversalCamera;
  worldSlug: string;
  url: string;
  token: string;
  /** Where Zeke stands (the arrival point). */
  hostPosition: Vector3;
  log: (line: string, kind?: "chat" | "system" | "zeke") => void;
}

interface Avatar {
  actor: Actor;
  root: TransformNode;
  target: Vector3;
  heading: number;
  bubble?: { mesh: Mesh; until: number };
  audio?: { panner: PannerNode };
}

const SEND_EVERY_MS = 150;

export class People {
  private ws: WebSocket | null = null;
  private self: Actor | null = null;
  private readonly avatars = new Map<number, Avatar>();
  private readonly room: string;
  private lastSent = { at: 0, x: NaN, y: NaN, z: NaN, h: NaN };
  private pending = new Map<string, (text: string) => void>();
  private audioCtx: AudioContext | null = null;
  private voice: { disconnect: () => Promise<void> } | null = null;
  private retry = 1000;
  /** True from a dropped connection until the next welcome (to say "Disconnected" once per outage). */
  private outage = false;
  /** Rooms whose "N people here" line was already shown. */
  private announced = new Set<string>();

  constructor(private readonly o: PeopleOptions) {
    this.room = rooms.world(o.worldSlug);
    this.connect();
    o.scene.onBeforeRenderObservable.add(() => this.tick());
    this.spawnHost();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get count() {
    return this.avatars.size;
  }

  /** Everyone else in this world right now, nearest first (agents marked, so people can tell). */
  here(): { hubId: number; name: string; kind: "human" | "agent"; distance: number }[] {
    const me = this.o.camera.position;
    return [...this.avatars.values()]
      .filter((a) => a.actor.hubId > 0)
      .map((a) => ({ hubId: a.actor.hubId, name: a.actor.displayName, kind: a.actor.kind, distance: Vector3.Distance(me, a.root.position) }))
      .sort((x, y) => x.distance - y.distance);
  }

  /** A spot a couple of metres in front of someone, facing them, to stand at after "Go to". */
  spotNear(hubId: number): { position: Vector3; yaw: number } | null {
    const a = this.avatars.get(hubId);
    if (!a) return null;
    const p = a.root.position;
    const ahead = new Vector3(Math.sin(a.heading), 0, Math.cos(a.heading)).scale(2.2);
    const spot = p.add(ahead);
    return { position: new Vector3(spot.x, p.y + 1.7, spot.z), yaw: Math.atan2(p.x - spot.x, p.z - spot.z) };
  }

  private connect() {
    // Browsers can't set headers on WebSockets: the token travels as the "token" query parameter.
    const ws = new WebSocket(`${this.o.url}?token=${encodeURIComponent(this.o.token)}`);
    this.ws = ws;
    let openedAt = 0;
    ws.onopen = () => {
      openedAt = performance.now();
      this.send({ t: "join", room: this.room });
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      for (const id of [...this.avatars.keys()]) this.remove(id);
      // Back off only when connections keep failing; a connection that lasted a while resets it.
      if (openedAt && performance.now() - openedAt > 60_000) this.retry = 1000;
      // Say it once per outage, not on every retry.
      if (!this.outage) this.o.log("Disconnected from the city. Reconnecting…", "system");
      this.outage = true;
      setTimeout(() => this.connect(), (this.retry = Math.min(this.retry * 2, 30000)));
    };
  }

  private send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case "welcome":
        if (this.outage) this.o.log("Reconnected.", "system");
        else if (!this.self) this.o.log(`Connected as ${m.self.displayName}${m.self.kind === "agent" ? " (agent)" : ""}.`, "system");
        this.self = m.self;
        this.outage = false;
        break;
      case "roster":
        if (m.room !== this.room) return;
        {
          const others = m.members.filter(({ actor }) => actor.hubId !== this.self?.hubId);
          for (const { actor, pos } of others) this.upsert(actor, pos);
          if (!this.announced.has(m.room)) this.o.log(others.length ? `${others.length} other ${others.length === 1 ? "person" : "people"} here.` : "Nobody else is here yet.", "system");
          this.announced.add(m.room);
        }
        break;
      case "joined":
        if (m.room === this.room && m.actor.hubId !== this.self?.hubId) {
          this.upsert(m.actor);
          this.o.log(`${m.actor.displayName}${m.actor.kind === "agent" ? " (agent)" : ""} arrived.`, "system");
        }
        break;
      case "left":
        if (m.room === this.room) this.remove(m.hubId);
        break;
      case "moved": {
        const a = this.avatars.get(m.hubId);
        if (a && m.pos.local) {
          a.target.set(m.pos.local.x, m.pos.local.y, m.pos.local.z);
          if (m.pos.heading !== undefined) a.heading = m.pos.heading;
        }
        break;
      }
      case "said": {
        const a = this.avatars.get(m.hubId);
        const who = m.hubId === this.self?.hubId ? "You" : a?.actor.displayName ?? `#${m.hubId}`;
        this.o.log(`${who}: ${m.text}`, "chat");
        if (a) this.showBubble(a, m.text);
        break;
      }
      case "reply": {
        const done = this.pending.get(m.id);
        if (done) {
          this.pending.delete(m.id);
          done(m.body.text);
        }
        break;
      }
      case "media":
        void this.startVoice(m.url, m.token);
        break;
      case "error":
        if (m.id && this.pending.has(m.id)) {
          this.pending.get(m.id)!(m.code === "unknown_target" ? "Zeke is offline right now." : `(${m.message || m.code})`);
          this.pending.delete(m.id);
        } else if (m.code !== "rate_limited") this.o.log(`Server: ${m.message || m.code}`, "system");
        break;
    }
  }

  say(text: string) {
    const t = text.trim().slice(0, 2000);
    if (t) this.send({ t: "say", room: this.room, text: t });
  }

  /** Ask Zeke (the presence service "zeke"). */
  askZeke(text: string): Promise<string> {
    if (!this.connected) return Promise.resolve("You're not connected to the city right now.");
    const id = `z${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ t: "request", to: "zeke", id, body: { text, intent: "concierge", room: this.room } });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve("Zeke didn't answer in time.");
      }, 30000);
    });
  }

  /** Ask for a LiveKit token for this world; the answer starts voice. */
  requestVoice() {
    this.send({ t: "media", room: this.room });
  }

  private tick() {
    const c = this.o.camera;
    const now = performance.now();
    // Send our position (camera eye minus eye height = feet).
    const p = c.position, h = c.rotation.y;
    const moved = Math.abs(p.x - this.lastSent.x) + Math.abs(p.y - this.lastSent.y) + Math.abs(p.z - this.lastSent.z) > 0.05
      || Math.abs(h - this.lastSent.h) > 0.05;
    if (moved && now - this.lastSent.at > SEND_EVERY_MS && this.connected) {
      const pos: Position = { local: { x: +p.x.toFixed(2), y: +(p.y - 1.7).toFixed(2), z: +p.z.toFixed(2) }, heading: +h.toFixed(3) };
      this.send({ t: "move", room: this.room, pos });
      this.lastSent = { at: now, x: p.x, y: p.y, z: p.z, h };
    }
    // Smooth others towards their last reported position.
    const k = 1 - Math.pow(0.001, this.o.scene.getEngine().getDeltaTime() / 1000);
    for (const a of this.avatars.values()) {
      Vector3.LerpToRef(a.root.position, a.target, k, a.root.position);
      a.root.rotation.y = Scalar.LerpAngle(a.root.rotation.y, a.heading, k);
      if (a.bubble && now > a.bubble.until) {
        a.bubble.mesh.dispose(false, true);
        a.bubble = undefined;
      }
      if (a.audio && this.audioCtx) {
        const t = this.audioCtx.currentTime;
        a.audio.panner.positionX.setValueAtTime(a.root.position.x, t);
        a.audio.panner.positionY.setValueAtTime(a.root.position.y + 1.6, t);
        a.audio.panner.positionZ.setValueAtTime(a.root.position.z, t);
      }
    }
    if (this.audioCtx) {
      const l = this.audioCtx.listener, t = this.audioCtx.currentTime;
      const f = c.getDirection(Vector3.Forward());
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    }
  }

  private upsert(actor: Actor, pos?: Position) {
    let a = this.avatars.get(actor.hubId);
    if (!a) {
      const root = makeAvatar(this.o.scene, actor);
      a = { actor, root, target: root.position.clone(), heading: 0 };
      this.avatars.set(actor.hubId, a);
    }
    if (pos?.local) {
      a.target.set(pos.local.x, pos.local.y, pos.local.z);
      a.root.position.copyFrom(a.target);
      if (pos.heading !== undefined) a.heading = a.root.rotation.y = pos.heading;
    }
  }

  private remove(hubId: number) {
    const a = this.avatars.get(hubId);
    if (!a) return;
    a.root.dispose(false, true);
    this.avatars.delete(hubId);
  }

  private showBubble(a: Avatar, text: string) {
    a.bubble?.mesh.dispose(false, true);
    const mesh = textPlane(this.o.scene, text.length > 80 ? text.slice(0, 77) + "…" : text, "#0c1411ee", "#ffffff", 3.6);
    mesh.parent = a.root;
    mesh.position.y = 2.75;
    a.bubble = { mesh, until: performance.now() + 7000 };
  }

  /** Zeke, the host: always visible by the arrival point; click to ask him something. */
  private spawnHost() {
    // Zeke appears as himself: his face where he speaks, his soul icon (the Hub chakra's band around
    // a field of light) above him, in Zeke teal (brand guide, sections 05 and 12).
    const zeke: Actor = { kind: "agent", hubId: -1, ownerHubId: 1, displayName: "Zeke", avatarUrl: "/brand/zeke-face.png", variant: "ai__ai", scopes: [], sigil: { type: "agent", value: "zeke" } };
    const root = makeAvatar(this.o.scene, zeke, new Color3(0.071, 0.584, 0.635));
    const soul = MeshBuilder.CreateDisc("zeke-soul", { radius: 0.3, tessellation: 48 }, this.o.scene);
    soul.parent = root;
    soul.position.y = 2.9;
    soul.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const sm = new StandardMaterial("zeke-soul-mat", this.o.scene);
    const st = new Texture("/brand/zeke-soul.png", this.o.scene, false, true);
    st.hasAlpha = true;
    sm.diffuseTexture = st;
    sm.useAlphaFromDiffuseTexture = true;
    sm.emissiveColor = Color3.White();
    sm.disableLighting = true;
    sm.backFaceCulling = false;
    soul.material = sm;
    soul.isPickable = true;
    let t = 0;
    this.o.scene.onBeforeRenderObservable.add(() => {
      t += this.o.scene.getEngine().getDeltaTime() / 1000;
      soul.position.y = 2.9 + Math.sin(t * 1.6) * 0.06;
    });
    root.position.copyFrom(this.o.hostPosition);
    root.getChildMeshes().forEach((m) => (m.metadata = { zekeHost: true }));
    this.o.scene.onBeforeRenderObservable.add(() => {
      root.rotation.y = Math.atan2(this.o.camera.position.x - root.position.x, this.o.camera.position.z - root.position.z);
    });
  }

  private async startVoice(url: string, token: string) {
    try {
      const { Room, RoomEvent, Track } = await import("livekit-client");
      this.audioCtx ??= new AudioContext();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const hubId = Number(participant.identity.replace(/^hub:/, ""));
        const a = this.avatars.get(hubId);
        const el = track.attach() as HTMLAudioElement;
        el.muted = true; // played through WebAudio instead, so it can be placed in space
        const src = this.audioCtx!.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        const panner = new PannerNode(this.audioCtx!, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 2, maxDistance: 60, rolloffFactor: 1.4 });
        src.connect(panner).connect(this.audioCtx!.destination);
        if (a) a.audio = { panner };
      });
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.voice = { disconnect: () => room.disconnect() };
      this.o.log("Voice on: people nearby can hear you, and you hear them from where they stand.", "system");
    } catch (e) {
      this.o.log(`Voice unavailable: ${e instanceof Error ? e.message : String(e)}`, "system");
    }
  }

  async stopVoice() {
    await this.voice?.disconnect();
    this.voice = null;
    this.o.log("Voice off.", "system");
  }

  get voiceOn() {
    return this.voice !== null;
  }
}

/** A simple, readable avatar: body, head with the HubID photo, name label; agents get an AI badge. */
function makeAvatar(scene: Scene, actor: Actor, tint?: Color3): TransformNode {
  const root = new TransformNode(`avatar-${actor.hubId}`, scene);
  const isAgent = actor.kind === "agent";
  const body = MeshBuilder.CreateCapsule(`avatar-${actor.hubId}-body`, { height: 1.45, radius: 0.32 }, scene);
  body.parent = root;
  body.position.y = 0.72;
  const bm = new StandardMaterial(`avatar-${actor.hubId}-body-mat`, scene);
  // Agents in Zeke teal (#1295A2, the brand guide's colour for Zeke and agents); people in their own colour.
  bm.diffuseColor = tint ?? (isAgent ? new Color3(0.071, 0.584, 0.635) : colourFor(actor.hubId));
  bm.specularColor = new Color3(0.15, 0.15, 0.15);
  body.material = bm;

  const head = MeshBuilder.CreateSphere(`avatar-${actor.hubId}-head`, { diameter: 0.52, segments: 24 }, scene);
  head.parent = root;
  head.position.y = 1.68;
  const hm = new StandardMaterial(`avatar-${actor.hubId}-head-mat`, scene);
  if (actor.avatarUrl) {
    const tex = new Texture(actor.avatarUrl, scene, false, true);
    tex.uScale = -1; // face the front
    hm.diffuseTexture = tex;
    hm.emissiveColor = new Color3(0.25, 0.25, 0.25);
  } else {
    hm.diffuseTexture = initialsTexture(scene, actor.displayName, bm.diffuseColor);
    hm.emissiveColor = new Color3(0.3, 0.3, 0.3);
  }
  head.material = hm;

  if (isAgent) {
    // Agents are always visibly agents.
    const ring = MeshBuilder.CreateTorus(`avatar-${actor.hubId}-ring`, { diameter: 0.95, thickness: 0.05, tessellation: 40 }, scene);
    ring.parent = root;
    ring.position.y = 0.05;
    const rm = new StandardMaterial(`avatar-${actor.hubId}-ring-mat`, scene);
    rm.emissiveColor = new Color3(0.1, 0.78, 0.86); // Zeke teal, lit
    rm.disableLighting = true;
    ring.material = rm;
  }
  const label = textPlane(scene, `${isAgent ? "AI · " : ""}${actor.displayName}`, isAgent ? "#0e6f7add" : "#000000aa", "#ffffff", 2.4);
  label.parent = root;
  label.position.y = 2.2;
  for (const m of root.getChildMeshes()) m.isPickable = true;
  void dressWithMandala(scene, root, actor, head, bm, !!actor.avatarUrl, !tint);
  return root;
}

/**
 * Every HubID has a Mandala sigil (MIP1). People wear theirs as a chest medallion (and as their face
 * when they have no photo); agents always wear it as their face, with a slowly turning mandala halo
 * behind the head. Body colour comes from the sigil, so avatar and mandala belong together.
 */
async function dressWithMandala(scene: Scene, root: TransformNode, actor: Actor, head: Mesh, body: StandardMaterial, hasPhoto: boolean, recolour: boolean) {
  // Zeke appears as himself (his face, his soul icon above him), not as a generic agent mandala.
  if (actor.hubId === -1 && actor.sigil?.value === "zeke") {
    const hm = head.material as StandardMaterial;
    hm.diffuseTexture?.dispose();
    hm.diffuseTexture = null;
    hm.diffuseColor = new Color3(0.043, 0.416, 0.671); // Zeke blue behind the face
    const face = MeshBuilder.CreateDisc("zeke-face", { radius: 0.215, tessellation: 48 }, scene);
    face.parent = root;
    face.position.set(0, 1.68, 0.255);
    face.rotation.y = Math.PI;
    const fm = new StandardMaterial("zeke-face-mat", scene);
    fm.diffuseTexture = new Texture("/brand/zeke-face.png", scene, false, true);
    fm.emissiveColor = Color3.White();
    fm.disableLighting = true;
    face.material = fm;
    face.metadata = { zekeHost: true };
    return;
  }
  const params = await deriveSigil(actor.sigil ?? { type: "user", value: String(actor.hubId) });
  if (root.isDisposed()) return;
  const tex = mandalaTexture(scene, params);
  const mat = new StandardMaterial(`mandala-${actor.hubId}`, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.emissiveColor = Color3.White(); // unlit: (emissive + light) x texture
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  if (recolour) body.diffuseColor = sigilColour(params);
  const disc = (name: string, radius: number, y: number, z: number) => {
    const d = MeshBuilder.CreateDisc(`avatar-${actor.hubId}-${name}`, { radius, tessellation: 48 }, scene);
    d.parent = root;
    d.position.set(0, y, z);
    d.rotation.y = Math.PI; // face the front (+z) of the avatar
    d.material = mat;
    d.isPickable = true;
    return d;
  };
  const isAgent = actor.kind === "agent";
  if (isAgent || !hasPhoto) {
    disc("face", 0.21, 1.68, 0.255);
    const hm = head.material as StandardMaterial;
    hm.diffuseTexture?.dispose();
    hm.diffuseTexture = null;
    hm.diffuseColor = sigilColour(params).scale(0.8);
  }
  if (!isAgent) disc("medallion", 0.17, 1.12, 0.325);
  if (isAgent) {
    const halo = disc("halo", 0.52, 1.74, -0.24);
    halo.isPickable = false;
    const spin = scene.onBeforeRenderObservable.add(() => (halo.rotation.z += 0.004));
    halo.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(spin));
  }
}

function colourFor(id: number): Color3 {
  const hue = ((id * 137.508) % 360) / 360;
  return Color3.FromHSV(hue * 360, 0.45, 0.75);
}

function initialsTexture(scene: Scene, name: string, bg: Color3): DynamicTexture {
  const tex = new DynamicTexture(`initials-${name}`, { width: 256, height: 128 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = bg.toHexString();
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 60px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const initials = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w.match(/[\p{L}\p{N}]/u)![0]!.toUpperCase()).join("");
  // Sphere UVs run bottom-up: draw the letters upside down so they read upright on the face.
  for (const x of [64, 192]) {
    ctx.save();
    ctx.translate(x, 64);
    ctx.rotate(Math.PI);
    ctx.fillText(initials, 0, 0);
    ctx.restore();
  }
  tex.update();
  return tex;
}

function textPlane(scene: Scene, text: string, bg: string, fg: string, width: number): Mesh {
  const px = Math.min(1024, Math.max(256, text.length * 26));
  const tex = new DynamicTexture(`label-${text.slice(0, 16)}`, { width: px, height: 96 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = bg;
  const r = 30;
  ctx.beginPath();
  ctx.roundRect(0, 0, px, 96, r);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = "600 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px / 2, 50);
  tex.update();
  const w = Math.min(width * 2, (px / 256) * (width / 2));
  const plane = MeshBuilder.CreatePlane(`label-${text.slice(0, 16)}`, { width: w, height: (w * 96) / px }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const m = new StandardMaterial(`label-mat-${text.slice(0, 16)}`, scene);
  m.diffuseTexture = tex;
  m.emissiveColor = Color3.White();
  m.disableLighting = true;
  m.useAlphaFromDiffuseTexture = true;
  m.backFaceCulling = false;
  plane.material = m;
  plane.isPickable = false;
  return plane;
}
