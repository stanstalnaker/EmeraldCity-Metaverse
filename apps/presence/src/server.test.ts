import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@emerald-city/core";
import { decodeJwt } from "jose";
import { devResolver } from "./identity";
import { liveKitIssuer } from "./media";
import { startPresenceServer } from "./server";

const PORT = 18787;
let wss: ReturnType<typeof startPresenceServer>;

beforeAll(() => {
  wss = startPresenceServer({
    port: PORT,
    resolveIdentity: devResolver(),
    moveIntervalMs: 0,
    media: liveKitIssuer({ url: "wss://lk.test", apiKey: "devkey", apiSecret: "devsecret-devsecret-devsecret-0123" }),
    services: { zeke: 39 },
    requestsPerMinute: 5,
  });
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

  it("issues LiveKit tokens only for joined rooms, with HubID identity and actor kind", async () => {
    const c = connect("agent:901:1:Guide");
    await c.next((m) => m.t === "welcome");
    c.send({ t: "media", room: "property:5" });
    expect(await c.next((m) => m.t === "error")).toMatchObject({ code: "not_in_room" });

    c.send({ t: "join", room: "property:5" });
    await c.next((m) => m.t === "roster");
    c.send({ t: "media", room: "property:5" });
    const media = await c.next((m) => m.t === "media");
    if (media.t !== "media") throw new Error("expected media");
    expect(media.url).toBe("wss://lk.test");
    const claims = decodeJwt(media.token) as Record<string, any>;
    expect(claims.sub).toBe("hub:901");
    expect(claims.video).toMatchObject({ roomJoin: true, room: "property:5", canPublishData: false });
    expect(claims.attributes).toMatchObject({ kind: "agent", ownerHubId: "1" });
    c.ws.close();
  });

  it("routes requests to Zeke by service name and replies back to the asker", async () => {
    const zeke = connect("agent:39:1:Zeke");
    await zeke.next((m) => m.t === "welcome");
    const guide = connect("agent:902:7:Guide");
    await guide.next((m) => m.t === "welcome");

    guide.send({ t: "request", to: "zeke", id: "q1", body: { text: "Where is City Hall?", intent: "directions" } });
    const req = await zeke.next((m) => m.t === "request");
    expect(req).toMatchObject({ id: "q1", from: { hubId: 902, kind: "agent", ownerHubId: 7 }, body: { intent: "directions" } });

    zeke.send({ t: "reply", to: 902, id: "q1", body: { text: "North side of the plaza." } });
    expect(await guide.next((m) => m.t === "reply")).toMatchObject({ id: "q1", from: { hubId: 39 }, body: { text: "North side of the plaza." } });

    guide.send({ t: "request", to: "oracle", id: "q2", body: { text: "?" } });
    expect(await guide.next((m) => m.t === "error")).toMatchObject({ code: "unknown_service", id: "q2" });
    zeke.ws.close();
    guide.ws.close();
  });

  it("stops agents from opening requests to humans, and humans from replying", async () => {
    const human = connect("human:3:Ana");
    await human.next((m) => m.t === "welcome");
    const agent = connect("agent:903:1:Bot");
    await agent.next((m) => m.t === "welcome");

    agent.send({ t: "request", to: 3, id: "a1", body: { text: "hello" } });
    expect(await agent.next((m) => m.t === "error")).toMatchObject({ code: "bad_target" });
    human.send({ t: "reply", to: 903, id: "a1", body: { text: "spoofed" } });
    expect(await human.next((m) => m.t === "error")).toMatchObject({ code: "forbidden" });

    // Humans may ask agents directly.
    human.send({ t: "request", to: 903, id: "h1", body: { text: "what can you do?" } });
    expect(await agent.next((m) => m.t === "request")).toMatchObject({ from: { kind: "human", hubId: 3 } });
    human.ws.close();
    agent.ws.close();
  });

  it("rate-limits direct requests", async () => {
    const zeke = connect("agent:39:1:Zeke");
    await zeke.next((m) => m.t === "welcome");
    const c = connect("human:4:Rapid");
    await c.next((m) => m.t === "welcome");
    for (let i = 0; i < 6; i++) c.send({ t: "request", to: "zeke", id: `r${i}`, body: { text: "hi" } });
    expect(await c.next((m) => m.t === "error")).toMatchObject({ code: "rate_limited", id: "r5" });
    zeke.ws.close();
    c.ws.close();
  });
});
