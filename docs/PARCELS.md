# Cities, parcels and ownership (spec)

**Status:** decisions agreed in design review (Oct–Nov 2026). The parcel engine, city generator, Gaia
importer, membership layers and city viewer are implemented in this repo. **Claiming parcels needs
the HubID changes in [HubID changes](#hubid-changes) first.**

## Concepts

| Concept | What it is | HubID |
|---|---|---|
| **Gaia layer** | The real world, cut into parcels | Hub Culture-owned city of kind `gaia` |
| **City** | A virtual island floating outside the real world, owned and run by a partner | new `cities` |
| **Parcel** | A piece of land between borders; holds at most one property | new `parcels` |
| **Property** | A pavilion occupying exactly one parcel | `pavilions` (+ `parcel_id`) |
| **Property hub** | The property's own community (members, news, events, wiki), one-to-one | `groups` (`pavilions.group`, made unique) |
| **Owner** | A person (via the property's bot sub-profile, as today) or a hub that owns a portfolio | `pavilions.owner_group_id` (new, private) |
| **Partner** | Organisation allowed to launch and run cities | existing `partners` + `partners_hub_relation` |

## Decisions

**Land**
- Parcels never overlap. Once claimed, a parcel is owned. Its shape never changes, even if roads or
  borders are later re-mapped. Only unclaimed land is re-cut.
- Roads are borders. Roads and rivers are public corridors and can't be claimed.
- Rural parcels split further on service roads and farm tracks. Driveways and car-park aisles never count.
- National, state/province and county lines are always borders, so every parcel resolves to exactly
  one jurisdiction. A per-country lookup decides which OpenStreetMap admin level means "state" and
  "county" (`packages/parcels/src/admin-levels.ts`).
- Large leftover areas stay large: an incentive for early players.
- Reserved land, held by Hub Culture: disputed territories, national parks, oceans, and parks inside cities.

**Cities**
- Virtual cities are islands outside the real world. Every city is cut with **the same platform rules**.
- Every new city arrives with unique starter topography generated from its slug: coastline, river
  (sometimes a tributary), ring road and avenues, a dense core grid, a skewed suburban grid, farm
  tracks and a reserved park. The partner edits it from there.
- A property in a virtual city can optionally link to a real address or point, or to a Gaia parcel.
  This is a reference, not ownership.

**People**
- Anyone signed in with a HubID can launch a property, as today.
- Only partners can launch cities. Existing HubID partner records grant this; the Partner level alone does not.
- Partners set their own launch rules (open, approval, or invite) and pricing for their city.
- Every property gets its own hub. A hub can also launch or own several properties. That ownership link is private.
- Each membership includes **3 parcels**. Every parcel beyond that costs **10 VEN** on top of the land
  price. Optional per-tier hard caps exist, but are off.
- **Transfers:** peer to peer with no fee, for speed and convenience. Or brokered: **1% of the value**
  goes to a broker who promotes the property. Brokers are Real Estate Agents, or **AI agents** with the
  `property:broker` scope, whose job is promoting listings, including to other agents.
- **Many virtual properties can link to the same real-world place.** At that place, an AR view shows
  each linked world as a floating sphere you tap to visit. This is richer when the property holds
  photos, video and other content ("memories"). It is the hook for the **Andromeda** idea:
  discoverable digital artifacts left at real places and unlocked later (to be specified).
- **Gaia parcel owners control their land's links.** They can leave it open, curate it (approve each
  link), or charge rent to others who want to link there, and can hide anything anchored on it.
  Unowned land is open.
- **Designs** (buildings, landscapes, items, art from Architects, Designers and Artisans) are posted
  **directly to the Hub stores** as digital items, alongside the stores' existing digital goods, with
  no approval to sell, which grows the VEN economy. Cities can mark **approval zones** (e.g. a historic
  district or the central plaza) where *placing* a design on a parcel needs City Council approval.

**Data**
- The Gaia layer is built from OpenStreetMap: © OpenStreetMap contributors, ODbL. Parcel geometry
  derived from it is published under ODbL with attribution. Ownership records are kept separately.

## Parcel rules (`RULES`, version `2026.11-1`)

Applied in order, strongest first (`packages/parcels/src/cut.ts`):

1. **Political borders** (national / state / county): hairline cut (0.5 m either side).
2. **Water:** rivers (25 m half-width), canals (10 m), and mapped water areas.
3. **Reserved land:** removed and reported as reserved parcels.
4. **Road corridors:** major roads 10 m half-width, local roads 6 m.
5. **Rural re-cut:** parcels over **25 ha** are re-cut on service roads (3 m) and tracks (2 m).
6. **Slivers become public space:** anything under **500 m²**, or narrower than **8 m** on average (2 × area / perimeter).

Parcel ids are stable: they hash the city, rules version and geometry. Recomputing an area whose
roads didn't change gives the same ids, so claims stay attached. Changing any rule bumps
`RULES_VERSION`. Claimed parcels keep their shape regardless.

Size bands, used for display and pricing hints: **core** under 1 ha, **urban** 1–5 ha, **suburban** 5–25 ha, **rural** over 25 ha.

Measured on OpenStreetMap samples, using local plus major roads as corridors:
- Lower Manhattan: median 0.48 ha
- Toronto: median 1.04 ha
- Paris: median 0.15 ha

Generated starter cities come out at 550–1,100 parcels, with a median of 0.6–1.6 ha.

## Membership layers (`packages/core/src/membership.ts`)

HubID memberships are numbered levels, sold through the Hub Culture store and shown on hubculture.city's Career Center.

| Layer | Levels | In the city |
|---|---|---|
| Visitor | not signed in | browse only |
| Citizen | any HubID (Logged In Users, Guest, Pending) | launch properties |
| Member | Approved Member, Personal Basic / Deluxe / Verified | launch properties |
| Business | Business Basic / Deluxe / Verified, Corporate, Entrepreneur | launch properties |
| Patron | Patron | launch properties |
| Professions | Architects, Designers → submit designs. Real Estate Agents → broker. Planners → plan districts. Merchants → sell. Artisans → create art. Services, Teachers, Healthcare, Financial Services → offer services. Influencers → promote. Developers → develop | capabilities |
| Platform | Gaia → manage the Gaia layer and reserved land. Administrators → everything. Partner record → launch cities | capabilities |

Every tier includes **3 parcels**, then pays **10 VEN** extra for each additional parcel
(`quoteClaim`). Hard caps per tier are available in `MembershipPolicy.maxParcels`, but off. HubID's
membership names were confirmed to match `LEVEL_BY_NAME`.

## Transfers and brokers (`packages/core/src/market.ts`)

| Kind | Who | Fee |
|---|---|---|
| Peer to peer | owner → buyer directly | none |
| Brokered | listed through a broker (Real Estate Agent, or AI agent with `property:broker`) | 1% of the sale price, paid to the broker out of the price |

AI brokers promote listings over the presence agent-to-agent protocol with intent `property.listing`.
Zeke and other agents can ask brokers what's for sale. Brokers are always owned by a human or hub
(agents carry `ownerHubId`), so commission and accountability go to a real owner.

## Designs and approval zones (`packages/core/src/designs.ts`)

- A design is a Hub store item (`items`) with a GLB model, a kind (building, landscape, item or art),
  a price and an optional footprint. Buying it uses the existing store and VEN flows.
- **Placing** a design on a parcel is immediate (`placed`), unless the parcel's centre falls inside one
  of the city's approval zones. Then the placement starts as `pending-approval` until the **City
  Council** approves it: the city's council hub if one is set, otherwise the city owner hub's admins.
  Zones can target specific design kinds (e.g. only buildings, or only public art).
- `checkPlacement(design, parcel, zones)` returns whether approval is needed, which zones apply, and
  whether the design's footprint fits the parcel.

## Real-world anchors and AR (`packages/core/src/anchors.ts`)

- A virtual property's `real_world_link` becomes an **anchor**: a point on Earth plus what is anchored there.
- Any number of virtual properties, across any cities, can share one place.
- `anchorsNear(point, radius)` returns everything anchored nearby, nearest first. An AR client renders
  each result as a floating sphere or speck. Tapping one opens that world.
- The anchor kind already includes `artifact`, so Andromeda-style discoverable items can use the same
  lookup once that product is specified.
- **Land owner control** (`quoteLinkRequest`): when someone links to a Gaia parcel they don't own, the
  owner's policy applies:

  | Mode | What happens |
  |---|---|
  | open | visible immediately |
  | curated | pending until the owner approves |
  | rent | visible while rent (VEN per period) is paid |

  The owner can hide any anchor at any time, and only visible anchors appear in AR. Owners link to
  their own land free. Unowned land is open.
- **Optional credentials** (`evaluateLinkCredentials`, `packages/places` `verifyLink`): linking never
  needs proof, but a link can be checked against Google Maps and HubID to earn badges:

  | Badge | Evidence | Trust |
  |---|---|---|
  | Real place | Google geocodes the address (or point), and the link is within 75 m of it | place |
  | Checked in | The person has a HubID check-in at that Google place (`/google-places`; self-reported, so weak) | presence |
  | HubID address | The person's HubID profile address geocodes to the same place (within 150 m) | resident |
  | Land owner | They own the Gaia parcel under the link | owner |

  The strongest badge sets the link's trust, which AR and listings can show (e.g. a verified ring on
  the sphere). Failures (no profile address, Google or HubID unavailable) just earn fewer badges.

## HubID changes

Proposed schema. HubID migrations live in the external `Hub/db-migrations` repo; use utf8mb4, not the legacy latin1.

```sql
CREATE TABLE cities (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug           VARCHAR(48)  NOT NULL UNIQUE,
  name           VARCHAR(120) NOT NULL,
  kind           ENUM('gaia','virtual') NOT NULL,
  owner_group_id INT UNSIGNED NOT NULL,              -- partner hub; must have a partners_hub_relation row
  launch_policy  ENUM('open','approval','invite') NOT NULL DEFAULT 'open',
  ven_per_hectare DECIMAL(12,2) NOT NULL DEFAULT 0,
  minimum_ven    DECIMAL(12,2) NULL,
  rules_version  VARCHAR(16)  NOT NULL,
  street_plan    JSON NULL,                          -- virtual cities: partner-edited layers (roads, rivers, reserved)
  created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE parcels (
  id             VARCHAR(24)  PRIMARY KEY,           -- stable engine id (p_…)
  city_id        INT UNSIGNED NOT NULL,
  status         ENUM('free','claimed','public','reserved') NOT NULL,
  reserved_reason ENUM('disputed','national-park','ocean','park','public') NULL,
  area_m2        DOUBLE NOT NULL,
  tier           ENUM('core','urban','suburban','rural') NOT NULL,
  geometry       GEOMETRY NOT NULL SRID 0,           -- local metres for virtual cities; use SRID 4326 for Gaia
  country_code   CHAR(2) NULL, state_location_id INT NULL, county_location_id INT NULL, -- Gaia: links into health_quarantine_locations tree
  rules_version  VARCHAR(16) NOT NULL,
  pavilion_id    INT UNSIGNED NULL UNIQUE,           -- one property per parcel, enforced
  claimed_at     TIMESTAMP NULL,
  SPATIAL INDEX (geometry),
  INDEX (city_id, status)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE pavilions
  ADD COLUMN parcel_id VARCHAR(24) NULL UNIQUE,
  ADD COLUMN city_id INT UNSIGNED NULL,               -- replaces free-text `territory` (keep it during migration)
  ADD COLUMN owner_group_id INT UNSIGNED NULL,        -- private: hub that owns this property in its portfolio
  ADD COLUMN real_world_link JSON NULL;               -- {kind: address|point|gaia-parcel, …}

ALTER TABLE pavilions ADD UNIQUE KEY pavilions_group_unique (`group`); -- one hub per property (after de-duplicating)

CREATE TABLE real_world_anchors (                    -- many anchors may share one place
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind        ENUM('virtual-property','artifact') NOT NULL,
  ref         VARCHAR(64) NOT NULL,                  -- pavilion id, or artifact id later
  city_id     INT UNSIGNED NULL,
  location    POINT NOT NULL SRID 4326,
  address     VARCHAR(255) NULL,
  gaia_parcel_id VARCHAR(24) NULL,
  SPATIAL INDEX (location), INDEX (kind, ref)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE cities ADD COLUMN council_group_id INT UNSIGNED NULL; -- City Council hub (defaults to owner hub admins)

CREATE TABLE approval_zones (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  city_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  geometry    GEOMETRY NOT NULL SRID 0,
  design_kinds SET('building','landscape','item','art') NULL,  -- NULL = all kinds
  SPATIAL INDEX (geometry)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE design_placements (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pavilion_id  INT UNSIGNED NOT NULL,
  parcel_id    VARCHAR(24) NOT NULL,
  store_item_id INT UNSIGNED NOT NULL,                -- the design, sold through the Hub stores
  transform    JSON NOT NULL,                         -- position / rotation / scale on the parcel
  status       ENUM('placed','pending-approval','approved','rejected') NOT NULL,
  reviewed_by_user_id INT UNSIGNED NULL,
  reviewed_at  TIMESTAMP NULL,
  created_at TIMESTAMP NULL
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE parcels
  ADD COLUMN link_mode ENUM('open','curated','rent') NOT NULL DEFAULT 'open',  -- Gaia parcels: owner's link policy
  ADD COLUMN link_rent_ven DECIMAL(12,2) NULL,
  ADD COLUMN link_rent_period_days SMALLINT NULL;

ALTER TABLE real_world_anchors
  ADD COLUMN status ENUM('visible','pending','hidden') NOT NULL DEFAULT 'visible',
  ADD COLUMN rent_paid_until TIMESTAMP NULL,         -- rent mode: hidden automatically when lapsed
  ADD COLUMN google_place_id VARCHAR(255) NULL,      -- optional credentials
  ADD COLUMN trust ENUM('unverified','place','presence','resident','owner') NOT NULL DEFAULT 'unverified',
  ADD COLUMN badges SET('real-place','checked-in','hubid-address','land-owner') NULL,
  ADD COLUMN verified_at TIMESTAMP NULL;

CREATE TABLE property_listings (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parcel_id    VARCHAR(24) NOT NULL,
  pavilion_id  INT UNSIGNED NOT NULL,
  seller_user_id INT UNSIGNED NOT NULL,
  broker_user_id INT UNSIGNED NULL,                  -- Real Estate Agent or AI agent sub-profile
  price_ven    DECIMAL(14,2) NOT NULL,
  status       ENUM('active','sold','withdrawn') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
  INDEX (status), INDEX (broker_user_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE property_transfers (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parcel_id     VARCHAR(24) NOT NULL,
  pavilion_id   INT UNSIGNED NOT NULL,
  from_owner    VARCHAR(32) NOT NULL,                -- user:<id> or hub:<id>
  to_owner      VARCHAR(32) NOT NULL,
  kind          ENUM('p2p','brokered') NOT NULL,
  price_ven     DECIMAL(14,2) NOT NULL,
  broker_fee_ven DECIMAL(14,2) NOT NULL DEFAULT 0,
  broker_user_id INT UNSIGNED NULL,
  transaction_id INT UNSIGNED NULL,                  -- VEN transaction
  created_at TIMESTAMP NULL
) DEFAULT CHARSET=utf8mb4;
```

API (HubID), behind the existing auth:
- `GET /cities`, `GET /cities/{slug}`, `GET /cities/{slug}/parcels?bbox=…`
- `POST /cities` (partner record required), `PUT /cities/{slug}` (city admins)
- `POST /parcels/{id}/claim`: checks the city launch policy and membership entitlements, then quotes
  land price + extra-parcel fee (`quoteClaim`), charges VEN, and creates the pavilion, its hub and its
  bot in **one transaction** (today's create is not transactional).
- `POST /properties/{id}/transfer` (p2p) and `POST /properties/{id}/listings` / `POST /listings/{id}/buy`
  (brokered, 1% to the broker), all moving VEN and ownership atomically.
- `GET /anchors/near?lat=&lng=&radius=`: AR discovery of every visible world anchored near a place.
- `POST /anchors/{id}/verify`: runs the optional Google Maps + HubID checks and stores badges and trust
  (Google key server-side only, `GOOGLE_MAPS_API_KEY`).
- `PUT /parcels/{id}/link-policy` (owner: open, curated or rent) and `PUT /anchors/{id}`
  (owner: approve, hide or unhide). Rent is charged per period in VEN; when it lapses, the anchor
  is hidden automatically.
- `POST /properties/{id}/placements` (checks approval zones and footprint) and
  `PUT /placements/{id}/review` (City Council: approve or reject).
- Designs use the existing store item endpoints, with a "design" category and a model URL.
- `PavilionAccess::canManage`: add admins of `owner_group_id`.

## Migration of today's Emerald City properties

Emerald City properties are pavilions with `territory = 'Emerald City'` and a point location.
1. Create Emerald City as a virtual city. Its street plan comes from the old VR layout's building
   positions (`vr-hubculture-city` demo3t.js anchors), or from the generator.
2. Give each existing property the parcel nearest its point. On a collision, the oldest property wins
   and the others get the next nearest free parcel.
3. Keep each property's real address or point as a `real_world_link`.

## Open questions

1. **Andromeda:** to be specified as a separate project. Anchors already support an `artifact` kind for it.

No other questions are open.

Resolved since the first draft:
- Parcel limits: 3 included, then 10 VEN per extra parcel.
- Transfers: peer to peer, or brokered at 1%.
- Many-to-one real-world links: yes.
- Membership names: confirmed.
- Designs: posted directly to Hub stores, with City Council approval only for placements inside approval zones.
- Gaia land owners: can curate, hide, or charge rent for links to their land.
- Address links: no proof required; optional credentials from Google Maps and HubID earn trust badges.
- Very large rural parcels: acceptable for the early use cases. The 25 ha re-cut stays as is.

## Code

- `packages/parcels`: engine (`cutParcels`), rules, starter generator, Gaia importer (Overpass JSON),
  admin-level lookup, GeoJSON/SVG export, CLI (`pnpm --filter @emerald-city/parcels generate <slug>`).
- `packages/core`: `City`, `Parcel`, `RealWorldLink`, tiers and pricing, membership layers.
- `apps/web`:
  - `/cities/[slug]` shows a launched city's parcels from HubID, or a starter preview. On a launched
    city it offers a claim panel (quote, then claim), and city admins can publish the starter layout.
  - `/p/[id]` lets the owner list a property (optionally through a broker), give it away, or link it
    to a real place (optional verification runs automatically). Visitors can buy it.
  - `/market` lists properties for sale. `/nearby` shows the worlds linked to where you're standing
    (the web version of the AR spheres).
  - All of it calls HubID's `feature/emerald-city-parcels` endpoints.

Engine note: JSTS (pure JavaScript) is fine for virtual cities and interactive editing (~1–2 s per
city). For building the Gaia layer at country scale, run the same rules in PostGIS/GEOS as a batch job.
