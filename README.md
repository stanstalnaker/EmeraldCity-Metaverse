# Emerald City (beta)

> **Status:** early beta, built separately from the live hubculture.city and vr.hubculture.city, which
> stay untouched. Most of the existing citizen experience hasn't been carried over yet; see
> [the study and parity checklist](docs/EXISTING-METAVERSE.md).

The next version of [hubculture.city](https://hubculture.city): Hub Culture's Emerald City metaverse, rebuilt as one TypeScript monorepo.

Three goals for the beta:

1. **Refresh the core.** Replace Laravel 5.8, Babylon 4 + Photon, and the WordPress site with one typed codebase on current tooling.
2. **Drop properties onto the Gaia map.** Every Emerald City property (a HubID *pavilion*) appears on a real-world map layer as a pin and a one-hectare parcel.
3. **Let HubID agents and robots live in the city.** Agents get their own HubID identity, an accountable human owner and scoped permissions. They share presence with human profiles on terms the humans control. **Zeke** hosts the city and is the help desk every agent can turn to.

HubID (`hub/HubID`) remains the system of record for users, properties, friends and VEN. This repo talks to it through `@emerald-city/hubid-client`.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js city site: properties, property pages, Gaia map, public GeoJSON API |
| `apps/vr` | three.js + WebXR client (successor to `hub/vr-hubculture-city`) |
| `apps/presence` | WebSocket presence for humans **and** agents: verified HubID identity, per-property rooms, agent-to-agent requests, LiveKit tokens |
| `packages/core` | Shared types: Property, geo and parcel math, Actor (human/agent), presence protocol |
| `packages/hubid-client` | Typed, server-side HubID API client |
| `packages/gaia-map` | MapLibre GL layer that drops properties onto real-world tiles |
| `apps/zeke-host` | Zeke in the city: concierge host and help desk for agents (presence), plus the LiveKit voice worker |
| `packages/agents` | SDK for HubID agents/robots (`CityAgent`: move, chat, `ask("zeke", …)`, voice) plus examples |
| `packages/parcels` | Parcel engine: road, water and border-bounded parcels, seeded starter cities, Gaia (OpenStreetMap) importer |
| `packages/places` | Server-side Google Maps geocoding and optional real-world link verification against HubID |
| `packages/zeke-client` | Server-side client for Zeke's `/chat` SSE API |
| `docs/` | Architecture, agent identity design, Gaia map notes, legacy audit |

## Quick start

```bash
corepack enable          # pnpm 10
pnpm install
cp .env.example .env     # fill in HubID keys (server-side only)
pnpm dev                 # web :3000, vr :5173, presence :8787, zeke host
```

Try an agent locally. With no `HUBID_JWT_SECRET` set, the presence server accepts dev identities:

```bash
AGENT_TOKEN=agent:900:1:Concierge PROPERTY_ID=209 pnpm --filter @emerald-city/agents example:concierge
```

## Try it locally (no real HubID needed)

```bash
pnpm install
pnpm demo                # mock HubID on :4900 + site on http://localhost:3000
```

Sign in as **stan@demo.hub** or **ana@demo.hub** (password `demo`). Stan owns two properties.
Open **Cities → emerald-city**, click **Publish starter layout**, then claim a parcel, list it on the
Market, link it to a real place, and sign in as Ana to buy it. The mock (`tools/mock-hubid`) keeps
everything in memory and resets on restart. Zeke's account receives Hub Culture's payments.

## Checks

```bash
pnpm typecheck && pnpm test && pnpm build
```

## Docs

- **[The existing metaverse: full study and rebuild plan](docs/EXISTING-METAVERSE.md)**: start here

- [Architecture](docs/ARCHITECTURE.md)
- [Agents & robots in HubID](docs/AGENTS.md)
- [Cities, parcels and ownership](docs/PARCELS.md)
- [Zeke in Emerald City](docs/ZEKE.md)
- [Voice & video (LiveKit)](docs/VOICE.md)
- [Gaia map layer](docs/GAIA-MAP.md)
- [Deploying hubculture.city](docs/DEPLOY.md)
- [Legacy audit](docs/LEGACY-AUDIT.md): what the old repos do and what the beta replaces
