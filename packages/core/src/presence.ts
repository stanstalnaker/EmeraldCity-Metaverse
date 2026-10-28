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

export type ClientMessage =
  | { t: "join"; room: string }
  | { t: "leave"; room: string }
  | { t: "move"; room: string; pos: Position }
  | { t: "say"; room: string; text: string };

export type ServerMessage =
  | { t: "welcome"; self: Actor }
  | { t: "roster"; room: string; members: Array<{ actor: Actor; pos?: Position }> }
  | { t: "joined"; room: string; actor: Actor }
  | { t: "left"; room: string; hubId: number }
  | { t: "moved"; room: string; hubId: number; pos: Position }
  | { t: "said"; room: string; hubId: number; text: string; at: number }
  | { t: "error"; code: string; message: string };

/** Room naming: one room per property, plus a global map room. */
export const rooms = {
  map: "map",
  property: (id: number) => `property:${id}`,
} as const;

export const MAX_SAY_LENGTH = 2_000;

export function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  if (typeof o.room !== "string" || o.room.length === 0 || o.room.length > 64) return null;
  switch (o.t) {
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
