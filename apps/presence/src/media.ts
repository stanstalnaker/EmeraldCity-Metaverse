import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import type { Actor } from "@emerald-city/core";

/** Issues LiveKit tokens for a presence room. Returns null when media isn't configured. */
export interface MediaIssuer {
  url: string;
  issue(actor: Actor, room: string): Promise<{ token: string; expiresAt: number }>;
}

export interface LiveKitOptions {
  /** wss:// URL clients connect to (LiveKit Cloud or self-hosted). */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Token lifetime in seconds. Clients re-request before expiry. */
  ttlSeconds?: number;
  /**
   * Agent (LiveKit Agents worker name) dispatched into a property's media room
   * the first time someone requests media there, e.g. the Zeke concierge.
   */
  conciergeAgentName?: string;
}

/** LiveKit participant identity for a HubID actor. Parsed back by clients to match avatars. */
export const mediaIdentity = (hubId: number) => `hub:${hubId}`;

export function liveKitIssuer(opts: LiveKitOptions): MediaIssuer {
  const ttl = opts.ttlSeconds ?? 600;
  const dispatcher = opts.conciergeAgentName
    ? new AgentDispatchClient(opts.url.replace(/^ws/, "http"), opts.apiKey, opts.apiSecret)
    : null;
  const dispatched = new Set<string>();

  return {
    url: opts.url,
    async issue(actor, room) {
      const at = new AccessToken(opts.apiKey, opts.apiSecret, {
        identity: mediaIdentity(actor.hubId),
        name: actor.displayName,
        ttl,
        // Clients read these to label agents distinctly from people.
        attributes: {
          kind: actor.kind,
          hubId: String(actor.hubId),
          ...(actor.kind === "agent" ? { ownerHubId: String(actor.ownerHubId) } : {}),
        },
      });
      at.addGrant({
        roomJoin: true,
        room,
        canSubscribe: true,
        canPublish: true,
        // Positions travel over presence, not LiveKit data channels.
        canPublishData: false,
      });
      const token = await at.toJwt();

      if (dispatcher && opts.conciergeAgentName && room.startsWith("property:") && !dispatched.has(room)) {
        dispatched.add(room);
        dispatcher
          .createDispatch(room, opts.conciergeAgentName, { metadata: JSON.stringify({ room }) })
          .catch((err) => {
            dispatched.delete(room);
            console.error(`concierge dispatch to ${room} failed`, err);
          });
      }
      return { token, expiresAt: Date.now() + ttl * 1000 };
    },
  };
}

export function liveKitFromEnv(env: Record<string, string | undefined> = process.env): MediaIssuer | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  return liveKitIssuer({
    url: LIVEKIT_URL,
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
    conciergeAgentName: env.LIVEKIT_CONCIERGE_AGENT || undefined,
  });
}
