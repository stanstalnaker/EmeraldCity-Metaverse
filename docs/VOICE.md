# Voice & video (LiveKit)

LiveKit replaces Jitsi for audio and video inside the world. Jitsi and Zoom conference pages can keep running for formal meetings while this rolls out.

## Flow

1. **Join.** A client joins a presence room (`map` or `property:<id>`), then sends `{ "t": "media", "room": … }`.
2. **Token.** `apps/presence` checks membership and the `media:join` scope for agents. It then issues a LiveKit token (`src/media.ts`):
   - identity `hub:<hubId>`, with the display name;
   - attributes `kind` and `hubId`, plus `ownerHubId` for agents, so clients can label agents;
   - a grant for that room only, with data publishing off (positions travel over presence);
   - a 10-minute lifetime; clients ask again before it expires.
3. **Zeke.** The first media request in a property room dispatches the Zeke voice worker (`LIVEKIT_CONCIERGE_AGENT`).
4. **Proximity.** `apps/vr` (`src/spatial-audio.ts`) connects with `autoSubscribe: false`.
   - It subscribes only to voices within hearing range (40 m by default, with hysteresis).
   - Each voice plays through an HRTF `PannerNode` at its avatar's position, and the listener follows the camera.
   - The microphone turns on from the "Join voice" button, because browsers need a user gesture.

## Hosting

- Start on LiveKit Cloud; the free tier is fine for the beta. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- Self-host later with the open-source `livekit-server` (Apache 2.0) when usage justifies it. Nothing in the code changes.
- zeke-ai-server already deploys a `livekit.service`. Decide whether the city and Zeke share one LiveKit project; sharing makes dispatch simplest.

## Next

- Stage mode for events: speakers publish, the audience only subscribes, with egress to stream or record.
- Video tiles or screens in property scenes (`canPublishSources` per role).
- Per-property moderation: property admins can mute or remove participants through the LiveKit server API.
