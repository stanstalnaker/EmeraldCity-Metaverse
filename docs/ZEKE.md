# Zeke in Emerald City

Zeke is Hub Culture's AI. In the city, Zeke has two roles:

1. **Concierge host.** Zeke greets people when they enter a property, answers when someone addresses "Zeke" in chat, and talks with visitors by voice.
2. **Help desk for agents.** Any HubID agent can ask Zeke for input or help. It addresses Zeke by name (`agent.ask("zeke", …)`), so it never needs Zeke's HubID number.

## One brain, two bodies

```
           hub-culture/zeke-ai-server  (FastAPI + LangGraph, RAG, memory)
                         ▲  POST /chat (SSE), shared SYSTEM_BEARER_TOKEN
          ┌──────────────┴───────────────┐
 apps/zeke-host  host.ts            apps/zeke-host  voice.ts
 presence agent "zeke"              LiveKit Agents worker "zeke-concierge"
 - requests from agents/people      - dispatched into property:<id> rooms
 - greetings, chat replies          - Claude for turn-taking; ask_zeke tool for knowledge
          ▲ ws (presence)                 ▲ WebRTC (LiveKit)
   people · VR · other agents        people in voice
```

Zeke's knowledge, memory and personality stay in `zeke-ai-server`. This repo only adds the in-world host, through `@emerald-city/zeke-client`.

## Agent-to-agent protocol

Requests travel over presence (`packages/core/src/presence.ts`):

```jsonc
// client → server
{ "t": "request", "to": "zeke", "id": "q1", "body": { "text": "Where is City Hall?", "intent": "directions", "room": "property:209" } }
// server → Zeke ("from" is the verified sender, set by the server)
{ "t": "request", "from": { "kind": "agent", "hubId": 902, "ownerHubId": 7, … }, "id": "q1", "body": { … } }
// Zeke → server → asker
{ "t": "reply", "from": { "hubId": 39, … }, "id": "q1", "body": { "text": "North side of the plaza." } }
```

Rules the presence server enforces:
- **Named targets:** `to` is a HubID id, or a service name from `PRESENCE_SERVICES` (for example `zeke:<id>`).
- **Agents only:** requests can only be sent to agents. Agents can't open requests to humans; that waits on the interaction policy in AGENTS.md.
- **Replies:** only agents can reply, and a reply goes back to the asker.
- **Scope:** agents need the `agents:request` scope to send requests.
- **Rate limit:** each connection can send 30 requests a minute by default.
- **Size limit:** a request can be at most 8 KB, and `id` is restricted to `[A-Za-z0-9_-]`.

The same protocol works between any two agents. A property's guide agent can ask a shop agent about stock, for example. Zeke is just the default place to go.

## How Zeke treats in-world askers

- **Who is asking.** Each call sets `user_type` to `"human"` or `"agent"`. Agents are introduced to Zeke as acting for their owner (`owner_hub_user_id`) and get help, not actions.
- **Context.** The host sends server-built context: who is asking, the room, the property, and who else is there. Zeke puts `data` straight into its system prompt, so `buildCityContext()` clips every field and strips control characters. Free text from agents only ever goes in `message`.
- **Threads.** There is one Zeke thread per asker per room, open for 30 minutes, so follow-up questions keep their context.
- **No delegated authority.** The city never passes anyone's HubID token to Zeke. As a result, Zeke's personal tools (sending VEN, friends search) and long-term memory are **off** in the world. That is deliberate for the beta; see the follow-ups below.

## Voice

When the first person turns on voice in a property room, `apps/presence` dispatches the `zeke-concierge` worker into it.
- **Pipeline:** Deepgram speech-to-text, then a fast Claude model (`ZEKE_VOICE_MODEL`) that handles greetings and short replies itself, then Cartesia text-to-speech.
- **Knowledge:** factual questions go to Zeke through `ask_zeke`. That keeps Zeke's brain in one place and avoids the 3–5 LLM calls per turn of routing everything through `/chat`.
- **Existing Python worker:** zeke-ai-server already runs its own Python voice worker (`zeke-voice-agent`). If you prefer it, point `LIVEKIT_CONCIERGE_AGENT=zeke-voice-agent` at the same LiveKit project. It expects participant metadata from Zeke's own `/livekit/token`, though, so the Node worker is the better fit here.

## Running it

```bash
pnpm --filter @emerald-city/presence dev                 # PRESENCE_SERVICES=zeke:39
pnpm --filter @emerald-city/zeke-host dev                # presence host (text)
pnpm --filter @emerald-city/zeke-host voice:dev          # voice worker (needs LiveKit + provider keys)
```

## Follow-ups in zeke-ai-server

1. **Credential hygiene.** Work through the private security checklist for zeke-ai-server before the city goes live.
2. **Per-caller credentials.** Replace the single `SYSTEM_BEARER_TOKEN` with one key per caller (city host, Telegram, app), so the city can be rate-limited and revoked on its own.
3. **Treat agents as a first-class caller.** Accept `user_type: "agent"` and an owner id, keep memory per agent, and stop agents from triggering personal tools.
4. **Signed identity from the city.** For memory and personal tools to work in the world without forwarding user tokens, Zeke should accept a short-lived identity assertion signed by presence (the verified HubID id and kind) and check it the way it checks `hub_auth` today.
5. **City knowledge.** Add a tool that reads pavilions/properties and zones (`/zeke/pavilions/all` already exists in HubID), so Zeke can answer "what's in this building?" without relying on training docs.
6. **Streaming for voice.** Expose a lightweight answer mode (single agent, streamed tokens) so voice can start speaking sooner.
