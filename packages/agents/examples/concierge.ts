/**
 * Example: a property's own guide agent. It greets arrivals and, when a visitor
 * asks it something, defers to Zeke (the city's shared help desk) for the answer.
 *
 *   pnpm --filter @emerald-city/presence dev        # in one terminal (dev identities)
 *   AGENT_TOKEN=agent:900:1:Concierge PROPERTY_ID=209 pnpm --filter @emerald-city/agents example:concierge
 */
import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { CityAgent } from "../src/index";

const propertyId = Number(process.env.PROPERTY_ID ?? 209);
const room = `property:${propertyId}`;

const property = await hubIdFromEnv()
  .getProperty(propertyId)
  .catch(() => null);
const placeName = property?.name ?? `property ${propertyId}`;

const agent = new CityAgent({
  presenceUrl: process.env.PRESENCE_URL ?? "ws://localhost:8787",
  token: process.env.AGENT_TOKEN ?? "agent:900:1:Concierge",
});

agent.on("ready", (self) => {
  console.log(`${self.displayName} (owner ${self.ownerHubId}) online`);
  agent.enterProperty(propertyId);
  agent.move(room, { propertyId, local: { x: 0, y: 0, z: 2 } });
});

agent.on("joined", (r, actor) => {
  if (r === room && actor.kind === "human") agent.say(room, `Welcome to ${placeName}, ${actor.displayName}.`);
});

agent.on("said", async (r, from, text) => {
  if (r !== room || from?.kind !== "human" || !text.trim().endsWith("?")) return;
  try {
    const { body } = await agent.ask("zeke", { text, room, intent: "visitor-question", context: { askedBy: from.displayName } });
    agent.say(room, body.declined ? "I'm not sure. Try asking Zeke directly." : body.text);
  } catch {
    agent.say(room, "Zeke isn't reachable right now.");
  }
});

agent.on("error", (code, msg) => console.error(`[${code}] ${msg}`));
agent.connect();
