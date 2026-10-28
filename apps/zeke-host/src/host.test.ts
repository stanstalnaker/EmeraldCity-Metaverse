import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { CityAgent } from "@emerald-city/agents";
import type { Property, ServerMessage } from "@emerald-city/core";
import { devResolver } from "@emerald-city/presence/src/identity";
import { startPresenceServer } from "@emerald-city/presence/src/server";
import { startZekeHost } from "./host";

const PORT = 18799;
const URL = `ws://localhost:${PORT}`;
let wss: ReturnType<typeof startPresenceServer>;
const agents: CityAgent[] = [];

const ask = vi.fn(async ({ message, data, threadId }: { message: string; caller: string; data?: Record<string, unknown>; threadId?: string }) => ({
  text: `Zeke says: ${message} @ ${(data?.property as { name?: string } | undefined)?.name ?? "city"}`,
  threadId: threadId ?? "thread-1",
}));
const property: Property = {
  id: 209, slug: "city-hall", name: "City Hall", territory: "Emerald City", isPrivate: false,
  image: null, backgroundImage: null, message: "", ownerProfileId: 1, location: null,
};

function ready(agent: CityAgent) {
  agents.push(agent);
  return new Promise<void>((r) => agent.once("ready", () => r()).connect());
}

beforeAll(async () => {
  wss = startPresenceServer({ port: PORT, resolveIdentity: devResolver(), services: { zeke: 39 }, moveIntervalMs: 0 });
  const zekeAgent = new CityAgent({ presenceUrl: URL, token: "agent:39:1:Zeke", reconnectMs: 0 });
  startZekeHost({ agent: zekeAgent, zeke: { ask }, getProperty: async () => property, rooms: ["map", "property:209"] });
  await ready(zekeAgent);
  await new Promise((r) => setTimeout(r, 50)); // let Zeke join its rooms
});
afterAll(async () => {
  agents.forEach((a) => a.close());
  await new Promise<void>((r) => wss.close(() => r()));
});

describe("Zeke host", () => {
  it("answers other agents that ask 'zeke', with property context and a stable thread", async () => {
    const guide = new CityAgent({ presenceUrl: URL, token: "agent:500:7:Guide", reconnectMs: 0 });
    await ready(guide);

    const r1 = await guide.ask("zeke", { text: "What is on tonight?", room: "property:209", intent: "events" });
    expect(r1.from).toMatchObject({ hubId: 39, kind: "agent" });
    expect(r1.body.text).toBe("Zeke says: What is on tonight? @ City Hall");

    const call = ask.mock.calls.at(-1)![0] as { caller: string; data: Record<string, any> };
    expect(call.caller).toBe("agent");
    expect(call.data.asker).toMatchObject({ kind: "agent", hub_user_id: 500, owner_hub_user_id: 7 });
    expect(call.data.intent).toBe("events");

    await guide.ask("zeke", { text: "And tomorrow?", room: "property:209" });
    expect((ask.mock.calls.at(-1)![0] as { threadId?: string }).threadId).toBe("thread-1");
  });

  it("greets people entering a hosted property and answers when addressed in chat", async () => {
    const ws = new WebSocket(URL, { headers: { Authorization: "Bearer human:2:Stan" } });
    const inbox: ServerMessage[] = [];
    ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once("open", r));
    const waitFor = async (pred: (m: ServerMessage) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const m = inbox.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("timed out");
    };

    ws.send(JSON.stringify({ t: "join", room: "property:209" }));
    const greeting = await waitFor((m) => m.t === "said" && m.hubId === 39);
    expect(greeting).toMatchObject({ text: expect.stringContaining("Welcome to City Hall, Stan") });

    ws.send(JSON.stringify({ t: "say", room: "property:209", text: "hey everyone" }));
    ws.send(JSON.stringify({ t: "say", room: "property:209", text: "Zeke, where is the bar?" }));
    const answer = await waitFor((m) => m.t === "said" && m.hubId === 39 && m.text.startsWith("Zeke says"));
    expect(answer).toMatchObject({ text: "Zeke says: Zeke, where is the bar? @ City Hall" });
    expect(ask.mock.calls.some(([c]) => (c as { message: string }).message === "hey everyone")).toBe(false);
    ws.close();
  });
});
