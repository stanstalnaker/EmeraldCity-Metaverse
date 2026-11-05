# The existing Hub Culture metaverse: full study

**Purpose:** before rebuilding anything, map everything that exists today: its functions,
properties, places and technology. Then plan how to import and rebuild it, so that HubIDs and AI
agents can populate it.

**Ground rule:** the live hubculture.city, vr.hubculture.city and the meeting servers stay untouched.
The beta runs separately at beta.hubculture.city until it reaches parity and Hub Culture signs off.

**Sources:** a read-only review of the code in seven repos. The live sites could not be reached from
the review environment, and the code is from 2017–2021, so **the live estate may include things not
shown here.** Corrections are welcome.

Security findings are kept out of this public document and shared privately.

---

## 1. The estate at a glance

| Surface | What it is | Repo / tech | Last change |
|---|---|---|---|
| **hubculture.city** | Citizen web app: properties, conferences, events, account, Career Center | `hub-culture/emerald-city-laravel` (Laravel 5.8, Blade, jQuery) | 2021 |
| **vr.hubculture.city** | The 3D Emerald City in the browser and WebVR | `hub/vr-hubculture-city` (Babylon.js 4.1, Photon) | 2021 |
| **Emerald City Meet** | Self-hosted video conferencing with Emerald City branding | `hub-culture/emerald-city-meetings` (Jitsi Meet fork) on `meeting.`/`meeting3.hubculture.com` | 2020 |
| **Hub Culture VR (Steam)** | SteamVR headset app with the Bahamas and Davos worlds | `hub/VR-HubCulture` (Unity 2017.2, OpenVR) | 2018 |
| **WordPress hubculture.city** (earlier) | Earlier site; Voxeet rooms, City Plaza guest room | `hub-culture/emerald-city-web` (WordPress 5.4) | 2020 |
| **HubID** | Identity, properties (pavilions), friends, messages, VEN, store, events | `hub/HubID` (Laravel 5.0) | active |
| **hubculture.com** | Hubs (collaboration), store, account sections (embedded and linked) | `hub/Hub` (not reviewed here) | active |

---

## 2. hubculture.city: every function

### Identity and account
- **Sign-in and sign-up:** sign in with HubID (modal); sign up with name, email, password, mobile and T&Cs; forgot password; email-exists check; log out.
- **Header:** VEN balance badge, and an avatar menu (Account, My Properties, My Private Meetings, All Properties, Manage HubID, Launch Property, Community Events).
- **Manage HubID:** edit name, phone, zip, sex, about, address and company details. Deep links into hubculture.com sections: Avatar, Banking, Connections, Friends, Health, Invite, Mail, Membership, Profile, Security, Vault, Verification.

### Account dashboard
- **Hero:** Visit Emerald City VR, Launch Property, View Properties.
- **Stay connected:**
  - open broadcast (City Plaza room, `/c/city-plaza`)
  - Collaborate with Citizens (Emerald hub)
  - Attend a private conference
  - Telegram chat
  - Community Events
  - Calendar
- **Career Center ("Work to Do"):** 12 roles, each linking to an upgraded HubID membership in the Hub store:
  - Architects, Designers, Real Estate Agents, Planners, Artisans, Services
  - Teachers, Merchants, Influencers, Developers, Financial Services, Healthcare (tele-medicine)
- **Products:**
  - Hub Culture VR on Steam
  - **Virtual Pavilion** (store 1152): a built hectare with one year's maintenance, multiplayer VR, broadcast, livestream, chat, document sharing, and an Amazon restoration hectare with 500 trees
  - **Emerald City Bonds**: 1, 3 and 5 years at 3%, 5% and 7%

### Properties
- **Directory and my properties:** searchable, paginated cards.
- **Launch a property:**
  - name;
  - optional "linked to a physical location", set with a Google Maps pin;
  - "quarantine location" option;
  - creates the pavilion, its hub and a public conference channel straight away.
- **Property page:**
  - background image, and a welcome message the owner can edit;
  - public/private switch;
  - logo with crop; clicking the logo opens the property in VR at its spawn point;
  - admin list (add, remove);
  - **recordings** (from the meeting recording servers);
  - cards: public conference channel (`/c/{slug}`), Collaboration (the hubculture.com hub embedded) and Launch private conference;
  - **store items** with Buy Now on hubculture.com;
  - **events**: list, calendar, add, edit, delete;
  - **zones** (Meeting Room, Lobby, Terrace, Classroom, Garden).
- **Zone management:**
  - rename or delete;
  - **seats** (named people);
  - **media channels** (video URLs);
  - **files** (uploads).

  These feed the screens inside the 3D buildings.
- **Vanity links:** `/p/Cognizant`, `/p/BridgingTheGap`, `/p/TheChildrensHouseofWashington`, `/p/VailMontessori`, `/p/ATransformationStation`, `/p/100Secs`.

### Conferences and meetings
- **Private meeting:**
  - fields: participants (emails), title, date, start and end, timezone;
  - medium: Emerald City Conference Platform (Jitsi), or Zoom for Super Admins;
  - creates `.ics` calendar invites for participants and the organiser, plus an email;
  - listed under "My private meetings".
- **Conference room** (`/c/{slug}`):
  - guest gate (name and email), or sign in with HubID;
  - embedded Jitsi with HubID identity; moderator role for admins and the author;
  - iOS users are sent to the Hub Culture app;
  - live participants panel; for each person: **invite by email, send VEN, request VEN, add friend**;
  - thank-you page with a feedback form.
- **Meeting server selection:** JWT, room naming, aliases (e.g. plaza, cityplaza and emerald-city all go to the City Plaza room), and a recordings lookup.

### Events
- Upcoming events list, event detail with ticket link, a FullCalendar view, and per-property event creation (title, description, address, dates, timezone, image, ticket link).

### Content
- **Marketing pages:** Home, Overview, Access, Citizenship, Governance, Investment, Sustainability, Conference FAQ.
- **Pitch:**
  - a citizen-owned virtual city through HubID citizenship;
  - VEN currency, Propel governance and AGREE contracting;
  - event pavilions (Cannes, Davos, UNGA, COP26, Art Basel, Dubai Expo, Tokyo);
  - carbon-positive Amazon reforestation;
  - a phase-2 physical city.

---

## 3. vr.hubculture.city: the 3D Emerald City

- **Arrival:**
  - HubID login (photo and name become your avatar), or a guest name;
  - a deep link `?pavilion_id=` spawns you at 9 properties: 153 Emerald plaza, 157 Memorial, 167 Cognizant, 201 Beach, 209 BTG, 219 A-Transformation, 221 Wellness, 233 Children's House, 235 University;
  - a loading percentage while buildings stream in as you approach.
- **Content:** about **160 clickable screens** across 17 building models (about 1.5 GB of assets). Most are bound to HubID property zones: owners upload media and files on the property page, and they appear on the in-world screens. Others show links, YouTube, live meeting pages, or Hub Culture Radio.

| Place | What's there | Property |
|---|---|---|
| Plaza / terrain, City Hall | Walkable plaza, sculptures, City Hall monitors with the live plaza broadcast | 153 Emerald City |
| Arrival | **Teleport kiosk** (11 destinations), welcome screens | 153 |
| Information / Knowledge Hub | Screens for Ultra Exchange, AQUA, AIIA, Emerald City | 250 |
| Nightclub | Dance-floor screen, **Hub Culture Radio**, **Send VEN to the property** | 251 |
| Fashion Boulevard | 16 branded shops (Dior, Gucci, Tom Ford, YSL), two-floor lifts | — |
| A-Transformation Station / Memorial | Photo slideshow, live stream screen, domes, spatial ambient sound | 219 |
| Cognizant HQ | **3 flip-through magazines** (60+ pages each), a 4-floor lift, lobby and 8 meeting-room screens | 167 |
| Bridging The Gap (UN building) | About 30 screens and whiteboards, a welcome-garden video, a 2-floor lift | 209 |
| American University and University of Hawai'i | About 75 classroom screens, 13 classrooms, a garden, the Sky Pavilion, **click-to-sit seats**, a tower lift | 236, 235 |
| Children's House (Montessori) | Planetarium with sun and orbits, math and science boards | 233 |
| Underwater Wellness Centre | Underwater fog, jellyfish, a glowing pyramid, screens and video | 221 |
| High-rise, glass houses, amphitheatre, Lotus, beach, monument | Explore and teleport destinations | — |

- **Getting around:**
  - desktop (WASD and mouse), mobile joysticks, WebVR with floor teleport;
  - a fly/gravity toggle;
  - a full-screen map with about 14 teleport labels, and a compass bar.
- **Social:**
  - everyone shares one city instance (Photon);
  - avatars are spheres showing your HubID photo;
  - one-to-one chat with tabs; you can view another player's profile;
  - friends list with search;
  - send VEN to a player or a property.
- **Not present:** store checkout, VEN requests, games, an event schedule, help, voice, controller UI.

## 4. Hub Culture VR (Steam)
- **Worlds:**
  - **Bahamas island**: beach, pool, tennis court with a ball machine you can tune and a racket you can grab;
  - **Davos**: snow, and a ski game with poles and lean steering.

  A **portal** joins the two.
- **Zeke as tour guide:** greets you, asks you to log in, tours Connections, Pavilions, Messages, his Twitter wall, tennis and skiing, and can follow you.
- **In VR:** HubID login with a virtual keyboard; friends (search, requests, add, remove); message threads; the pavilion directory; VEN balance and **Send VEN**.
- **Not present:** multiplayer, voice, 3D avatars.

## 5. Emerald City Meet and the earlier WordPress site
- **Jitsi:** branded "Emerald City Meet" (watermark, background, FAQ link), with recording, livestreaming, shared video, etherpad and mute-everyone. The real server config lives outside the repo.
- **WordPress-only features:**
  - the open **City Plaza guest room**;
  - **Voxeet/Dolby** conference pages;
  - CMS-managed marketing and FAQ pages.

---

## 6. Parity checklist: existing vs beta

✅ in the beta · ◐ partial · ✗ missing · ★ new in the beta (not in the existing estate)

| Area | Existing function | Beta |
|---|---|---|
| Identity | HubID sign-in | ✅ |
| | Sign-up, forgot password, email check | ✗ |
| | VEN balance in header | ✗ |
| | Manage HubID profile and hubculture.com deep links | ✗ |
| Dashboard | Hero, Stay connected, Telegram, calendar links | ✗ |
| | Career Center (12 roles → store) | ◐ (roles exist as membership capabilities; no page) |
| | Virtual Pavilion product, Emerald City Bonds, Steam link | ✗ |
| Properties | Directory, my properties | ✅ (no search or pagination yet) |
| | Launch with a map pin | ✅ |
| | Quarantine option | ✗ |
| | Logo and background upload, welcome message | ✗ |
| | Public/private | ✅ |
| | Admin list | ✗ |
| | Recordings | ✗ |
| | Collaboration hub (embedded) | ✗ |
| | Store items | ✗ |
| | Events (list, calendar, create, edit, delete) | ✗ |
| | Zones, seats, media channels, files | ✗ |
| | Vanity links | ✗ |
| | Parcels, cities, claims, market, brokers, real-world links | ★ |
| Conferences | Private meetings (Jitsi or Zoom), `.ics` invites, email | ✗ |
| | Conference room with guest gate | ✗ |
| | Participants panel with invite, VEN send/request, add friend | ✗ |
| | Recordings, thank-you and feedback, City Plaza open room | ✗ |
| | LiveKit spatial voice in the 3D world | ★ |
| Content | Marketing pages, FAQ | ✗ |
| 3D city | All 17 buildings and their environments | ✗ (beta shows extruded parcel blocks only) |
| | ~160 screens bound to property zones | ✗ |
| | Spawn by property, teleport kiosk, map teleports, compass | ✗ |
| | Lifts, magazines, slideshow, radio, click-to-sit, planetarium, underwater wellness | ✗ |
| | Chat, profile viewer, friends, send VEN in-world | ✗ |
| | Multiplayer presence | ◐ (server-verified presence ★; no avatars in the 3D client yet) |
| | Desktop, mobile, VR movement | ◐ (WebXR ★; no first-person walking or mobile controls yet) |
| Steam worlds | Bahamas, Davos, ski, tennis, portals | ✗ |
| | Zeke tour guide | ◐ (Zeke concierge and help desk ★; no guided tour) |
| Agents | AI agents and robots living in the city | ★ (presence, agent-to-agent, Zeke host) |

The beta has a sound foundation for **new** things: verified presence, agents, Zeke, LiveKit,
parcels, cities and the market, HubID authorisation fixes, and deployment. **Almost none of the
existing citizen experience has been carried over yet.** That gap is the rebuild.

---

## 7. 3D technology: what the city runs on, and what's best now

**Today:** Babylon.js **4.1** (2020), loaded from vendored files.
- VR uses **WebVR**, which browsers have removed, so headset VR no longer works.
- Screens are web pages overlaid on top of the canvas (CSS3D iframes), which can't render inside a headset.
- Assets are uncompressed: about 175 MB before a visitor takes a step.

**The open web 3D landscape in November 2026** (versions checked against the npm registry):

| Option | Current | Strengths for Emerald City | Trade-offs |
|---|---|---|---|
| **Babylon.js** | **9.34** (one major release a year since 2019) | **Loads the existing `.babylon` buildings directly.** WebGPU with a WebGL2 fallback. WebXR built in. Havok physics. 3D GUI. Node materials. Gaussian-splat support. The Inspector for debugging. Microsoft-backed, and the same engine family the team already used. | Full-featured but heavier than three.js. Most code from 4.1 still needs rewriting (VR, GUI, camera), though the engine and assets carry over. |
| **three.js** | r187 (WebGPURenderer + TSL) | Biggest ecosystem: React Three Fiber, `three-vrm` avatars, Spark Gaussian splats. The beta's VR client uses it. | No path for the existing assets except glTF conversion. More assembly needed (physics, GUI, XR helpers). |
| **PlayCanvas** | 2.23 | A **collaborative online editor**, which suits partners and stakeholders building their own cities and properties. Strong Gaussian splats (SuperSplat). WebGPU. | Editor-centred workflow; the cloud editor is a hosted service. |
| **Gaussian splatting** (Babylon, Spark, PlayCanvas) | mature | **Photoreal captures of real places**, e.g. a phone or drone scan of a real pavilion dropped into the city, or linked to its real address. | Best for static captured scenes; mixes with normal 3D for interactive parts. |
| Unity 6 web export / Needle | — | Could revive the Steam worlds' Unity content for the web. | Unity 2017 projects need a major upgrade first; large web builds. |
| Unreal pixel streaming | — | Highest fidelity. | Cloud GPU per visitor: expensive, high latency, not open web. |

I couldn't evaluate the "gaming platforms Claude is building" without more detail.

**Recommendation:** rebuild the 3D city on **Babylon.js 9 with WebGPU** (falling back to WebGL2 automatically), and WebXR for headsets.
- It imports today's buildings without a rewrite of the art.
- It keeps the team's engine knowledge.
- It has the features the city needs: XR, physics, 3D GUI, splats.

Alongside it:
- **Asset pipeline:** convert the 17 `.babylon` models to glTF/GLB with meshopt compression, KTX2 textures and levels of detail, aiming for roughly 10–20× smaller downloads. Remove the source files from the public bundle.
- **Gaussian splats** for photoreal captures of real Hub Culture places (Davos, events) and for partners' showcase properties.
- **Screens rendered inside the world** (video textures and in-world document viewers), not overlaid web pages, so they work in a headset.
- **Optional editor:** PlayCanvas or a lightweight in-browser builder, for partners and stakeholders to lay out their own islands. Decide later.

The beta's current three.js client is only a parcel viewer. It would be replaced by the Babylon city client and its presence, parcels and agent code moved across. None of the beta's server-side work depends on the 3D engine.

---

## 8. Import and rebuild plan

Each phase runs on **beta.hubculture.city with a staging HubID**. Live users aren't affected.

**Phase 0: foundations**
- Set up the beta.hubculture.city infrastructure and a staging HubID.
- Merge the HubID authorisation fix and the Emerald City tables after review.
- Rotate the exposed credentials.

**Phase 1: import the city as data**
- Extract everything that is hardcoded in `demo3t.js` into a **world manifest** (JSON):
  - buildings (model, position, streaming radius);
  - every screen (mesh, type, property and zone binding, fallback link);
  - spawn points per property;
  - teleport kiosk and map destinations;
  - lifts and floors;
  - magazines, slideshows, seats, audio sources.
- The manifest becomes Emerald City's **street plan and parcels**: each building sits on the parcel(s) of its property (Cognizant, BTG, universities and so on). This connects the existing city to the new parcel and ownership model.

**Phase 2: rebuild the 3D client (Babylon 9)**
- Convert and compress the assets.
- Rebuild arrival, streaming, first-person, mobile and WebXR movement, the map, compass, kiosk and lifts.
- Rebuild all ~160 screens rendered in-world and fed live from HubID property zones.
- Rebuild the magazines, slideshow, radio, click-to-sit and the effects (underwater wellness, planetarium).
- Spawn by property, keeping the `?pavilion_id=` links working.

**Phase 3: people, agents and voice**
- Replace Photon with the beta's **presence server**, which verifies identity:
  - per-property rooms;
  - **3D avatars for HubIDs** (VRM, with the HubID photo as a fallback);
  - name tags;
  - agents clearly labelled.
- **LiveKit spatial voice** in place of overlaid Jitsi, plus stage mode for broadcasts; recordings feed the property recordings list.
- Bring in chat, the profile viewer, friends, and VEN send and request.
- **Populate with agents:**
  - Zeke as the arrival host and tour guide (reviving the Steam tour);
  - a concierge agent per property, using its zone content;
  - broker agents for the market;
  - agents asking Zeke for help.

  All are HubID sub-profiles with human owners.

**Phase 4: web parity (hubculture.city functions)**
Carry over every function in section 2:
- the dashboard and Career Center;
- product, bond and Steam cards;
- the full property page (logo, background, message, admins, recordings, collaboration hub, store, events, zones, seats, media, files);
- conferences (private meetings, invites, guest gate, participants panel, Zoom), with City Plaza moved to LiveKit;
- events and the calendar;
- marketing pages, sign-up and password reset;
- vanity links.

**Phase 5: beyond parity**
- Partner cities (islands) using the same manifest format.
- The Steam worlds (Bahamas and Davos) imported as worlds joined by portals.
- Gaussian-splat captures of real places linked to real-world anchors.
- AR nearby spheres.

**Switching hubculture.city over** is a separate decision after Phases 1–4 reach parity, with a
migration plan for live users, URLs and conference links.

---

## 9. Open questions for Hub Culture
1. **The live site vs the repos:** is anything live today that isn't in these repos (newer code, other servers, the hubculture.com side)? Read access to the live sites, or a walkthrough, would close the gap.
2. **The 3D engine:** confirm Babylon.js 9 as the direction. And which "Claude gaming platforms" did you mean, so I can compare them?
3. **Steam worlds:** bring Bahamas and Davos into the web city (as portal worlds), or retire them?
4. **Conferencing:** keep the Jitsi servers for meetings during the rebuild and move in-world voice to LiveKit, or plan a full move?
5. **Branded content** (Dior, Gucci, Tom Ford, YSL, UN, the universities, Cognizant): are those partnerships current, and can the assets be reused?
6. **Hosting** for beta.hubculture.city, and a staging HubID.
