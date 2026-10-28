# HubID agents & robots in Emerald City

## What HubID already has

- **Bot sub-profiles.** `userprofiles.profile_type = 'bot'`, with `profile_variant` set to one of `ai__ai`, `ai__bot`, `ai__virtual_reality_persona` or `object__property`. Each one is a full `users` row with a `parent_user_id` pointing at its human owner. Every pavilion is already owned by an `object__property` bot (see `PavilionsController::create`).
- **Mandala agents.** `registration_type = 'mandala-agent'` at user level 63. They authenticate with `POST /mandala/auth` and get scopes from `Mandala/Auth/ScopeRegistry.php`. Scopes are `identity:read`, `ven:read`, `ven:send`, `ven:request`, `messages:send` and `hub:read`, but only the first two can be granted today.
- **Zeke** (user level 39) has its own read feeds, including `/zeke/pavilions/all`.

## Model for the beta

An **agent** is a HubID bot sub-profile (`profile_type = 'bot'`, variant `ai__*`) with:

| Field | Source |
|---|---|
| `hubId` | the sub-profile's user id |
| `ownerHubId` | `parent_user_id`: the accountable human |
| `variant` | `profile_variant` |
| `scopes` | granted at token issue (see below) |

In code this is `AgentActor` in `packages/core/src/actor.ts`. Humans are `HumanActor`. Every surface that shows actors (map, VR, chat) receives `kind` and must make agents visibly distinct.

### Scopes

The beta adds these to the Mandala scope registry:

| Scope | Allows |
|---|---|
| `presence:write` | connect to presence and appear in rooms |
| `city:move` | join rooms and move around the map and property scenes |
| `property:read` | read property details and zones, including private ones the owner can see |
| `property:manage` | act as a property admin (only for properties the owner administers) |

`messages:send` already exists. In the city it must also pass the recipient's interaction policy.

### Human control

Each human profile gets an `AgentInteractionPolicy` (`packages/core/src/actor.ts`):

- `allowAgentDirectMessages`, default **false**.
- `allowFriendsAgents`, default **true**: agents owned by your friends may DM you.
- `showAgents`, default **true**: you can hide agents from your view.

## HubID changes needed

1. **Scoped agent tokens.** `POST /mandala/auth` (or a new `/agents/token`) should issue a JWT for the bot sub-profile with a `scope` claim and the owner's id. Presence would then read scopes from the token. Today it applies a default set (`apps/presence/src/identity.ts`, marked TODO).
2. **Register the new scopes** above in `ScopeRegistry`, and let owners grant them.
3. **Agent creation for owners.** `POST /user/sub-profiles` exists already; expose it for `ai__*` variants and cap the number of agents per owner.
4. **Interaction policy storage** on the user profile, plus an endpoint to read and update it.
5. **Security-review Mandala agent authentication** before agents get write scopes.
6. Optional: a DID for each agent (`did:web:id.hubculture.com:agents:<id>`), following `docs/mandala/interop.md`.

## SDK

```ts
import { CityAgent } from "@emerald-city/agents";

const agent = new CityAgent({ presenceUrl, token });
agent.on("ready", () => agent.enterProperty(209));
agent.on("joined", (room, who) => who.kind === "human" && agent.say(room, `Hi ${who.displayName}`));
agent.connect();
```

`CityAgent` refuses to run on a human token. Agents need their own sub-profile, so their actions are never attributed to the person who owns them.
