import { jwtVerify } from "jose";
import type { Actor, AgentScope } from "@emerald-city/core";
import type { HubIdClient } from "@emerald-city/hubid-client";

/** Applied until HubID issues scoped agent tokens (docs/AGENTS.md). */
export const DEFAULT_AGENT_SCOPES: AgentScope[] = [
  "identity:read",
  "presence:write",
  "city:move",
  "property:read",
  "media:join",
  "agents:request",
];

/** Turns a bearer token into a verified Actor, or throws. */
export type IdentityResolver = (token: string) => Promise<Actor>;

interface HubSelf {
  id: number;
  name?: string;
  first?: string;
  last?: string;
  image?: string | null;
  profile?: {
    profile_type?: string | null;
    profile_variant?: string | null;
    parent_user_id?: number | null;
    image?: string | null;
  } | null;
}

/**
 * Verifies a HubID JWT (HS256, shared JWT_SECRET with hubid_api), then loads
 * the profile from HubID to decide human vs agent. Bot sub-profiles
 * (`profile_type = 'bot'`) with a `parent_user_id` are agents owned by that user.
 */
export function hubIdResolver(opts: { jwtSecret: string; hubid: HubIdClient; agentScopes?: AgentScope[] }): IdentityResolver {
  const key = new TextEncoder().encode(opts.jwtSecret);
  return async (token) => {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const sub = Number(payload.sub);
    if (!Number.isInteger(sub) || sub <= 0) throw new Error("token has no valid subject");

    const self = await opts.hubid.withToken(token).getSelf<HubSelf>();
    if (Number(self.id) !== sub) throw new Error("token subject does not match profile");

    const displayName = self.name || [self.first, self.last].filter(Boolean).join(" ") || `HubID ${sub}`;
    const avatarUrl = self.profile?.image ?? self.image ?? null;
    const p = self.profile;
    if (p?.profile_type === "bot" && p.parent_user_id) {
      return {
        kind: "agent",
        hubId: sub,
        displayName,
        avatarUrl,
        ownerHubId: Number(p.parent_user_id),
        variant: p.profile_variant ?? "ai__bot",
        // TODO: read granted scopes from the token once HubID issues scoped agent tokens (docs/AGENTS.md).
        scopes: opts.agentScopes ?? DEFAULT_AGENT_SCOPES,
      };
    }
    return { kind: "human", hubId: sub, displayName, avatarUrl };
  };
}

/**
 * Local development only: token is "human:<id>:<name>" or "agent:<id>:<ownerId>:<name>".
 * Refuses to run when NODE_ENV=production.
 */
export function devResolver(): IdentityResolver {
  if (process.env.NODE_ENV === "production") throw new Error("devResolver must not be used in production");
  return async (token) => {
    const [kind, id, a, b] = token.split(":");
    if (kind === "human" && id) return { kind: "human", hubId: Number(id), displayName: a ?? `Human ${id}`, avatarUrl: null };
    if (kind === "agent" && id && a)
      return {
        kind: "agent",
        hubId: Number(id),
        ownerHubId: Number(a),
        displayName: b ?? `Agent ${id}`,
        avatarUrl: null,
        variant: "ai__ai",
        scopes: DEFAULT_AGENT_SCOPES,
      };
    throw new Error("bad dev token");
  };
}
