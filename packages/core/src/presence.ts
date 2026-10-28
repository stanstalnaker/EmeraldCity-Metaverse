import type { Actor } from "./actor";
import type { LngLat } from "./geo";

/**
 * Wire protocol for the presence server (apps/presence). Identity is never
 * self-asserted: the server derives the Actor from the verified token on
 * connect, unlike the legacy Photon setup where clients broadcast their own
 * name and HubID id.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where an actor is: on the Gaia map, inside a property scene, or both. */
export interface Position {
  /** Real-world position on the Gaia map layer. */
  geo?: LngLat;
  /** Property (pavilion id) whose scene the actor is in. */
  propertyId?: number;
  /** Position within the property scene, in metres from its origin. */
  local?: Vec3;
}

/**
 * Agent-to-agent (and human-to-agent) request. `to` is a HubID user id, or a
 * service name the presence server knows (e.g. "zeke"), so agents can ask
 * Zeke for help without hardcoding its id.
 */
export interface AgentRequestBody {
  /** Free-form question or instruction. */
  text: string;
  /** Optional machine-readable intent, e.g. "property.info", "directions", "help". */
  intent?: string;
  /** Room the request relates to, if any. */
  room?: string;
  /** Extra structured context. Kept small (see MAX_REQUEST_BYTES). */
  context?: Record<string, unknown>;
}

export interface AgentReplyBody {
  text: string;
  /** Structured result, if any. */
  data?: Record<string, unknown>;
  /** True if the responder could not help; `text` explains why. */
  declined?: boolean;
}

export type RequestTarget = number | string;

export type ClientMessage =
  | { t: "join"; room: string }
  | { t: "leave"; room: string }
  | { t: "move"; room: string; pos: Position }
  | { t: "say"; room: string; text: string }
  /** Ask for a LiveKit token for a room you have joined. */
  | { t: "media"; room: string }
  | { t: "request"; to: RequestTarget; id: string; body: AgentRequestBody }
  | { t: "reply"; to: number; id: string; body: AgentReplyBody };

export type ServerMessage =
  | { t: "welcome"; self: Actor }
  | { t: "roster"; room: string; members: Array<{ actor: Actor; pos?: Position }> }
  | { t: "joined"; room: string; actor: Actor }
  | { t: "left"; room: string; hubId: number }
  | { t: "moved"; room: string; hubId: number; pos: Position }
  | { t: "said"; room: string; hubId: number; text: string; at: number }
  | { t: "media"; room: string; url: string; token: string; expiresAt: number }
  /** Delivered to the target of a request; `from` is the verified sender. */
  | { t: "request"; from: Actor; id: string; body: AgentRequestBody }
  | { t: "reply"; from: Actor; id: string; body: AgentReplyBody }
  | { t: "error"; code: string; message: string; id?: string };

/** Room naming: one room per property, plus a global map room. */
export const rooms = {
  map: "map",
  property: (id: number) => `property:${id}`,
} as const;

export const MAX_SAY_LENGTH = 2_000;
export const MAX_REQUEST_BYTES = 8 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SERVICE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  if (o.t === "request" || o.t === "reply") return parseDirect(o, raw.length);
  if (typeof o.room !== "string" || o.room.length === 0 || o.room.length > 64) return null;
  switch (o.t) {
    case "media":
      return { t: "media", room: o.room };
    case "join":
    case "leave":
      return { t: o.t, room: o.room };
    case "move":
      return isPosition(o.pos) ? { t: "move", room: o.room, pos: o.pos } : null;
    case "say":
      return typeof o.text === "string" && o.text.length > 0 && o.text.length <= MAX_SAY_LENGTH
        ? { t: "say", room: o.room, text: o.text }
        : null;
    default:
      return null;
  }
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPosition(v: unknown): v is Position {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.geo !== undefined) {
    const g = p.geo as Record<string, unknown> | null;
    if (!g || !isFiniteNum(g.lat) || !isFiniteNum(g.lng)) return false;
  }
  if (p.propertyId !== undefined && !isFiniteNum(p.propertyId)) return false;
  if (p.local !== undefined) {
    const l = p.local as Record<string, unknown> | null;
    if (!l || !isFiniteNum(l.x) || !isFiniteNum(l.y) || !isFiniteNum(l.z)) return false;
  }
  return p.geo !== undefined || p.propertyId !== undefined || p.local !== undefined;
}

function parseDirect(o: Record<string, unknown>, size: number): ClientMessage | null {
  if (size > MAX_REQUEST_BYTES) return null;
  if (typeof o.id !== "string" || !ID_PATTERN.test(o.id)) return null;
  const b = o.body as Record<string, unknown> | null;
  if (typeof b !== "object" || b === null || typeof b.text !== "string" || b.text.length === 0) return null;
  if (b.text.length > MAX_SAY_LENGTH) return null;
  if (o.t === "request") {
    const to = o.to;
    const validTo = (typeof to === "number" && Number.isInteger(to) && to > 0) || (typeof to === "string" && SERVICE_PATTERN.test(to));
    if (!validTo) return null;
    if (b.intent !== undefined && typeof b.intent !== "string") return null;
    if (b.room !== undefined && typeof b.room !== "string") return null;
    if (b.context !== undefined && (typeof b.context !== "object" || b.context === null)) return null;
    return {
      t: "request",
      to: to as RequestTarget,
      id: o.id,
      body: { text: b.text, intent: b.intent as string | undefined, room: b.room as string | undefined, context: b.context as Record<string, unknown> | undefined },
    };
  }
  if (typeof o.to !== "number" || !Number.isInteger(o.to)) return null;
  if (b.data !== undefined && (typeof b.data !== "object" || b.data === null)) return null;
  return {
    t: "reply",
    to: o.to,
    id: o.id,
    body: { text: b.text, data: b.data as Record<string, unknown> | undefined, declined: b.declined === true ? true : undefined },
  };
}
