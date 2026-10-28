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
  console.warn("ZEKE_API_URL / ZEKE_SYSTEM_TOKEN not set: Zeke host not started");
  process.exit(0);
}

const agent = new CityAgent({
  presenceUrl: process.env.PRESENCE_URL ?? "ws://localhost:8787",
  // Dev default matches PRESENCE_SERVICES=zeke:39 with the presence dev resolver.
  token: process.env.ZEKE_HUBID_TOKEN ?? "agent:39:1:Zeke",
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
