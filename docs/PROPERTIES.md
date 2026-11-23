# Properties: what members build, where, and how it's paid for

## One model, nested (holonic)

Every property is a HubID pavilion with a **brief**: what it is, what it's for, how it looks and the
services it offers. Properties nest: a property can sit inside a bigger place and hold smaller ones.

| Kind | Where it stands | Holds | Cost |
|---|---|---|---|
| **Lot** | a lot in Emerald City (the villa rows, the deluxe sites, the commercial boulevards) | rooms, zones | free with a catalogue design |
| **Gaia** | real land on an island with real geography (Davos, Bermuda, Ibiza, Kauai): one or more Gaia plots (H3 cells, `land-<h3>`) the member owns | rooms, zones, sub-properties on its plots | the Gaia plot price, plus the design |
| **Island** | a geolocated island of its own, which spawns its own archipelago (Andromeda) | properties of its own: lots, Gaia land, other members' properties | 5,000 Ven (always designed by Zeke) |

A design is either from the **catalogue** (free, ready-made) or **custom**: Zeke designs it from the
brief (200 Ven). Prices are settings (`PROPERTY_CUSTOM_PRICE_VEN`, `PROPERTY_ISLAND_PRICE_VEN`) and
are charged in Ven to Hub Culture's city treasury.

## The questionnaire (hubculture.city, Launch a property)

1. **Where:** a lot in Emerald City, a real place (pick the island, drop a pin, see the Gaia plot:
   free to buy, yours, or taken), or your own island.
2. **What:** home, commercial (shop, gallery, studio, office), hospitality (café or restaurant, hotel
   or stays, club or bar, event space), nature (garden, forest, reef, sanctuary, farm), or other.
3. **Design:** catalogue cards for that kind, or "Zeke designs it" (200 Ven).
4. **Describe it:** what it's for, floors, rooms, style, materials and nature, services it will offer
   (meetings, events, store, stays, exhibitions, classes, wellness, broadcasts, co-working), and
   who it's for, plus one public line visitors see.
5. **Review and pay.**

The brief is stored with the property (`property_briefs`). It drives three things:
- **the 3D world:** catalogue designs are placed on the property's lot or plot; custom briefs go to
  Zeke, who returns a building spec the 3D client builds (like the town and pavilions in Davos);
- **the property's services:** the services chosen switch on the matching functions (store,
  bookings, events, meetings, broadcasts) and tell the property's concierge agent what it offers;
- **Zeke's knowledge:** briefs go into the QEM, so Zeke knows what every place is for and can send
  people and agents to it.

## Gaia and DIRT fund the real places

On the real-geography islands the land is Gaia's and the territory is DIRT's:
- **Pick inside the boundaries.** The questionnaire shows Gaia parcel cells and the DIRT territory
  boundary on the island; members choose cells inside them.
- **Land is bought in Ven** through HubID's Gaia plot API (status, buy, list, transfer). A larger
  property buys several plots (all-or-nothing bulk buy is in review in HubID).
- **DIRT pays back into the place.** A share of plot sales and of design fees on a DIRT island goes
  to that territory (its `d<SYMBOL>` token on Ultra), funding the venue's restoration or community
  work. Holders of the territory token share in the island's growth.
- **Live venues:** Davos and Bermuda are built; Ibiza and Kauai are next as live DIRT venues.

## The store: more building types to buy

The catalogue grows into a store inventory. The building concepts live in the **virtual sections of
the online Hub stores**, next to everything else Hub sells: members and agents browse, shop for the
concepts they like in Ven, and the purchase lands on their property, with no design fee.

**Sources, in order:**
1. **Our own designs:** the Emerald City villas, the deluxe pavilions, the boulevard storefronts,
   the ICON and the AGENT (with the ICON family: Hub Host, Hub Pods, Hub Bio), and the Techlodge.
2. **Zeke's custom designs**, with the owner's consent, become new store items (the designer
   earns a share each time one is bought).
3. **Open-licensed building kits.** Only CC0 or CC-BY (never non-commercial or no-derivatives).
   Good places to look: Kenney's city and building kits, Quaternius' building packs, Poly Pizza's
   CC0 and CC-BY models, Sketchfab's downloadable CC0/CC-BY models, Smithsonian Open Access (CC0
   heritage scans), and ambientCG / Poly Haven for CC0 materials. Each one is checked at import.

**Import pipeline (one item at a time):** record the source URL, author and licence; reject anything
not CC0/CC-BY; convert to GLB with LODs (the existing asset pipeline); measure its footprint and
floors; tag it (kind, style, size, services it suits); keep the attribution with the item and show
it on the property page.

**Where they go:** the **Digital Intellectual Property** category of the Hub stores (category 47, e.g.
hubculture.com/store/antalya/category/47/, also in the Online store), which already sells Ven-priced
property listings, villa rentals and the Hub Culture Living items for Kauai and Ibiza. Building
concepts sit there as items, so the same store, basket, checkout and orders handle them. The Kauai
Oasis and Ibiza Living items link to those islands' venues once the worlds are built.

**Buying:** each concept is a store item in that category (price in Ven, images, footprint,
the asset). People buy in the store or from the questionnaire; agents buy within their owner's
instructions and limits (the same approval rules as trades). A bought concept appears in the
questionnaire's design step and on the property page, ready to place. Revenue: designer or curator share, the treasury, and on DIRT islands the territory.

## What's built and what's next

- Built: the catalogue images, the agent trade and Ven ledger groundwork, Davos with real streets.
- In progress: the questionnaire, briefs, Ven payments and Gaia plot purchase on hubculture.city.
- Next: placing catalogue designs on Emerald City lots (a lot inventory from the city's models),
  Zeke's building spec from a brief, the store inventory and import pipeline, DIRT boundaries on the
  questionnaire map, and Kauai and Ibiza.
