# Deploying Emerald City (beta)

> **The live hubculture.city and vr.hubculture.city stay untouched.** This beta runs side by side on
> its own subdomain (e.g. `beta.hubculture.city`) and must not replace or interfere with the live
> environment until it reaches parity with the existing metaverse (see docs/EXISTING-METAVERSE.md, section 6)
> and Hub Culture signs off. HubID changes ship only as reviewed, backwards-compatible additions.

## What runs where

| Service | Image / command | Public address (suggested) |
|---|---|---|
| Web site | `deploy/web.Dockerfile` (Next.js standalone, port 3000) | `https://beta.hubculture.city` |
| Presence (people + agents, WebSocket) | `deploy/services.Dockerfile` (port 8787) | `wss://presence.beta.hubculture.city` |
| Zeke host (in-world Zeke) | `deploy/services.Dockerfile`, `zeke-host` command | internal only |
| Zeke voice worker (optional) | `deploy/services.Dockerfile`, `zeke-voice` command | internal only (connects out to LiveKit) |
| HubID | existing `hub/HubID` API, with branches `fix/pavilion-authz` + `feature/emerald-city-parcels` merged | `https://id.hubculture.com` |
| Live site (unchanged) | `hub-culture/emerald-city-laravel`, `hub/vr-hubculture-city` | `https://hubculture.city`, `https://vr.hubculture.city` |

Both images were built and smoke-tested: all web pages served from the container against a HubID
mock, and presence started and rejected invalid tokens (close code 4401).

## Build and run

```bash
cp .env.example .env        # fill in (see below)
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/docker-compose.yml --env-file .env --profile voice up -d   # + Zeke voice
```

Put a TLS reverse proxy in front (Caddy, nginx, or a load balancer):
- `beta.hubculture.city` → `web:3000`.
- `presence.beta.hubculture.city` → `presence:8787`, with WebSocket upgrade enabled.

Set `NEXT_PUBLIC_PRESENCE_URL=wss://presence.beta.hubculture.city` and `VITE_PRESENCE_URL` for the VR app.

## Beta access: HubID, not passwords

Every `*.beta.hubculture.city` site is behind one HubID sign-in (`apps/beta-gate`):
- **Who gets in:** HubID super administrators, general administrators and Beta Testers (level 8). `GATE_LEVELS` adds more level names.
- **How it works:** one sign-in covers every beta site, through an encrypted, HttpOnly session cookie for `.beta.hubculture.city`, valid for 12 hours by default. The 3D city gets the member's HubID token from the gate, for presence.

Caddy (replace the `basic_auth` blocks):

```
(beta_gate) {
  forward_auth 127.0.0.1:8790 {
    uri /verify
    copy_headers X-Hub-User-Id X-Hub-User-Name
  }
}
beta.hubculture.city {
  handle /_gate/* { reverse_proxy 127.0.0.1:8790 }
  handle { import beta_gate
           reverse_proxy 127.0.0.1:8080 }
}
gaia.beta.hubculture.city { import beta_gate
                            reverse_proxy 127.0.0.1:3000 }
city.beta.hubculture.city { import beta_gate
  handle_path /legacy/* { root * /srv/vr-hubculture-city/src
                          file_server }
  handle_path /unity/*  { root * /srv/unity
                          file_server }
  handle { root * /srv/emerald-city-beta/apps/city3d/dist
           file_server } }
# Presence checks the HubID token itself; no gate (browsers can't send cookies or passwords on WebSockets cross-site).
presence.beta.hubculture.city { reverse_proxy 127.0.0.1:8787 }
```

Environment:
- **Gate:** `GATE_SECRET` (32 or more random characters), `GATE_DOMAIN=beta.hubculture.city`, and the usual `HUBID_*`.
- **Which HubID people sign in with:** access should come from members' real HubID levels (admins, Beta Testers), but beta runs on staging HubID, where people's normal logins and levels may not exist. Point the gate alone at the real HubID with `GATE_HUBID_API_URL=https://id.hubculture.com`, `GATE_HUBID_PUBLIC_KEY` and `GATE_HUBID_PRIVATE_KEY` (an app key pair for the gate). It only signs people in and reads their profile and levels. The rest of beta stays on staging. Without them, the gate uses `HUBID_*`.
- **Presence, with the real HubID:** people behind the gate carry real-HubID tokens, so presence must check them there too. Set `PRESENCE_HUBID_API_URL=https://id.hubculture.com` (with `PRESENCE_HUBID_PUBLIC_KEY` / `_PRIVATE_KEY`; the gate's key pair works) and `PRESENCE_VERIFY=hubid`. Presence then asks HubID who each token belongs to, so HubID's JWT signing secret never leaves HubID.
- **The rule, the same on every beta site:** HubID super admins (`sadmin`), General Administrators, and members with the Beta Testers level (level 8) get in. Membership comes from HubID `GET /user` (`memberships`, by level name). Every `*.beta.hubculture.city` site sits behind this one gate.
- **If sign-in fails:** the gate's log says why. "HubID refused a sign-in (401 …)" means a wrong password, or an account that doesn't exist on that HubID. "HubID sign-in failed" means HubID was unreachable or the keys are wrong. "has no beta level" lists the member's levels.
- **3D city build:** `VITE_GATE_URL=https://beta.hubculture.city`.
- **Land app:** `CITY3D_ORIGIN=https://city.beta.hubculture.city`, so the screens' requests carry the session cookie.

Check:
- signed out, any beta address goes to the HubID sign-in page;
- a Beta Tester gets in everywhere with one sign-in;
- a member without beta access sees "doesn't have beta access";
- `/_gate/logout` signs out of every beta site.

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
4. **Deploy the beta alongside the live site (no cutover).**
   - Deploy the stack to `beta.hubculture.city` only.
   - Point it at a **staging HubID** first, not production.
   - The live hubculture.city and vr.hubculture.city keep running unchanged.
   - Any later cutover is a separate decision, made only after parity with the existing metaverse and
     Hub Culture sign-off. It would then need a migration plan for live users, URLs and conferences.
5. **Rotate credentials before launch.** Follow the private rotation runbook (not in this public repo):
   - HubID public/private keys,
   - Google Maps keys,
   - the Photon AppId,
   - Zeke's committed production `.env` (OpenAI, OpenRouter, Tavily, Brave, LiveKit, AWS SES, database, `SYSTEM_BEARER_TOKEN`),
   - HubID's committed TLS/JWT keys.

   After rotating, remove the old values from the legacy repos' code.
