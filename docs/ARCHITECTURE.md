# Architecture

```
                    ┌────────────────────── hub/HubID (PHP) ─────────────────────┐
                    │ users · userprofiles (bot sub-profiles) · pavilions/zones   │
                    │ friends · messages · VEN · Mandala agent auth (scopes)      │
                    └──────────▲──────────────────────▲───────────────────────────┘
                               │ hubid-client (server) │ JWT verify + /user
        ┌──────────────────────┴───┐          ┌────────┴──────────────┐
        │ apps/web (Next.js)       │          │ apps/presence (ws)    │
        │  /properties  /p/[id]    │          │  rooms: map,          │
        │  /map  (gaia-map)        │          │         property:<id> │
        │  /api/properties GeoJSON │          │  humans + agents      │
        └──────▲───────────▲───────┘          └──▲──────────▲─────────┘
               │           │ GeoJSON             │ ws       │ ws
          browsers      apps/vr (three/WebXR) ───┘   packages/agents (CityAgent)
                              │ WebRTC                           │ ask("zeke")
                        LiveKit (voice/video) ◄── zeke-concierge  apps/zeke-host ──► zeke-ai-server /chat
```

See [ZEKE.md](ZEKE.md) and [VOICE.md](VOICE.md).

## Key decisions

- **HubID stays the system of record.** Properties, profiles, friends and VEN keep living in HubID. The beta reads and writes through the API and doesn't hold its own copy. Changes the beta needs on the HubID side are listed in AGENTS.md and GAIA-MAP.md.
- **Property = pavilion.** `packages/core/src/property.ts` turns a raw pavilion into a `Property` with a validated `location`. Pavilions store lat/lng as unvalidated strings, so anything unparseable, out of range or at 0,0 counts as *unplaced* rather than being drawn in the wrong spot.
- **One presence system for everyone.** The legacy VR site put every visitor in a single random Photon room and let clients assert their own name and HubID id. In the new presence server:
  - The server works out identity from a verified HubID JWT.
  - Rooms are per property (`property:<id>`) plus a global `map` room.
  - Agents connect the same way humans do, are always labelled `kind: "agent"`, and are gated by scopes.
- **Keys stay on the server.** Only server code uses `hubid-client`; the browser goes through `apps/web`.

## Migration path from the legacy repos

| Legacy | Beta |
|---|---|
| `emerald-city-laravel` property list/single/my-properties | `apps/web` `/properties`, `/p/[id]` (read). Create/edit flows next |
| Google Maps pin drop in launch-properties | `gaia-map` with MapLibre and OpenFreeMap (no API key) |
| `vr-hubculture-city` Babylon scene, hardcoded building positions | `apps/vr`: parcels placed from HubID lat/lng |
| Photon `joinRandomRoom`, self-asserted identity | `apps/presence` |
| Jitsi in the VR scene | LiveKit proximity voice (`apps/vr/src/spatial-audio.ts`) |
| Jitsi/Zoom conference pages | Keep for now; stage mode on LiveKit later |
| `emerald-city-web` (WordPress) | Retire |
| `gaia` (Unity 2018 OSM tutorial) | Replaced by `packages/gaia-map` |

## Next steps

1. Authenticated web flows: HubID login (server session), my-properties, create/edit property with a map pin.
2. Property scenes in VR: per-property rooms, zones and seats from `/pavilions/{id}/zones`.
3. HubID work for agents (see AGENTS.md): scoped agent tokens, presence scopes, owner consent.
4. Complete the private HubID security checklist before opening write flows.
