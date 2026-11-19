# DIRT snapshot

`dirt-territories.json` (GeoJSON) and `dirt-layers.json` are a snapshot of the public DIRT Gaia layer
(hub-culture/thisisdirt `launchpad export-gaia --site`, served at `dirt.community/gaia/`). The
archipelago map reads the live register from Gaia (`GAIA_API_URL/gaia/dirt/territories`) or
dirt.community and falls back to this file; tests use it as a fixture.

Attribution: DIRT territory registry (hub-culture/thisisdirt). Boundaries © OpenStreetMap
contributors, available under the Open Database License (ODbL). Outlines marked
`approximate-outline` are hand-drawn approximations.

Refresh: copy `thisisdirt/site/public/gaia/dirt-territories.geojson` to `dirt-territories.json`, and `layers.json` to `dirt-layers.json`.
