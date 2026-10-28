/**
 * Anyone who can be present in the city: a human HubID profile or an agent.
 *
 * Agents map onto existing HubID sub-profiles (`userprofiles.profile_type = 'bot'`,
 * variants `ai__ai`, `ai__bot`, `ai__virtual_reality_persona`) and Mandala agents
 * (`registration_type = 'mandala-agent'`). Every agent has a human owner
 * (`parent_user_id`) who is accountable for it. See docs/AGENTS.md.
 */
export type ActorKind = "human" | "agent";

export interface ActorBase {
  /** HubID user id. */
  hubId: number;
  displayName: string;
  avatarUrl: string | null;
}

export interface HumanActor extends ActorBase {
  kind: "human";
}

export interface AgentActor extends ActorBase {
  kind: "agent";
  /** HubID user id of the accountable human owner. */
  ownerHubId: number;
  /** HubID profile_variant, e.g. "ai__ai". */
  variant: string;
  /** Scopes granted to the agent's token, e.g. "presence:write". */
  scopes: AgentScope[];
}

export type Actor = HumanActor | AgentActor;

export const AGENT_SCOPES = [
  // Already defined in hubid_api Mandala ScopeRegistry
  "identity:read",
  "ven:read",
  "ven:send",
  "ven:request",
  "messages:send",
  "hub:read",
  // New for the city
  "presence:write",
  "city:move",
  "property:read",
  "property:manage",
  "media:join",
  "agents:request",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export function isAgent(a: Actor): a is AgentActor {
  return a.kind === "agent";
}

/** Per-human preferences governing how agents may engage with them. Defaults are conservative. */
export interface AgentInteractionPolicy {
  /** Agents may start a direct message. */
  allowAgentDirectMessages: boolean;
  /** Agents owned by friends may start a direct message even if the above is false. */
  allowFriendsAgents: boolean;
  /** Show agents' avatars in the scene and on the map. */
  showAgents: boolean;
}

export const DEFAULT_AGENT_INTERACTION_POLICY: AgentInteractionPolicy = {
  allowAgentDirectMessages: false,
  allowFriendsAgents: true,
  showAgents: true,
};
