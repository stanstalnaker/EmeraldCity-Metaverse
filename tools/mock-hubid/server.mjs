/**
 * Mock HubID for local demos (`pnpm demo`). In-memory, resets on restart. NOT for production.
 *
 * Accounts (password "demo"):  stan@demo.hub (Patron, owns two properties)  ·  ana@demo.hub (Personal Basic)
 * Emerald City is launched as a virtual city with no parcels yet: sign in as Stan, open
 * /cities/emerald-city and click "Publish starter layout".
 *
 * Implements the HubID endpoints the beta site uses, including the Emerald City branch
 * (cities, parcels, claims, listings, transfers, anchors). Rules mirror docs/PARCELS.md.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_HUBID_PORT ?? 4900);
const TOKENS = { "jwt-stan": 7, "jwt-ana": 8 };
const users = {
  7: { id: 7, first: "Stan", last: "Stalnaker", memberships: ["Patron", "Real Estate Agents"] },
  8: { id: 8, first: "Ana", last: "Rivera", memberships: ["Personal Basic"] },
  39: { id: 39, first: "Zeke", last: "", memberships: ["Zeke"] }, // Hub Culture treasury
  900: { id: 900, first: "Listing", last: "Bot", memberships: [] },
};
/** Zeke's account is the Hub Culture treasury: Hub Culture's land sales and extra-parcel fees settle here. */
const ZEKE_TREASURY = 39;
const LOGINS = { "stan@demo.hub": "jwt-stan", "ana@demo.hub": "jwt-ana" };
const ven = { 39: 0, 7: 1000, 8: 1000, 900: 0 };
let nextPavilionId = 1002;
const pavilions = new Map([
  [1000, { id: 1000, group: 1, name: "Hub Culture Davos", owner: 7, visible: 1, is_private: false, latitude: "46.8027", longitude: "9.8360", url: "hub-culture-davos", territory: "Emerald City", image: null, message: "The Davos pavilion, now in Emerald City.", parcel_id: null, city_id: null }],
  [1001, { id: 1001, group: 2, name: "Stan's Studio", owner: 7, visible: 1, is_private: false, latitude: "51.5074", longitude: "-0.1278", url: "stans-studio", territory: "Emerald City", image: null, message: "", parcel_id: null, city_id: null }],
]);
const cities = new Map([
  ["emerald-city", { id: 1, slug: "emerald-city", name: "Emerald City", kind: "virtual", owner_group_id: 5, council_group_id: null, launch_policy: "open", ven_per_hectare: "10.00", minimum_ven: "5.00", rules_version: "2026.11-1" }],
]);
const parcels = new Map();
const listings = [];
const anchors = [];

const send = (res, code, payload) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(payload));
};
const ok = (res, data, code = 200) => send(res, code, { status: "success", errors: [], data, code, time: Math.floor(Date.now() / 1000) });
const fail = (res, code, msg) => send(res, code, { status: "error", errors: [msg], data: null, code, time: Math.floor(Date.now() / 1000) });
const view = (p) => ({ ...p, created_by_user: { id: 5000 + p.id } });
const landPrice = (p, city) => Math.max(Math.round((p.area_m2 / 10000) * Number(city.ven_per_hectare) * 100) / 100, Number(city.minimum_ven ?? 0));
const cityById = (id) => [...cities.values()].find((c) => c.id === id);
const held = (uid) => [...parcels.values()].filter((p) => p.status === "claimed" && p.claimed_by === uid).length;
const pay = (from, to, amount) => {
  if ((ven[from] ?? 0) < amount) return false;
  ven[from] -= amount;
  ven[to] = Math.round(((ven[to] ?? 0) + amount) * 100) / 100;
  ven[from] = Math.round(ven[from] * 100) / 100;
  return true;
};

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    let b = {};
    try { b = body ? JSON.parse(body) : {}; } catch { return fail(res, 400, "invalid json"); }
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const m = req.method;
    const uid = TOKENS[(req.headers.authorization ?? "").replace("Bearer ", "")];
    const me = uid ? users[uid] : null;
    let r;

    if (path === "/style.json") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dfe9e4" } }] }));
    }
    if (path === "/__ven") return ok(res, ven);

    // Auth and profiles
    if (m === "POST" && path === "/auth") {
      const t = LOGINS[String(b.email ?? "").toLowerCase()];
      return t && b.password === "demo" ? ok(res, { token: t, user_id: TOKENS[t] }) : fail(res, 401, "invalid_credentials");
    }
    if (path === "/user") return me ? ok(res, { ...me, balance: ven[me.id] }) : fail(res, 401, "token_invalid");
    if (path === "/google-places") return me ? ok(res, []) : fail(res, 401, "token_invalid");

    // Pavilions (properties)
    if (path === "/v2/pavilions/list") {
      const items = [...pavilions.values()].filter((p) => !p.is_private).map(view);
      return ok(res, { offset: 0, limit: 250, total: items.length, count: items.length, items });
    }
    if (path === "/pavilions" && m === "GET") {
      if (!me) return fail(res, 401, "token_invalid");
      const items = [...pavilions.values()].filter((p) => p.owner === me.id).map(view);
      return ok(res, { offset: 0, limit: 250, total: items.length, items });
    }
    if (path === "/pavilions" && m === "POST") {
      if (!me) return fail(res, 401, "token_invalid");
      if ([...pavilions.values()].some((p) => p.url === b.url)) return fail(res, 422, `A pavilion with the given url (${b.url}) exists!`);
      const p = { id: nextPavilionId++, group: nextPavilionId, name: b.name, owner: me.id, visible: 1, is_private: !!b.is_private, latitude: b.latitude, longitude: b.longitude, url: b.url, territory: b.territory, image: null, message: "", parcel_id: null, city_id: null };
      pavilions.set(p.id, p);
      return ok(res, { success: true, pavilion: view(p) });
    }
    if ((r = path.match(/^\/pavilions\/(\d+)$/))) {
      const p = pavilions.get(Number(r[1]));
      if (!p) return fail(res, 404, "Pavilion not exist");
      if (m === "GET") return p.is_private ? fail(res, 404, "Pavilion not exist") : ok(res, view(p));
      if (m === "PUT") {
        if (!me || p.owner !== me.id) return fail(res, 401, "You do not have permission to make changes to this pavilion");
        for (const k of ["name", "latitude", "longitude"]) if (b[k] !== undefined) p[k] = b[k];
        if (b.is_private !== undefined) p.is_private = !!b.is_private;
        return ok(res, view(p), 201);
      }
    }

    // Emerald City: cities and parcels
    if (path === "/cities" && m === "GET") return ok(res, { items: [...cities.values()] });
    if ((r = path.match(/^\/cities\/([a-z0-9-]+)$/)) && m === "GET") return cities.has(r[1]) ? ok(res, cities.get(r[1])) : fail(res, 404, "City not found");
    if ((r = path.match(/^\/cities\/([a-z0-9-]+)\/parcels$/)) && m === "GET") {
      const city = cities.get(r[1]);
      if (!city) return fail(res, 404, "City not found");
      const items = [...parcels.values()].filter((p) => p.city_id === city.id).map((p) => ({ ...p, price_ven: p.status === "free" ? landPrice(p, city) : null }));
      return ok(res, { total: items.length, offset: 0, limit: 2000, items });
    }
    if ((r = path.match(/^\/cities\/([a-z0-9-]+)\/parcels\/import$/)) && m === "POST") {
      const city = cities.get(r[1]);
      if (!me) return fail(res, 401, "Authentication required");
      if (me.id !== 7) return fail(res, 403, "Only city administrators can import parcels");
      let created = 0, skippedClaimed = 0;
      for (const p of b.parcels ?? []) {
        const existing = parcels.get(p.id);
        if (existing?.status === "claimed") { skippedClaimed++; continue; }
        parcels.set(p.id, { ...p, city_id: city.id, pavilion_id: null, claimed_by: null, link_mode: "open", link_rent_ven: null });
        created++;
      }
      return ok(res, { created, updated: 0, skippedClaimed, invalid: 0 }, 201);
    }
    if ((r = path.match(/^\/parcels\/(p_[a-z0-9]+)$/)) && m === "GET") {
      const p = parcels.get(r[1]);
      if (!p) return fail(res, 404, "Parcel not found");
      const city = cityById(p.city_id);
      return ok(res, { ...p, city_slug: city?.slug, price_ven: p.status === "free" ? landPrice(p, city) : null });
    }
    if ((r = path.match(/^\/parcels\/(p_[a-z0-9]+)\/quote$/))) {
      if (!me) return fail(res, 401, "Authentication required");
      const p = parcels.get(r[1]);
      if (!p) return fail(res, 404, "Parcel not found");
      const land = landPrice(p, cityById(p.city_id));
      const h = held(me.id);
      const extra = h >= 3 ? 10 : 0;
      return ok(res, { land_ven: land, extra_parcel_fee_ven: extra, total_ven: Math.round((land + extra) * 100) / 100, parcels_held: h, included_parcels: 3 });
    }
    if ((r = path.match(/^\/parcels\/(p_[a-z0-9]+)\/claim$/)) && m === "POST") {
      if (!me) return fail(res, 401, "Authentication required");
      const p = parcels.get(r[1]);
      const pav = pavilions.get(Number(b.pavilion_id));
      if (!p) return fail(res, 404, "Parcel not found");
      if (p.status !== "free") return fail(res, 409, "This parcel is no longer free");
      if (!pav || pav.owner !== me.id) return fail(res, 403, "Only the property owner can place it on a parcel");
      if (pav.parcel_id) return fail(res, 422, "This property already sits on a parcel");
      const land = landPrice(p, cityById(p.city_id));
      const extra = held(me.id) >= 3 ? 10 : 0;
      if ((ven[me.id] ?? 0) < land + extra) return fail(res, 402, "Not enough VEN for this parcel");
      // Demo: Emerald City's land price and the extra-parcel fee both settle to Zeke (the partner payout comes later).
      pay(me.id, ZEKE_TREASURY, land + extra);
      Object.assign(p, { status: "claimed", pavilion_id: pav.id, claimed_by: me.id });
      Object.assign(pav, { parcel_id: p.id, city_id: p.city_id });
      return ok(res, { parcel_id: p.id, pavilion_id: pav.id, land_ven: land, extra_parcel_fee_ven: extra, total_ven: land + extra }, 201);
    }

    // Market
    if (path === "/listings" && m === "GET") {
      let items = listings.filter((l) => l.status === "active");
      const pid = url.searchParams.get("pavilion_id");
      if (pid) items = items.filter((l) => l.pavilion_id === Number(pid));
      return ok(res, { total: items.length, items: items.map((l) => ({ ...l, area_m2: parcels.get(l.parcel_id)?.area_m2, tier: parcels.get(l.parcel_id)?.tier })) });
    }
    if ((r = path.match(/^\/properties\/(\d+)\/listings$/)) && m === "POST") {
      const pav = pavilions.get(Number(r[1]));
      if (!me || !pav || pav.owner !== me.id) return fail(res, 403, "Only the property owner can do this");
      if (!pav.parcel_id) return fail(res, 422, "This property is not on a parcel yet");
      if (b.broker_user_id && !users[b.broker_user_id]) return fail(res, 422, "Brokers must be Real Estate Agents or AI agents owned by a HubID member");
      const l = { id: listings.length + 1, parcel_id: pav.parcel_id, pavilion_id: pav.id, seller_user_id: me.id, broker_user_id: b.broker_user_id ?? null, price_ven: Number(b.price_ven), status: "active" };
      listings.push(l);
      return ok(res, l, 201);
    }
    if ((r = path.match(/^\/listings\/(\d+)\/buy$/)) && m === "POST") {
      const l = listings[Number(r[1]) - 1];
      if (!me) return fail(res, 401, "Authentication required");
      if (!l || l.status !== "active") return fail(res, 404, "Listing not available");
      if (l.seller_user_id === me.id) return fail(res, 422, "You cannot buy your own listing");
      const fee = l.broker_user_id ? Math.round(l.price_ven * 0.01 * 100) / 100 : 0;
      if ((ven[me.id] ?? 0) < l.price_ven) return fail(res, 402, "Not enough VEN to buy this property");
      pay(me.id, l.seller_user_id, l.price_ven - fee);
      if (fee) pay(me.id, l.broker_user_id, fee);
      pavilions.get(l.pavilion_id).owner = me.id;
      parcels.get(l.parcel_id).claimed_by = me.id;
      l.status = "sold";
      return ok(res, { listing_id: l.id, pavilion_id: l.pavilion_id, price_ven: l.price_ven, broker_fee_ven: fee, seller_receives_ven: l.price_ven - fee }, 201);
    }
    if ((r = path.match(/^\/listings\/(\d+)$/)) && m === "DELETE") {
      const l = listings[Number(r[1]) - 1];
      if (!me || !l || l.seller_user_id !== me.id) return fail(res, 403, "Only the seller can withdraw this listing");
      l.status = "withdrawn";
      return ok(res, []);
    }
    if ((r = path.match(/^\/properties\/(\d+)\/transfer$/)) && m === "POST") {
      const pav = pavilions.get(Number(r[1]));
      if (!me || !pav || pav.owner !== me.id) return fail(res, 403, "Only the property owner can do this");
      if (!users[b.to_user_id]) return fail(res, 404, "Recipient does not exist");
      pav.owner = Number(b.to_user_id);
      if (pav.parcel_id) parcels.get(pav.parcel_id).claimed_by = pav.owner;
      return ok(res, { pavilion_id: pav.id, to_user_id: pav.owner, kind: "p2p" }, 201);
    }

    // Real-world anchors
    if (path === "/anchors" && m === "POST") {
      const pav = pavilions.get(Number(b.pavilion_id));
      if (!me || !pav || pav.owner !== me.id) return fail(res, 403, "Only the property owner can link it to a real place");
      const a = { id: anchors.length + 1, kind: "virtual-property", ref: String(pav.id), city_id: pav.city_id, lat: Number(b.lat), lng: Number(b.lng), address: b.address ?? null, gaia_parcel_id: null, status: "visible", trust: "unverified", badges: null, created_by: me.id };
      anchors.push(a);
      return ok(res, { ...a, needs_owner_approval: false, rent_ven: 0 }, 201);
    }
    if ((r = path.match(/^\/anchors\/(\d+)\/verify$/)) && m === "POST") {
      const a = anchors[Number(r[1]) - 1];
      if (!a) return fail(res, 404, "Anchor not found");
      // Demo: treat any link with an address as a Google-matched real place.
      a.trust = a.address ? "place" : "unverified";
      a.badges = a.address ? "real-place" : null;
      return ok(res, { badges: a.badges ? [a.badges] : [], trust: a.trust, place: null });
    }
    if (path === "/anchors/near") {
      const lat = Number(url.searchParams.get("lat"));
      const lng = Number(url.searchParams.get("lng"));
      const radius = Number(url.searchParams.get("radius") ?? 200);
      const items = anchors
        .filter((a) => a.status === "visible")
        .map((a) => {
          const dLat = (a.lat - lat) * 110540;
          const dLng = (a.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
          return { ...a, badges: a.badges ? a.badges.split(",") : [], distance_m: Math.round(Math.hypot(dLat, dLng) * 10) / 10 };
        })
        .filter((a) => a.distance_m <= radius)
        .sort((x, y) => x.distance_m - y.distance_m);
      return ok(res, { items });
    }

    fail(res, 404, `mock HubID: no route for ${m} ${path}`);
  })
  .listen(PORT, () => console.log(`mock HubID on http://localhost:${PORT}  (stan@demo.hub / ana@demo.hub, password "demo")`));
