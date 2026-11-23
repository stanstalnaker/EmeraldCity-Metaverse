/**
 * Zeke host process: connects Zeke's HubID agent identity to presence and
 * relays in-world questions to the Zeke API.
 *
 *   ZEKE_HUBID_TOKEN=...  ZEKE_API_URL=...  ZEKE_SYSTEM_TOKEN=...  ZEKE_ROOMS=map,property:209
 */
import { CityAgent } from "@emerald-city/agents";
import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { zekeFromEnv } from "@emerald-city/zeke-client";
import { startZekeHost } from "./host";

const zeke = zekeFromEnv();
if (!zeke) {
  console.warn("ZEKE_API_URL / ZEKE_SYSTEM_TOKEN not set: Zeke host not started (the city will say Zeke isn't online)");
  process.exit(0);
}

const agent = new CityAgent({
  presenceUrl: process.env.PRESENCE_URL ?? "ws://localhost:8787",
  // Live: a presence service key (PRESENCE_SERVICE_KEYS=zeke:39:<secret> → ZEKE_PRESENCE_TOKEN=service:zeke:<secret>).
  // Dev default matches PRESENCE_SERVICES=zeke:39 with the presence dev resolver.
  token: process.env.ZEKE_PRESENCE_TOKEN ?? process.env.ZEKE_HUBID_TOKEN ?? "agent:39:1:Zeke",
});
const hubid = hubIdFromEnv();

startZekeHost({
  agent,
  zeke,
  getProperty: (id) => hubid.getProperty(id),
  rooms: (process.env.ZEKE_ROOMS ?? "map").split(",").map((s) => s.trim()).filter(Boolean),
});

agent.on("ready", (self) => console.log(`Zeke online as HubID ${self.hubId}`));
agent.on("error", (code, msg) => console.error(`[${code}] ${msg}`));
agent.connect();
