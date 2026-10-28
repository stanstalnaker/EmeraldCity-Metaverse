# Legacy audit (October 2026)

This is a read-only survey of the repos the beta replaces or depends on.

> Security findings (credentials to rotate, open issues in HubID and Zeke) are kept out of this public repository and shared privately with maintainers.

## Repos

| Repo | Stack | Last commit | Status |
|---|---|---|---|
| `hub-culture/emerald-city-laravel` | Laravel 5.8, PHP 7.1, Blade/jQuery | 2021-06 | Live (hubculture.city), to be replaced by `apps/web` |
| `hub/vr-hubculture-city` | Babylon.js 4.1, Photon JS 4.1, Webpack 4/Babel 6 | 2021-06 | Live (vr.hubculture.city), to be replaced by `apps/vr` + `apps/presence` |
| `hub-culture/emerald-city-web` | WordPress 5.4.2 plus custom plugins | 2020-08 | Legacy, retire |
| `hub-culture/gaia` | Unity 2018.3, OSM tutorial | 2019-07 | Prototype, replaced by `packages/gaia-map` |
| `hub/HubID` (`hubid_api`) | Laravel 5.0, PHP 5.5/5.6, MySQL | active | System of record |
| `hub-culture/zeke-ai-server` | FastAPI, LangGraph, OpenAI/OpenRouter, Python LiveKit worker | active | Zeke's brain, called by `apps/zeke-host` |

## Before launch

- Complete the private security checklist: rotate the listed credentials, then fix the listed HubID authorization issues before property write flows open.
- Upgrade the HubID runtime (PHP 5.6 and Laravel 5.0 are long out of support).

## Duplication the beta removes

HubID login is implemented three times: Laravel, browser-side VR, and the WordPress plugin. Property, store and event logic exists in both WordPress and Laravel. Friends, VEN and invite code exists in all three.
