import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import {
  rooms,
  type Actor,
  type AgentActor,
  type AgentReplyBody,
  type AgentRequestBody,
  type ClientMessage,
  type Position,
  type RequestTarget,
  type ServerMessage,
} from "@emerald-city/core";

export type RequestHandler = (from: Actor, body: AgentRequestBody) => Promise<AgentReplyBody> | AgentReplyBody;

export class AgentRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

interface Pending {
  resolve: (r: { from: Actor; body: AgentReplyBody }) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AgentOptions {
  /** Presence server URL, e.g. ws://localhost:8787 */
  presenceUrl: string;
  /** HubID token for the agent's sub-profile. */
  token: string;
  /** Reconnect delay in ms; 0 disables reconnects. */
  reconnectMs?: number;
}

export interface AgentEvents {
  ready: [self: AgentActor];
  joined: [room: string, actor: Actor];
  left: [room: string, hubId: number];
  moved: [room: string, hubId: number, pos: Position];
  said: [room: string, from: Actor | undefined, text: string];
  error: [code: string, message: string];
}

/**
 * A HubID agent in the city. Connects to the presence server with its own
 * token; the server, not the agent, decides its identity and what it may do.
 */
export class CityAgent extends EventEmitter<AgentEvents> {
  private ws?: WebSocket;
  private self?: AgentActor;
  private readonly members = new Map<string, Map<number, Actor>>();
  private readonly wanted = new Set<string>();
  private closed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly pendingMedia = new Map<string, Array<(m: { url: string; token: string; expiresAt: number }) => void>>();
  private requestHandler?: RequestHandler;

  constructor(private readonly opts: AgentOptions) {
    super();
  }

  get identity(): AgentActor | undefined {
    return this.self;
  }

  connect(): this {
    this.closed = false;
    const ws = new WebSocket(this.opts.presenceUrl, { headers: { Authorization: `Bearer ${this.opts.token}` } });
    this.ws = ws;
    ws.on("message", (d) => this.onMessage(JSON.parse(d.toString()) as ServerMessage));
    ws.on("close", () => {
      this.members.clear();
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new AgentRequestError("disconnected", "connection closed"));
        this.pending.delete(id);
      }
      const delay = this.opts.reconnectMs ?? 3_000;
      if (!this.closed && delay > 0) setTimeout(() => this.connect(), delay);
    });
    ws.on("error", (err) => this.emit("error", "socket", err.message));
    return this;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  /** Enter a property's scene. */
  enterProperty(propertyId: number): void {
    this.join(rooms.property(propertyId));
  }

  join(room: string): void {
    this.wanted.add(room);
    this.send({ t: "join", room });
  }

  leave(room: string): void {
    this.wanted.delete(room);
    this.send({ t: "leave", room });
  }

  move(room: string, pos: Position): void {
    this.send({ t: "move", room, pos });
  }

  say(room: string, text: string): void {
    this.send({ t: "say", room, text });
  }

  /**
   * Ask another agent (or a named service such as "zeke") for help.
   * Resolves with the reply; rejects on error, refusal by the server, or timeout.
   */
  ask(to: RequestTarget, body: AgentRequestBody, timeoutMs = 45_000): Promise<{ from: Actor; body: AgentReplyBody }> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentRequestError("timeout", `no reply from ${to}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ t: "request", to, id, body });
    });
  }

  /** Handle requests sent to this agent. Errors become a declined reply. */
  onRequest(handler: RequestHandler): this {
    this.requestHandler = handler;
    return this;
  }

  /** LiveKit URL + token for a room this agent has joined (needs media:join). */
  requestMedia(room: string): Promise<{ url: string; token: string; expiresAt: number }> {
    return new Promise((resolve) => {
      const waiters = this.pendingMedia.get(room) ?? [];
      waiters.push(resolve);
      this.pendingMedia.set(room, waiters);
      this.send({ t: "media", room });
    });
  }

  /** Actors currently in a room, excluding this agent. */
  membersOf(room: string): Actor[] {
    return [...(this.members.get(room)?.values() ?? [])];
  }

  private send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case "welcome":
        if (m.self.kind !== "agent") {
          this.emit("error", "not_agent", "token belongs to a human profile; agents need their own HubID sub-profile");
          return this.close();
        }
        this.self = m.self;
        for (const room of this.wanted) this.send({ t: "join", room });
        return void this.emit("ready", m.self);
      case "roster":
        this.members.set(m.room, new Map(m.members.map((x) => [x.actor.hubId, x.actor])));
        return;
      case "joined":
        this.roomMap(m.room).set(m.actor.hubId, m.actor);
        return void this.emit("joined", m.room, m.actor);
      case "left":
        this.members.get(m.room)?.delete(m.hubId);
        return void this.emit("left", m.room, m.hubId);
      case "moved":
        return void this.emit("moved", m.room, m.hubId, m.pos);
      case "said":
        if (m.hubId === this.self?.hubId) return;
        return void this.emit("said", m.room, this.members.get(m.room)?.get(m.hubId), m.text);
      case "media": {
        const waiters = this.pendingMedia.get(m.room) ?? [];
        this.pendingMedia.delete(m.room);
        return waiters.forEach((w) => w(m));
      }
      case "request":
        return void this.handleRequest(m.from, m.id, m.body);
      case "reply": {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        return p.resolve({ from: m.from, body: m.body });
      }
      case "error": {
        const p = m.id ? this.pending.get(m.id) : undefined;
        if (p && m.id) {
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          return p.reject(new AgentRequestError(m.code, m.message));
        }
        return void this.emit("error", m.code, m.message);
      }
    }
  }

  private async handleRequest(from: Actor, id: string, body: AgentRequestBody): Promise<void> {
    let reply: AgentReplyBody;
    if (!this.requestHandler) reply = { text: "This agent does not take requests.", declined: true };
    else {
      try {
        reply = await this.requestHandler(from, body);
      } catch (err) {
        reply = { text: "Sorry, I couldn't help with that right now.", declined: true };
        this.emit("error", "handler", err instanceof Error ? err.message : String(err));
      }
    }
    this.send({ t: "reply", to: from.hubId, id, body: { ...reply, text: reply.text.slice(0, 2_000) } });
  }

  private roomMap(room: string): Map<number, Actor> {
    let r = this.members.get(room);
    if (!r) this.members.set(room, (r = new Map()));
    return r;
  }
}
