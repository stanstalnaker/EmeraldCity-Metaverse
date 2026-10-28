# Gaia map layer

## Review: how properties reach the map today

- **hubculture.city (Laravel):** in launch-properties, the owner drops a pin on a Google Map (the default centre is NYC). The site sends lat/lng to `POST /pavilions` with `address = "Emerald City"` and `territory = "Emerald City"`.
- **HubID:** `pavilions.latitude` and `pavilions.longitude` are free strings validated only as `min:2|max:50`. There's no parcel, size or district model. The "one hectare virtual plot" exists only in marketing copy.
- **VR site:** it fetches 44 pavilions but places buildings at hardcoded coordinates. Pavilion lat/lng is never used.
- **gaia (Unity):** a 2019 Unity 2018.3 tutorial project that renders four bundled OpenStreetMap extracts. It has no backend and no property concept, so nothing actually drops properties onto Gaia.

## Beta approach

- **Source:** `GET /v2/pavilions/list?territory=Emerald City`, through `hubid-client`.
- **Normalise:** `toProperty()` validates coordinates. Invalid ones (unparseable, out of range, or 0,0) leave the property *unplaced*.
- **Shapes** (`packages/core/src/property.ts`):
  - `propertiesToPoints()` gives clustered pins at world and city zoom.
  - `propertiesToParcels()` gives a 100 m × 100 m (one hectare) square around each point, extruded from zoom 14.
- **Render:** `packages/gaia-map` uses MapLibre GL with the OpenFreeMap "liberty" style, which needs no API key. The style can be swapped through `NEXT_PUBLIC_MAP_STYLE_URL`, for example for MapTiler, Stadia or self-hosted tiles.
- **Share:** `GET /api/properties?shape=points|parcels` serves public GeoJSON to the VR client, agents and gaia.club.

Private properties and unplaced properties are never included in map output.

## Open questions and HubID follow-ups

1. **Validate on write.** HubID should reject invalid lat/lng and store `DECIMAL(9,6)`, then backfill existing rows. Until that happens, `/properties` shows which properties are "Not yet placed".
2. **Parcel collisions.** Two properties can occupy the same hectare. Options: snap to a grid (such as H3 resolution 9, about 0.1 km²) and enforce uniqueness, or allow overlap. A grid would also give districts for free.
3. **Real parcel shapes.** `VO2StakingLand` already stores geofence polygons (`/public/ven-staked-lands`). If properties should support custom footprints, reuse that shape (`geofence_coordinates`) on pavilions.
4. **gaia.club.** Point it at `apps/web` `/map`, or embed `@emerald-city/gaia-map`. Retire the Unity project.
