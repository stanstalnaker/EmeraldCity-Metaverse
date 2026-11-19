# The archipelago: worlds, land, DIRT, Ven and the agents that move between them

**Status (19 November 2026):** the linking contract (`packages/archipelago`) and the archipelago map
(`apps/web` `/archipelago`, `GET|POST /api/archipelago`) are built and tested against the real DIRT
register. The parts marked **Next** need changes in HubID, Gaia, Zeke or Ultra, listed at the end.

## The idea in one line

> **island** (a metaverse world) → **geolink** (lat/long) → **Gaia cell** (`MIP1|GAIA|CELL|{h3}`)
> → **DIRT territory** (one Solana token per real place, governed by its Hub)
> → **Ven market on Ultra** (`ud<SYMBOL>`) ← **agents**, acting under their owner's mandate,
> across Telegram, Hub messages, the metaverse, other agents and the web.

Every system already exists; what was missing is the shared contract between them. That contract is
deliberately small: **a place is an H3 cell**, the same one Gaia, DIRT, QEM and the sigils use.

## The rings

| Ring | What | Lives in | Key |
|---|---|---|---|
| Worlds | Islands you walk into: ready-built (Emerald City, Davos, Bermuda) or generated (worldgen specs) | this repo (`apps/city3d`, `packages/worldgen`) | island slug |
| Places | The real world, cut into cells and plots; layers of data on top (QEM, ven.vc, DIRT, members') | Gaia (`hub-culture/gaiaclub` `gaia-api`) | H3 cell, `MIP1\|GAIA\|CELL\|{h3}` |
| Territories | A real place with its own DIRT token, 1 DIRT per 28 sq ft, governed by a Hub (a HubID Pavilion) and its Propel | DIRT (`hub-culture/thisisdirt`), served by Gaia `/gaia/dirt/*` | symbol, H3 cover |
| Markets | Ven, DIRT pairs (`ud<SYMBOL>`), bonds, Ultra assets | HubID / Ultra | Ultra ticker |
| Identity | People, entities and agents (bot sub-profiles with a human owner) | HubID | HubID |

**How they connect:**
- **Island → place:** an island (or archipelago, or property) may be geolinked. That's a reference, not ownership, as in [PARCELS.md](PARCELS.md). Many worlds can link to one place.
- **Place → territory:** the cell is looked up in the DIRT cover (`indexTerritories().at(h3)`), at the territory's resolution: 9 for places up to ~420 km², 6 for larger ones like Ibiza and Kauai.
- **Territory → Hub:** each territory's governing Hub is a HubID **Pavilion**, and so is every Emerald City property. A territory's Hub is the natural anchor property of its island in the metaverse: where its Propel meets, its news shows on the screens, and its agents live.
- **Territory → market:** the same mint is listed on Ultra as `ud<SYMBOL>` against Ven, once the token is live, its Hub is confirmed and its Propel has ruled (`venMarket()`). Before that it trades on Raydium (DIRT/SOL), or not at all.

## Two ways in

1. **Explore Hub Culture's archipelago.** These islands are ready-built: Emerald City, Davos and Bermuda. Ibiza is generated from a spec on the first live DIRT territory. Davos sits inside `$DAVOS` (wave 1, not minted). Ibiza sits inside `$IBIZA` (live; its Hub needs confirming before `udIBIZA` opens). Bermuda and Emerald City sit in no territory yet.
2. **Generate your own (Andromeda).** Name it, give it a seed and pin it to a place (`generateArchipelago()`):
   - The first island takes the anchor's parcel cell, and the others take the neighbouring cells. Every island has its own Gaia address, and all of them resolve to the same territory and Hub.
   - Each island is a full worldgen city spec (style, size, districts, landmarks, palette), so the 3D client can build it.
   - The same seed always gives the same archipelago.
   - Today it is a preview. Saving needs the HubID cities work below.

Launching a property works the same in any island. The property is a Pavilion in that island's city, and it inherits the island's geolink unless the owner links it elsewhere. So a property in "Nova Terra" anchored in Ibiza shows up at Ibiza on the Gaia map and in AR (the anchor model in `packages/core/src/anchors.ts`). It also belongs to the IBIZA territory's economy.

## The agent loop

An agent is a HubID bot sub-profile with a human owner ([AGENTS.md](AGENTS.md)). Its channels all resolve to that one HubID:
- **Telegram:** works like Zeke's bot (`zeke-ai-server` `src/channels/telegram.py`). A Telegram account links to a HubID with a code emailed to the HubID's mailbox. Unlinked chats get public answers only.
- **Hub Culture messages:** signed in.
- **Metaverse:** present on an island (the presence server), seen with its mandala and its "agent" label.
- **Other agents:** `packages/agents` `CityAgent` requests.
- **The web:** fetching public data.

Each step is a typed action (`AgentAction`). Every action is checked against the owner's **mandate** before it happens (`authorize()`) and recorded after it (`AgentEvent`, `summarize()`):

| Step | Action | Scope | Earns |
|---|---|---|---|
| Talks with you on Telegram or in Hub messages | `converse` | `converse` + channel allowed | — |
| Goes into an island, opens a property, hosts, brokers | `world` | `world:act` (`property:broker` to broker: 1% of a brokered sale) | Ven (broker fee) |
| Agrees terms with another agent | `negotiate` | `agent:negotiate` | — |
| Does paid work for a member, a property or an agent | `service` | `ven:earn` | Ven |
| Pulls data from the web into a Gaia layer (QEM, a property's or city's layer) | `contribute` (cells + source) | `gaia:contribute` | DIRT of the territory those cells lie in, once Gaia accepts the layer |
| Buys or sells Ven, DIRT (`ud<SYMBOL>`), bonds on Ultra | `trade` | `ultra:trade` + market allowed | — |

**The mandate** is the owner's control:
- scopes and channels;
- Ven per day and per trade;
- an approval line: above it, the agent asks the owner first, in Telegram or Hub messages;
- which Ultra markets it may trade (`ud*` means every DIRT market);
- optionally, which islands it may act in.

Nothing outside the mandate happens. The owner sees the day's summary: actions, refusals, items awaiting approval, Ven earned and spent, DIRT by territory, channels used and islands visited.

**Earning DIRT for useful data** (`dirtRewards()`):
- **Splitting:** an accepted contribution's cells are split by the territory each lies in.
- **Live territories:** each pays `dirtPerCell`, capped per contribution, out of the territory's **25% Gaia bucket** (the DIRT split).
- **Not-yet-live territories:** the work is recorded and pays once the token is live.
- **Cells outside every territory:** they earn no DIRT, but still count as Gaia work, which can pay Ven.
- **Review:** member layers start private, and only Gaia admins publish them. Nothing pays before that review, so spam earns nothing.

### Example: a day for one agent

1. Its owner says on Telegram: "Find reef heat data around Ibiza and add it to the QEM layer". That's `converse`.
2. It fetches NOAA Coral Reef Watch data (`contribute`, with the source cited and covering 140 cells), and Gaia queues the layer for review.
3. It walks to the Ibiza island's Hub pavilion and offers a reef briefing to the agents there (`world`, then `negotiate`). A property's agent buys it for 12 Ven (`service`).
4. The layer is accepted: 140 cells in `$IBIZA` × 25 = 3,500 IBIZA DIRT, from the Gaia bucket.
5. It wants to buy more `udIBIZA` for 80 Ven. That's over the owner's 50 Ven line, so it asks on Telegram, and the owner taps yes (`trade`).
6. That evening the owner gets the summary: 12 Ven earned, 80 spent, 3,500 IBIZA, Telegram and the metaverse, island ibiza.

The same loop covers many other journeys: an agent brokering properties to other agents; one curating a city's events layer; one hosting visitors in Davos; one keeping a territory's map fresh from OpenStreetMap; and many more.

## What's built

- **`packages/archipelago`:**
  - geolinks and Gaia addresses;
  - the DIRT territory index;
  - Ven market states;
  - Hub Culture's islands;
  - Andromeda generation;
  - agent mandates, authorization, DIRT rewards and day summaries.
  - 13 tests run against the real register (`data/`, a public snapshot with attribution).
- **`apps/web` `/archipelago`:**
  - the map of DIRT territories (live in emerald, waves in violet) and the islands;
  - "Enter in 3D", "Launch a property" and Ven market state per island;
  - the DIRT register;
  - "Your own" archipelago generation.
  - `GET /api/archipelago` serves the same data to the 3D client, agents and gaia.club. `POST` is the Andromeda preview.

## Next (by system)

**HubID**
- **Cities:** save archipelagos and islands as HubID cities (`cities`, `parcels` in [PARCELS.md](PARCELS.md)), with `geolink_h3`, `archipelago` and the owner.
- **Agent tokens:** scoped agent tokens with the mandate's scopes and limits (AGENTS.md "HubID changes"). Add `gaia:contribute`, `ultra:trade` and `property:broker` to the Mandala `ScopeRegistry`.
- **Spend limits:** enforce per-day and per-trade Ven limits server-side on agent-initiated `ven:send`, Ultra purchase and sell; also enforce the approval line, with the request delivered by Hub message or Telegram.
- **Confirm DIRT Hubs:** `launchpad hub <slug> --confirm --propel <ref>`, so `udIBIZA` and `udKAUAI` can open.

**Gaia**
- **Attribution:** layer contributions record the contributing HubID (an agent's or a member's).
- **Rewards:** on acceptance, Gaia emits a reward event for each territory and cell count, paid from the territory's Gaia vault.
- **Islands:** add an `islands` layer (from `GET /api/archipelago`), so the metaverse appears on gaia.club alongside QEM, ven.vc and DIRT.

**Zeke / Telegram**
- **Agent bots:** agents get their own bots, or a shared bot that routes to them, with the same HubID link flow as `zekesi_bot`.
- **Approvals:** approval requests arrive as buttons in the owner's chat.

**3D client**
- **Generated islands:** build them from their spec (worldgen is already used for the Davos agents' town).
- **Portals:** a portal to each island in the archipelago.
- **Hub screens:** the territory's Hub pavilion shows its DIRT price, its Propel and its layers.

**DIRT**
- **Island cells:** `import-gaia` already turns Gaia land into DIRT candidates. Island geolinks could weight which places get proposed next: places with worlds, properties and agents.

## Decisions to make

1. **Geolinks on DIRT land:** may anyone's archipelago geolink inside a DIRT territory, or does the territory's Hub curate links? The default here follows PARCELS.md: links are open unless the land owner curates or charges rent. This is simple to change per territory.
2. **Reward rates:** the reward rate per cell and the per-contribution cap (default 25 DIRT per cell, capped at 25,000). They're paid from the territory's 25% Gaia bucket, so each territory's council could set its own.
3. **Agent holdings:** may agents hold DIRT on Solana directly, or only through Ultra custodial wallets? The default is Ultra only: agents never hold Solana keys.
