import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  isAgent,
  parseClientMessage,
  type Actor,
  type Position,
  type ServerMessage,
} from "@emerald-city/core";
import type { IdentityResolver } from "./identity";
import type { MediaIssuer } from "./media";

interface Member {
  actor: Actor;
  socket: WebSocket;
  rooms: Map<string, Position | undefined>;
  lastMoveAt: number;
  requestTimes: number[];
}

export interface PresenceServerOptions {
  port: number;
  resolveIdentity: IdentityResolver;
  /** Minimum ms between move updates per connection. */
  moveIntervalMs?: number;
  /** Max rooms a single connection may be in. */
  maxRoomsPerMember?: number;
  /** LiveKit token issuer; media requests fail with `media_unavailable` when absent. */
  media?: MediaIssuer | null;
  /** Named services agents can address without knowing ids, e.g. { zeke: 12345 }. */
  services?: Record<string, number>;
  /** Max requests per connection per minute. */
  requestsPerMinute?: number;
}

const ROOM_PATTERN = /^(map|property:\d{1,10})$/;

export function startPresenceServer(opts: PresenceServerOptions): WebSocketServer {
  const moveIntervalMs = opts.moveIntervalMs ?? 50;
  const maxRooms = opts.maxRoomsPerMember ?? 8;
  const rooms = new Map<string, Set<Member>>();
  /** Every live connection by HubID id (latest connection wins for direct messages). */
  const online = new Map<number, Member>();
  const services = opts.services ?? {};
  const requestsPerMinute = opts.requestsPerMinute ?? 30;
  const wss = new WebSocketServer({ port: opts.port, maxPayload: 16 * 1024 });

  const send = (ws: WebSocket, m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const broadcast = (room: string, m: ServerMessage, except?: Member) => {
    for (const other of rooms.get(room) ?? []) if (other !== except) send(other.socket, m);
  };

  const leave = (member: Member, room: string) => {
    if (!member.rooms.delete(room)) return;
    const set = rooms.get(room);
    set?.delete(member);
    if (set?.size === 0) rooms.delete(room);
    broadcast(room, { t: "left", room, hubId: member.actor.hubId });
  };

  wss.on("connection", async (socket: WebSocket, req: IncomingMessage) => {
    const token = bearerFrom(req);
    let actor: Actor;
    try {
      if (!token) throw new Error("missing token");
      actor = await opts.resolveIdentity(token);
    } catch (err) {
      send(socket, { t: "error", code: "unauthorized", message: "invalid or missing token" });
      socket.close(4401, "unauthorized");
      return;
    }

    const member: Member = { actor, socket, rooms: new Map(), lastMoveAt: 0, requestTimes: [] };
    online.set(actor.hubId, member);
    send(socket, { t: "welcome", self: actor });

    socket.on("message", (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) return send(socket, { t: "error", code: "bad_message", message: "unrecognised message" });
      if (msg.t === "request" || msg.t === "reply") return direct(member, msg);
      if (!ROOM_PATTERN.test(msg.room)) return send(socket, { t: "error", code: "bad_room", message: msg.room });

      if (isAgent(actor) && (msg.t === "move" || msg.t === "join") && !actor.scopes.includes("city:move")) {
        return send(socket, { t: "error", code: "forbidden", message: "agent lacks city:move scope" });
      }

      switch (msg.t) {
        case "join": {
          if (member.rooms.has(msg.room)) return;
          if (member.rooms.size >= maxRooms) return send(socket, { t: "error", code: "too_many_rooms", message: "" });
          const set = rooms.get(msg.room) ?? new Set<Member>();
          rooms.set(msg.room, set);
          send(socket, {
            t: "roster",
            room: msg.room,
            members: [...set].map((m) => ({ actor: m.actor, pos: m.rooms.get(msg.room) })),
          });
          set.add(member);
          member.rooms.set(msg.room, undefined);
          broadcast(msg.room, { t: "joined", room: msg.room, actor }, member);
          return;
        }
        case "leave":
          return leave(member, msg.room);
        case "move": {
          if (!member.rooms.has(msg.room)) return;
          const now = Date.now();
          if (now - member.lastMoveAt < moveIntervalMs) return;
          member.lastMoveAt = now;
          member.rooms.set(msg.room, msg.pos);
          return broadcast(msg.room, { t: "moved", room: msg.room, hubId: actor.hubId, pos: msg.pos }, member);
        }
        case "say":
          if (!member.rooms.has(msg.room)) return;
          return broadcast(msg.room, { t: "said", room: msg.room, hubId: actor.hubId, text: msg.text, at: Date.now() });
        case "media": {
          if (!member.rooms.has(msg.room)) return send(socket, { t: "error", code: "not_in_room", message: msg.room });
          if (!opts.media) return send(socket, { t: "error", code: "media_unavailable", message: "media not configured" });
          if (isAgent(actor) && !actor.scopes.includes("media:join")) {
            return send(socket, { t: "error", code: "forbidden", message: "agent lacks media:join scope" });
          }
          const room = msg.room;
          opts.media
            .issue(actor, room)
            .then(({ token, expiresAt }) => send(socket, { t: "media", room, url: opts.media!.url, token, expiresAt }))
            .catch(() => send(socket, { t: "error", code: "media_failed", message: "could not issue media token" }));
          return;
        }
      }
    });

    socket.on("close", () => {
      for (const room of [...member.rooms.keys()]) leave(member, room);
      if (online.get(actor.hubId) === member) online.delete(actor.hubId);
    });
  });

  /**
   * Routes requests/replies between actors. Requests may go to any online agent
   * (or a named service such as Zeke). Agents need the `agents:request` scope
   * to send them; agents may not open requests to humans.
   */
  function direct(member: Member, msg: Extract<ReturnType<typeof parseClientMessage>, { t: "request" | "reply" }>) {
    const { actor, socket } = member;
    const fail = (code: string, message: string) => send(socket, { t: "error", code, message, id: msg.id });

    const now = Date.now();
    member.requestTimes = member.requestTimes.filter((t) => now - t < 60_000);
    if (member.requestTimes.length >= requestsPerMinute) return fail("rate_limited", "too many requests");
    member.requestTimes.push(now);

    if (msg.t === "request") {
      if (isAgent(actor) && !actor.scopes.includes("agents:request")) return fail("forbidden", "agent lacks agents:request scope");
      const targetId = typeof msg.to === "string" ? services[msg.to] : msg.to;
      if (targetId === undefined) return fail("unknown_service", String(msg.to));
      const target = online.get(targetId);
      if (!target) return fail("unavailable", `${msg.to} is not online`);
      if (target === member) return fail("bad_target", "cannot request yourself");
      if (target.actor.kind !== "agent") return fail("bad_target", "requests can only be sent to agents");
      send(target.socket, { t: "request", from: actor, id: msg.id, body: msg.body });
      return;
    }

    // Replies only come from agents, back to whoever asked.
    if (!isAgent(actor)) return fail("forbidden", "only agents reply to requests");
    const target = online.get(msg.to);
    if (!target) return fail("unavailable", "requester is no longer online");
    send(target.socket, { t: "reply", from: actor, id: msg.id, body: msg.body });
  }

  return wss;
}

/** Token from `Authorization: Bearer`, or from the `token` subprotocol / query param for browsers. */
function bearerFrom(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const proto = req.headers["sec-websocket-protocol"];
  if (typeof proto === "string") {
    const parts = proto.split(",").map((s) => s.trim());
    const i = parts.indexOf("hubid");
    if (i >= 0 && parts[i + 1]) return parts[i + 1]!;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get("token");
}
