import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { devResolver } from "./identity";
import { startPresenceServer } from "./server";

const PORT = 18793;
let wss: ReturnType<typeof startPresenceServer>;
const dev = devResolver();

beforeAll(() => {
  // As with PRESENCE_VERIFY=hubid: checking the token takes a round trip.
  wss = startPresenceServer({ port: PORT, resolveIdentity: async (t) => (await new Promise((r) => setTimeout(r, 150)), dev(t)) });
});
afterAll(() => new Promise<void>((r) => wss.close(() => r())));

describe("presence with a slow identity check", () => {
  it("keeps a join and a chat line sent the moment the socket opens", async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/?token=human:7:Ana`);
    const got: { t: string }[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "join", room: "world:emerald-city" }));
    ws.send(JSON.stringify({ t: "say", room: "world:emerald-city", text: "hello" }));
    await new Promise((r) => setTimeout(r, 400));
    expect(got.map((m) => m.t)).toEqual(["welcome", "roster", "said"]);
    ws.close();
  });
});
