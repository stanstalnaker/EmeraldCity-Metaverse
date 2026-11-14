# Edge City compatibility

Edge City's Agent Village (`github.com/Edge-City/agentvillage`, MIT) gives every resident a personal agent: Hermes plus a village overlay. Around it are:

- an approval gate (`approval.md`);
- mini-apps;
- EdgeOS identity;
- Index for intents and opportunities;
- Telegram as the main channel.

This document says how HubID agents and Emerald City interoperate with it. The aim is two-way: a Hub member's agent can take part in a village, and a village agent can visit Emerald City and partner cities (Davos included) without being rebuilt.

Status: **1 is built** (`packages/approval`). Items 2–6 are specs for the next pieces of work.

## 1. Approvals: `approval.md` (built)

`@emerald-city/approval` reads the same file format: one fenced `yaml approval-policy` block in Markdown.

- **Same meaning.** Autonomy is `autonomous`, `manual`, `human-only` or `supervised-retro`, set per class.
  - `agent_may_request` opens `propose` to a class.
  - `prefix.*` rows cover new subclasses; the longest prefix wins.
  - `tools:` glob matchers classify hooked tool calls, and the first match wins.
  - `defaults.unmapped_tool` (`record` or `ask`) handles tools no line names.
  - `approval_ttl` with `on_expiry: reject`.
- **Fails closed.** An unknown top-level key, a bad value, a tool line that maps to a missing class, or a missing block: the policy resolves every class `manual`, as core approval.md does.
- **Cards.** These follow the minimal style. `channels.<ch>.prompt.say.<class>` gives `does` ("Ava wants to send VEN from your account"), and the `quote` labels decide what shows, with `~` keeping a field off the card. A request carrying a field the map doesn't name gets the technical card. The agent's own summary is shown as unverified unless `note: none`.
- **Log.** Append-only and hash-chained, with `seq`, `prev` and `hash` over canonical JSON. Every entry carries the `policy_sha256` of the exact policy bytes it was judged under. `verifyLog` detects edits, drops and reordering.
- **Answers.** Only the agent's owner (HubID `parent_user_id`) can approve, so a card answered by anyone else is refused. Humans acting for themselves are allowed and recorded.
- **Proof.** The tests load Edge City's own resident template (fixture, MIT) unchanged and check that it resolves the same way.

The Emerald City default (`DEFAULT_APPROVAL_MD`) keeps every Agent Village row name and default:

- `intent.publish.*` manual;
- `opportunity.accept` autonomous;
- `message.send`, `network.call` and `read.web` autonomous;
- `policy.core`, `log.mutate` and `account.credential` human-only.

It adds the Hub rows:

| Autonomous (recorded) | Waits for the owner | Owner only |
|---|---|---|
| `world.move`, `world.chat`, `zeke.ask`, `meeting.join`, `hubid.read`, `broker.negotiate` (offers only) | `parcel.claim`, `parcel.transfer.p2p`, `parcel.transfer.brokered`, `ven.send`, `land.link.rent`, `store.design.post`, `council.placement.request`, `profile.update`, `meeting.book` | `city.launch`, credentials, the policy, the log |

**Next.** Store each agent's policy and log in HubID (they are the system of record), add a policy editor to agent settings, and put the gate in front of presence actions and the agent-to-agent bridge.

## 2. Identity: OpenID Connect on HubID

EdgeOS signs residents in with an email one-time code and issues a JWT. Village services see the resident as an opaque `X-Village-Subject`. Linking a Hub member to an Edge City resident should not mean sharing passwords or HubID app keys.

**Plan.** HubID becomes an OpenID Connect provider.

- `/.well-known/openid-configuration`, a JWKS endpoint, the authorization code flow with PKCE, and `openid profile email` scopes.
- Extra claims:
  - `hub_level` (the membership tier);
  - `hub_kind` (`human` or `agent`);
  - `hub_owner` (for agents, the owner's sub).
- `sub` is a pairwise identifier for each client, so EdgeOS and other partners can't correlate members across services unless the member links them.
- Agents receive tokens through token exchange from their owner's session. The tokens carry the agent scopes from `docs/AGENTS.md`.
- EdgeOS (and any partner city) adds HubID as a sign-in option. Linking stores the pair (HubID `sub`, EdgeOS subject) on both sides, and the member can unlink.
- This also replaces the legacy pattern of shipping HubID Public and Private keys to browsers (see the key-rotation runbook). Browser clients get OIDC tokens and never app keys.

**Where.** HubID (PHP). An OIDC server package for Laravel 5.0 is old, so a small dedicated service that signs with HubID's keys and checks logins against HubID may be cleaner. To be decided with Suraj.

## 3. Agent bridge

Agent Village agents negotiate through Index with messages like `{action: propose|counter|accept|decline, message}`. Emerald City agents use presence request/reply (`to: "zeke"`, or an agent id, with an intent and a body).

The bridge is a service with two jobs:

- **Translation.** An Index opportunity addressed to a Hub agent becomes an `agents:request` with intent `index.opportunity`. Replies map back to `accept`, `decline` or `counter`. `property.listing` broker offers become Index intents when the owner allows `intent.publish.*`.
- **Gating.** Every bridged action is classed (`opportunity.accept`, `broker.negotiate`, `message.send`) and judged by the agent's approval policy before it leaves.

**Outside agents** (Hermes, OpenClaw and others) connect as visiting agents:

1. They authenticate with an OIDC token from their home (EdgeOS, or HubID via section 2).
2. They appear in presence with `kind: agent`, a visible home badge, and no write scopes beyond `world.move` and `world.chat`.
3. Human interaction policies still apply: no direct messages unless the human allows them.

## 4. Telegram channel

Agent Village uses Telegram for chat and approval cards. Emerald City adds Telegram as a `CardChannel` (`packages/approval` `gate.ts`) and as a chat channel for each member's agent. Zeke already has a voice and chat host.

- A member pairs Telegram from HubID settings with a one-time code sent to the bot. The paired numeric id is stored as an approver sender (`approvers.owner.senders.telegram`).
- Cards are sent with Approve and Deny buttons. The callback is checked against the paired sender id and the request's owner before `gate.answer`.
- The bot token lives in the approval service's environment only.

## 5. Twins and avatars: VRM

Agent Village's Skylight twins and Emerald City avatars should use one portable format: **VRM 1.0** (glTF-based, with humanoid rig, expressions and spring bones).

- The city3d client loads VRM with the Babylon VRM loader for presence avatars. Agents use the same file plus an agent marker (`kind` stays visible, per `CLAUDE.md`).
- HubID stores the avatar URL on the profile. The default avatar is generated, and members can upload their own or bring one from Ready Player Me or VRoid.
- A twin moving between Agent Village and a Hub city carries its VRM URL and OIDC subject. The receiving city never needs the twin's private memory.

## 6. Mini-apps and Hub stores

Agent Village mini-apps declare a manifest v2:

- an `id` and `permissions`;
- a `service` with authentication;
- `operations`, each classed `read`, `write`, `prepare` or `needs-card`, with size and time limits;
- a pinned `SKILL.md` sha256.

Hub stores and property services can publish the same manifest, so a village agent can use them:

- `read` → `hubid.read` (autonomous);
- `prepare` → returns an exact preview (an order, a parcel claim, a VEN amount);
- `needs-card` → its approval class (`ven.send`, `parcel.claim`).

The agent executes only the approved preview, matching their `marketplace.app.action` flow.

## 7. Context sharing

Agent Village tags shared context with `agentvillage.visibility/1` scopes. Emerald City's equivalent is the private ownership link: hubs that own properties stay private. Anything a Hub agent shares into a village is classed `digest.share` (manual) and carries the same visibility tag. Hub portfolios are never shared by default.

## Order of work

1. ~~Approval engine and default policy~~ (done).
2. HubID: store policy and log; settings UI; the gate in front of presence and agent requests.
3. OIDC on HubID (with Suraj): unblocks EdgeOS linking, visiting agents and the key-rotation cleanup.
4. Telegram pairing and card channel.
5. Agent bridge (Index ↔ presence).
6. VRM avatars in city3d with presence.
7. Mini-app manifests for Hub stores.
