import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { devResolver } from "./identity";
import { startPresenceServer } from "./server";

const PORT = 18791;
let wss: ReturnType<typeof startPresenceServer>;

beforeAll(() => {
  wss = startPresenceServer({ port: PORT, resolveIdentity: devResolver(), heartbeatMs: 80 });
});
afterAll(() => new Promise<void>((r) => wss.close(() => r())));

describe("presence heartbeat", () => {
  it("pings quiet connections, keeps the ones that answer and drops the ones that don't", async () => {
    // ws answers pings automatically: this one stays.
    const live = new WebSocket(`ws://localhost:${PORT}`, { headers: { Authorization: "Bearer human:1:Ana" } });
    let pings = 0;
    live.on("ping", () => pings++);
    await new Promise((r) => live.on("open", r));

    // autoPong off: this one looks like a laptop that went to sleep.
    const dead = new WebSocket(`ws://localhost:${PORT}`, { headers: { Authorization: "Bearer human:2:Ben" }, autoPong: false });
    const closed = new Promise<void>((r) => dead.on("close", () => r()));
    await new Promise((r) => dead.on("open", r));

    await closed;
    await new Promise((r) => setTimeout(r, 200));
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(live.readyState).toBe(WebSocket.OPEN);
    live.close();
  });
});
