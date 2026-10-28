import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@emerald-city/core";
import { devResolver } from "./identity";
import { startPresenceServer } from "./server";

const PORT = 18787;
let wss: ReturnType<typeof startPresenceServer>;

beforeAll(() => {
  wss = startPresenceServer({ port: PORT, resolveIdentity: devResolver(), moveIntervalMs: 0 });
});
afterAll(() => new Promise<void>((r) => wss.close(() => r())));

function connect(token?: string) {
  const ws = new WebSocket(`ws://localhost:${PORT}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (d) => {
    inbox.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (pred: (m: ServerMessage) => boolean): Promise<ServerMessage> => {
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  return { ws, next, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe("presence server", () => {
  it("rejects connections without a valid token", async () => {
    const c = connect("garbage");
    const closed = new Promise<number>((r) => c.ws.on("close", (code) => r(code)));
    expect(await c.next((m) => m.t === "error")).toMatchObject({ code: "unauthorized" });
    expect(await closed).toBe(4401);
  });

  it("lets humans and agents see each other in a property room, with server-assigned identity", async () => {
    const human = connect("human:1:Stan");
    expect(await human.next((m) => m.t === "welcome")).toMatchObject({ self: { kind: "human", hubId: 1 } });
    human.send({ t: "join", room: "property:209" });
    expect(await human.next((m) => m.t === "roster")).toMatchObject({ members: [] });

    const agent = connect("agent:900:1:Concierge");
    await agent.next((m) => m.t === "welcome");
    agent.send({ t: "join", room: "property:209" });
    const roster = await agent.next((m) => m.t === "roster");
    expect(roster).toMatchObject({ members: [{ actor: { hubId: 1, kind: "human" } }] });
    expect(await human.next((m) => m.t === "joined")).toMatchObject({ actor: { kind: "agent", ownerHubId: 1 } });

    agent.send({ t: "move", room: "property:209", pos: { local: { x: 1, y: 0, z: 2 } } });
    expect(await human.next((m) => m.t === "moved")).toMatchObject({ hubId: 900 });

    agent.send({ t: "say", room: "property:209", text: "Welcome to City Hall" });
    expect(await human.next((m) => m.t === "said")).toMatchObject({ hubId: 900, text: "Welcome to City Hall" });

    agent.ws.close();
    expect(await human.next((m) => m.t === "left")).toMatchObject({ hubId: 900 });
    human.ws.close();
  });

  it("rejects unknown rooms", async () => {
    const c = connect("human:2:A");
    await c.next((m) => m.t === "welcome");
    c.send({ t: "join", room: "admin" });
    expect(await c.next((m) => m.t === "error")).toMatchObject({ code: "bad_room" });
    c.ws.close();
  });
});
