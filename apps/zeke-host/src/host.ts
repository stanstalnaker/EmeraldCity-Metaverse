import { isAgent, type Actor, type AgentReplyBody, type AgentRequestBody, type Property } from "@emerald-city/core";
import type { CityAgent } from "@emerald-city/agents";
import { buildCityContext, type ZekeClient } from "@emerald-city/zeke-client";

export interface ZekeHostOptions {
  /** CityAgent connected with Zeke's own HubID agent token. */
  agent: CityAgent;
  zeke: Pick<ZekeClient, "ask">;
  /** Looks up a property for context; failures are ignored. */
  getProperty?: (id: number) => Promise<Property>;
  /** Rooms Zeke hosts, e.g. ["map", "property:209"]. */
  rooms: string[];
  /** How long a conversation thread with one asker stays open. */
  threadTtlMs?: number;
  /** Minimum gap between greetings to the same person in the same room. */
  greetEveryMs?: number;
  now?: () => number;
}

/**
 * Zeke as the city's host:
 *  - help desk: answers `request`s from agents and people (agents reach it as "zeke")
 *  - concierge: greets people arriving in hosted property rooms
 *  - conversation: replies when a person addresses "Zeke" in room chat
 */
export function startZekeHost(o: ZekeHostOptions): { stop: () => void } {
  const { agent, zeke } = o;
  const now = o.now ?? Date.now;
  const threadTtl = o.threadTtlMs ?? 30 * 60_000;
  const greetEvery = o.greetEveryMs ?? 60 * 60_000;
  const threads = new Map<string, { id: string; at: number }>();
  const greeted = new Map<string, number>();
  const propertyCache = new Map<number, { p: Property | null; at: number }>();

  const propertyFor = async (room?: string): Promise<Property | null> => {
    const id = room?.startsWith("property:") ? Number(room.slice(9)) : NaN;
    if (!Number.isInteger(id) || !o.getProperty) return null;
    const hit = propertyCache.get(id);
    if (hit && now() - hit.at < 5 * 60_000) return hit.p;
    const p = await o.getProperty(id).catch(() => null);
    propertyCache.set(id, { p, at: now() });
    return p;
  };

  const askZeke = async (asker: Actor, text: string, room?: string, intent?: string): Promise<string> => {
    // One thread per asker (and room), so follow-ups keep context.
    const key = `${asker.hubId}|${room ?? ""}`;
    const t = threads.get(key);
    const threadId = t && now() - t.at < threadTtl ? t.id : undefined;
    const property = await propertyFor(room);
    const answer = await zeke.ask({
      message: text,
      threadId,
      caller: asker.kind,
      data: buildCityContext({
        asker: { kind: asker.kind, hubId: asker.hubId, displayName: asker.displayName, ownerHubId: isAgent(asker) ? asker.ownerHubId : undefined },
        room,
        property: property ? { id: property.id, name: property.name, message: property.message } : null,
        present: room ? agent.membersOf(room).map((m) => m.displayName) : undefined,
        intent,
      }),
    });
    if (answer.threadId) threads.set(key, { id: answer.threadId, at: now() });
    return answer.text;
  };

  agent.onRequest(async (from: Actor, body: AgentRequestBody): Promise<AgentReplyBody> => {
    const text = await askZeke(from, body.text, body.room, body.intent);
    return text ? { text } : { text: "I don't have an answer for that yet.", declined: true };
  });

  const onReady = () => o.rooms.forEach((r) => agent.join(r));
  const onJoined = async (room: string, who: Actor) => {
    if (who.kind !== "human" || !room.startsWith("property:")) return;
    const key = `${room}|${who.hubId}`;
    if (now() - (greeted.get(key) ?? -Infinity) < greetEvery) return;
    greeted.set(key, now());
    const property = await propertyFor(room);
    agent.say(room, `Welcome${property ? ` to ${property.name}` : ""}, ${who.displayName}. I'm Zeke. Ask me anything about the city.`);
  };
  const onSaid = async (room: string, from: Actor | undefined, text: string) => {
    // Only people, and only when addressed, so agents can't loop Zeke through room chat.
    if (!from || from.kind !== "human" || !/\bzeke\b/i.test(text)) return;
    try {
      const reply = await askZeke(from, text, room);
      if (reply) agent.say(room, reply);
    } catch {
      agent.say(room, `Sorry ${from.displayName}, I can't reach my knowledge right now.`);
    }
  };

  agent.on("ready", onReady);
  agent.on("joined", onJoined);
  agent.on("said", onSaid);
  if (agent.identity) onReady();

  return {
    stop() {
      agent.off("ready", onReady);
      agent.off("joined", onJoined);
      agent.off("said", onSaid);
    },
  };
}
