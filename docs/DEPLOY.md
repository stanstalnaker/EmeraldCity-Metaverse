# Deploying Emerald City (hubculture.city)

## What runs where

| Service | Image / command | Public address (suggested) |
|---|---|---|
| Web site | `deploy/web.Dockerfile` (Next.js standalone, port 3000) | `https://hubculture.city` |
| Presence (people + agents, WebSocket) | `deploy/services.Dockerfile` (port 8787) | `wss://presence.hubculture.city` |
| Zeke host (in-world Zeke) | `deploy/services.Dockerfile`, `zeke-host` command | internal only |
| Zeke voice worker (optional) | `deploy/services.Dockerfile`, `zeke-voice` command | internal only (connects out to LiveKit) |
| HubID | existing `hub/HubID` API, with branches `fix/pavilion-authz` + `feature/emerald-city-parcels` merged | `https://id.hubculture.com` |
| Legacy site | `hub-culture/emerald-city-laravel` | `https://legacy.hubculture.city` (temporary) |

Both images were built and smoke-tested: all web pages served from the container against a HubID
mock, and presence started and rejected invalid tokens (close code 4401).

## Build and run

```bash
cp .env.example .env        # fill in (see below)
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/docker-compose.yml --env-file .env --profile voice up -d   # + Zeke voice
```

Put a TLS reverse proxy in front (Caddy, nginx, or a load balancer):
- `hubculture.city` → `web:3000`.
- `presence.hubculture.city` → `presence:8787`, with WebSocket upgrade enabled.

Set `NEXT_PUBLIC_PRESENCE_URL=wss://presence.hubculture.city` and `VITE_PRESENCE_URL` for the VR app.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `HUBID_API_URL`, `HUBID_PUBLIC_KEY`, `HUBID_PRIVATE_KEY` | web, presence, zeke-host | **New, rotated keys.** Never shipped to browsers. |
| `HUBID_JWT_SECRET` | presence | Same as HubID's JWT secret. Presence refuses to start in production without it. |
| `CITY_TERRITORY` | web | `Emerald City` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | web | OpenFreeMap needs no key. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_CONCIERGE_AGENT` | presence, zeke-voice | Voice and video. |
| `ZEKE_API_URL`, `ZEKE_SYSTEM_TOKEN`, `ZEKE_HUBID_TOKEN`, `PRESENCE_SERVICES=zeke:<Zeke's HubID id>` | zeke-host, presence | Zeke in the world. |
| `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `ZEKE_VOICE_MODEL` | zeke-voice | Optional voice. |
| `GOOGLE_MAPS_API_KEY` | (web, places) | Server-only, restricted to the Geocoding API. |

HubID itself needs (in `config/emeraldcity.php` / its `.env`):

| Variable | Notes |
|---|---|
| `EC_ZEKE_TREASURY_USER_ID` | **Zeke's HubID account: the Hub Culture treasury.** Gaia land sales and extra-parcel fees settle here. |
| `EC_GOOGLE_MAPS_KEY` | Server-only Geocoding key, for optional link credentials. |
| `EC_INCLUDED_PARCELS` (3), `EC_EXTRA_PARCEL_FEE_VEN` (10), `EC_BROKER_FEE_RATE` (0.01), `EC_RULES_VERSION` (`2026.11-1`) | Defaults match the agreed rules. |

## Go-live checklist

1. **HubID code.**
   - Review and merge `fix/pavilion-authz`, then `feature/emerald-city-parcels`.
   - Port `hubid_api/database/emerald-city/2026_11_03_cities_parcels.sql` into `Hub/db-migrations` and apply it on staging.
   - On staging, run through: launch a city, import parcels, claim, list, buy, link, verify.
2. **HubID configuration.**
   - Set `EC_ZEKE_TREASURY_USER_ID` and `EC_GOOGLE_MAPS_KEY`.
   - For each partner city, make sure a `partners` record with `userid` exists and is linked to the
     city's hub in `partners_hub_relation`.
3. **Emerald City.**
   ```bash
   # beta repo: export the layout
   pnpm --filter @emerald-city/parcels generate emerald-city --hubid --out ./out
   # HubID server
   php artisan emeraldcity:create-city emerald-city "Emerald City" <Hub Culture hub id> --ven-per-hectare=10 --minimum-ven=5
   php artisan emeraldcity:import-parcels emerald-city ./out/emerald-city.hubid.json
   php artisan emeraldcity:migrate-properties emerald-city --dry-run   # review the plan
   php artisan emeraldcity:migrate-properties emerald-city
   ```
   Existing properties are grandfathered (no charge). The oldest properties get the most central
   parcels. Their real lat/lng becomes a real-world link.
4. **Deploy and cut over hubculture.city.**
   - Deploy the stack to staging (e.g. `beta.hubculture.city`), then smoke-test sign-in, a claim, the market and nearby.
   - Move the legacy Laravel site to `legacy.hubculture.city`.
   - Point `hubculture.city` at the new web service.
   - Add redirects for legacy URLs: `/c/{slug}` (conferences) → `legacy.hubculture.city/c/{slug}`, and
     `/p/{slug}/{id}` → `/p/{id}`.
   - Lower the DNS TTL a day before the switch.
5. **Rotate credentials before launch.** Follow the private rotation runbook (not in this public repo):
   - HubID public/private keys,
   - Google Maps keys,
   - the Photon AppId,
   - Zeke's committed production `.env` (OpenAI, OpenRouter, Tavily, Brave, LiveKit, AWS SES, database, `SYSTEM_BEARER_TOKEN`),
   - HubID's committed TLS/JWT keys.

   After rotating, remove the old values from the legacy repos' code.
