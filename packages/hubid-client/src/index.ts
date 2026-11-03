import {
  EMERALD_CITY_TERRITORY,
  toProperty,
  type HubEnvelope,
  type HubPage,
  type HubPavilion,
  type Property,
} from "@emerald-city/core";

/**
 * Typed client for the HubID API (hub/HubID hubid_api).
 *
 * SERVER-SIDE ONLY. HubID's Public-Key / Private-Key headers are app-wide
 * secrets; the legacy VR site shipped them to every browser. Browsers should
 * talk to apps/web route handlers, which use this client.
 */
export interface HubIdClientOptions {
  baseUrl: string;
  publicKey?: string;
  privateKey?: string;
  /** User JWT from `login()`; sent as `Authorization: Bearer`. */
  token?: string;
  fetch?: typeof fetch;
}

export class HubIdError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HubIdError";
  }
}

export interface ListPropertiesParams {
  territory?: string;
  title?: string;
  offset?: number;
  /** HubID caps this at 250. */
  limit?: number;
}

/** Fields for creating a property (HubID `POST /pavilions`). */
export interface NewPropertyInput {
  name: string;
  location: { lat: number; lng: number };
  isPrivate?: boolean;
  /** IANA zone, e.g. "Europe/London". */
  timezone?: string;
  territory?: string;
}

export interface PropertyPatch {
  name?: string;
  location?: { lat: number; lng: number };
  isPrivate?: boolean;
  visible?: boolean;
}

/** HubID validates most pavilion strings as 2–50 characters. */
export function validatePropertyName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2 || n.length > 50) return "Name must be 2–50 characters.";
  return null;
}

/** URL slug HubID uses as the pavilion's unique `url` (same rule as the legacy site's str_slug). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const coord = (n: number) => n.toFixed(6);

/** HubID Emerald City records (snake_case, as the API returns them). */
export interface HubCity {
  id: number;
  slug: string;
  name: string;
  kind: "gaia" | "virtual";
  owner_group_id: number;
  council_group_id: number | null;
  launch_policy: "open" | "approval" | "invite";
  ven_per_hectare: number | string;
  minimum_ven: number | string | null;
  rules_version: string;
}

export interface HubParcel {
  id: string;
  city_id: number;
  status: "free" | "claimed" | "public" | "reserved";
  reserved_reason: string | null;
  area_m2: number;
  tier: "core" | "urban" | "suburban" | "rural";
  geometry: [number, number][][];
  pavilion_id: number | null;
  link_mode: "open" | "curated" | "rent";
  link_rent_ven: number | string | null;
  price_ven: number | null;
  city_slug?: string | null;
}

export interface ClaimQuote {
  land_ven: number;
  extra_parcel_fee_ven: number;
  total_ven: number;
  parcels_held?: number;
  included_parcels?: number;
}

export interface HubListing {
  id: number;
  parcel_id: string;
  pavilion_id: number;
  seller_user_id: number;
  broker_user_id: number | null;
  price_ven: number | string;
  status: "active" | "sold" | "withdrawn";
  city_id?: number;
  area_m2?: number;
  tier?: string;
}

export interface HubAnchor {
  id: number;
  kind: "virtual-property" | "artifact";
  ref: string;
  city_id: number | null;
  lat: number | string;
  lng: number | string;
  address: string | null;
  gaia_parcel_id: string | null;
  status: "visible" | "pending" | "hidden";
  trust: "unverified" | "place" | "presence" | "resident" | "owner";
  badges: string[] | string | null;
  distance_m?: number;
}

export class HubIdClient {
  private readonly opts: HubIdClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HubIdClientOptions) {
    this.opts = { ...opts, baseUrl: opts.baseUrl.replace(/\/+$/, "") };
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** A copy of this client acting as a signed-in user. */
  withToken(token: string): HubIdClient {
    return new HubIdClient({ ...this.opts, token, fetch: this.fetchImpl });
  }

  /** POST /auth: exchange credentials for a 24h JWT. Requires the public key. */
  async login(email: string, password: string): Promise<{ token: string; userId: number }> {
    const data = await this.request<{ token: string; user_id: number }>("POST", "/auth", {
      key: "public",
      body: { email, password },
    });
    return { token: data.token, userId: Number(data.user_id) };
  }

  /** GET /v2/pavilions/list: public properties, one page. No key required. */
  async listPavilions(params: ListPropertiesParams = {}): Promise<HubPage<HubPavilion>> {
    const q = new URLSearchParams();
    q.set("territory", params.territory ?? EMERALD_CITY_TERRITORY);
    if (params.title) q.set("title", params.title);
    q.set("offset", String(params.offset ?? 0));
    q.set("limit", String(Math.min(params.limit ?? 100, 250)));
    return this.request<HubPage<HubPavilion>>("GET", `/v2/pavilions/list?${q}`);
  }

  /** All public properties in a territory, following pagination. */
  async listProperties(params: Omit<ListPropertiesParams, "offset" | "limit"> = {}): Promise<Property[]> {
    const out: Property[] = [];
    const limit = 250;
    for (let offset = 0; ; offset += limit) {
      const page = await this.listPavilions({ ...params, offset, limit });
      out.push(...page.items.map(toProperty));
      if (page.items.length < limit || out.length >= Number(page.total)) break;
    }
    return out;
  }

  /** GET /pavilions/{id}: a single public property. */
  async getProperty(id: number): Promise<Property> {
    return toProperty(await this.request<HubPavilion>("GET", `/pavilions/${encodeURIComponent(id)}`));
  }

  /** GET /pavilions: properties the signed-in user owns (directly or via sub-profiles). */
  async myPavilions(params: { territory?: string; offset?: number; limit?: number } = {}): Promise<HubPage<HubPavilion>> {
    const q = new URLSearchParams();
    q.set("territory", params.territory ?? EMERALD_CITY_TERRITORY);
    q.set("offset", String(params.offset ?? 0));
    q.set("limit", String(Math.min(params.limit ?? 50, 250)));
    return this.request<HubPage<HubPavilion>>("GET", `/pavilions?${q}`, { key: "private", auth: true });
  }

  async myProperties(territory?: string): Promise<Property[]> {
    return (await this.myPavilions({ territory, limit: 250 })).items.map(toProperty);
  }

  /** POST /pavilions: create a property owned by the signed-in user (via a new property bot sub-profile). */
  async createProperty(input: NewPropertyInput): Promise<Property> {
    const err = validatePropertyName(input.name);
    if (err) throw new Error(err);
    const name = input.name.trim();
    const url = slugify(name);
    if (url.length < 2) throw new Error("Name must contain at least two letters or digits.");
    const data = await this.request<{ pavilion: HubPavilion }>("POST", "/pavilions", {
      key: "private",
      auth: true,
      body: {
        name,
        localename: name,
        url,
        timezone: input.timezone || "UTC",
        latitude: coord(input.location.lat),
        longitude: coord(input.location.lng),
        // HubID requires an address; city properties have always used the territory name.
        address: input.territory ?? EMERALD_CITY_TERRITORY,
        territory: input.territory ?? EMERALD_CITY_TERRITORY,
        visible: true,
        is_private: Boolean(input.isPrivate),
      },
    });
    return toProperty(data.pavilion);
  }

  /** PUT /pavilions/{id}: update a property the signed-in user can manage. */
  async updateProperty(id: number, patch: PropertyPatch): Promise<void> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const err = validatePropertyName(patch.name);
      if (err) throw new Error(err);
      body.name = patch.name.trim();
      body.localename = patch.name.trim();
    }
    if (patch.location) {
      body.latitude = coord(patch.location.lat);
      body.longitude = coord(patch.location.lng);
    }
    if (patch.isPrivate !== undefined) body.is_private = patch.isPrivate;
    if (patch.visible !== undefined) body.visible = patch.visible;
    if (Object.keys(body).length === 0) return;
    await this.request("PUT", `/pavilions/${encodeURIComponent(id)}`, { key: "private", auth: true, body });
  }

  /** GET /user: the signed-in user's profile. */
  async getSelf<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("GET", "/user", { key: "private", auth: true });
  }

  // ---- Emerald City (HubID feature/emerald-city-parcels) ----

  async listCities(): Promise<HubCity[]> {
    return (await this.request<{ items: HubCity[] }>("GET", "/cities")).items;
  }

  /** A city, or null if HubID doesn't know it (e.g. a starter preview that hasn't launched). */
  async getCity(slug: string): Promise<HubCity | null> {
    try {
      return await this.request<HubCity>("GET", `/cities/${encodeURIComponent(slug)}`);
    } catch (err) {
      if (err instanceof HubIdError && err.status === 404) return null;
      throw err;
    }
  }

  async cityParcels(slug: string, opts: { limit?: number; offset?: number } = {}): Promise<{ total: number; items: HubParcel[] }> {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 2000), offset: String(opts.offset ?? 0) });
    return this.request("GET", `/cities/${encodeURIComponent(slug)}/parcels?${q}`);
  }

  async getParcel(id: string): Promise<HubParcel> {
    return this.request("GET", `/parcels/${encodeURIComponent(id)}`);
  }

  async quoteClaim(parcelId: string): Promise<ClaimQuote> {
    return this.request("GET", `/parcels/${encodeURIComponent(parcelId)}/quote`, { key: "private", auth: true });
  }

  async claimParcel(parcelId: string, pavilionId: number): Promise<ClaimQuote & { parcel_id: string; pavilion_id: number }> {
    return this.request("POST", `/parcels/${encodeURIComponent(parcelId)}/claim`, { key: "private", auth: true, body: { pavilion_id: pavilionId } });
  }

  async importParcels(slug: string, rulesVersion: string, parcels: unknown[]): Promise<{ created: number; updated: number; skippedClaimed: number; invalid: number }> {
    return this.request("POST", `/cities/${encodeURIComponent(slug)}/parcels/import`, { key: "private", auth: true, body: { rules_version: rulesVersion, parcels } });
  }

  async listings(params: { cityId?: number; pavilionId?: number } = {}): Promise<{ total: number; items: HubListing[] }> {
    const q = new URLSearchParams();
    if (params.cityId) q.set("city_id", String(params.cityId));
    if (params.pavilionId) q.set("pavilion_id", String(params.pavilionId));
    return this.request("GET", `/listings${q.size ? `?${q}` : ""}`);
  }

  async createListing(pavilionId: number, priceVen: number, brokerUserId?: number): Promise<HubListing> {
    return this.request("POST", `/properties/${pavilionId}/listings`, { key: "private", auth: true, body: { price_ven: priceVen, ...(brokerUserId ? { broker_user_id: brokerUserId } : {}) } });
  }

  async buyListing(listingId: number): Promise<{ listing_id: number; pavilion_id: number; price_ven: number; broker_fee_ven: number }> {
    return this.request("POST", `/listings/${listingId}/buy`, { key: "private", auth: true, body: {} });
  }

  async withdrawListing(listingId: number): Promise<void> {
    await this.request("DELETE", `/listings/${listingId}`, { key: "private", auth: true });
  }

  async transferProperty(pavilionId: number, toUserId: number): Promise<void> {
    await this.request("POST", `/properties/${pavilionId}/transfer`, { key: "private", auth: true, body: { to_user_id: toUserId } });
  }

  async anchorsNear(lat: number, lng: number, radiusM = 200): Promise<HubAnchor[]> {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radiusM) });
    return (await this.request<{ items: HubAnchor[] }>("GET", `/anchors/near?${q}`)).items;
  }

  async createAnchor(input: { pavilionId: number; lat: number; lng: number; address?: string }): Promise<HubAnchor & { needs_owner_approval: boolean; rent_ven: number }> {
    return this.request("POST", "/anchors", {
      key: "private",
      auth: true,
      body: { pavilion_id: input.pavilionId, lat: input.lat, lng: input.lng, ...(input.address ? { address: input.address } : {}) },
    });
  }

  async verifyAnchor(anchorId: number): Promise<{ badges: string[]; trust: string }> {
    return this.request("POST", `/anchors/${anchorId}/verify`, { key: "private", auth: true, body: {} });
  }

  /** GET /google-places: the signed-in user's Google Place check-ins (self-reported). */
  async getMyCheckIns(): Promise<{ googlePlaceId: string; createdAt?: string }[]> {
    const rows = await this.request<{ google_place_id: string; created_at?: string }[]>("GET", "/google-places", { key: "private", auth: true });
    return (rows ?? []).map((r) => ({ googlePlaceId: r.google_place_id, createdAt: r.created_at }));
  }

  /** GET /user/{id}: another user's profile. */
  async getUser<T = Record<string, unknown>>(userId: number): Promise<T> {
    return this.request<T>("GET", `/user/${encodeURIComponent(userId)}`, { key: "private", auth: true });
  }

  /** GET /friends: the signed-in user's friends. */
  async getFriends<T = Record<string, unknown>>(): Promise<T[]> {
    return this.request<T[]>("GET", "/friends", { key: "private", auth: true });
  }

  private async request<T>(
    method: string,
    path: string,
    o: { key?: "public" | "private"; auth?: boolean; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (o.key === "public") headers["Public-Key"] = required(this.opts.publicKey, "publicKey");
    if (o.key === "private") headers["Private-Key"] = required(this.opts.privateKey, "privateKey");
    if (o.auth) headers.Authorization = `Bearer ${required(this.opts.token, "token")}`;
    if (o.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(this.opts.baseUrl + path, {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new HubIdError(`HubID ${method} ${path}: non-JSON response`, res.status, text.slice(0, 500));
    }
    const env = json as HubEnvelope<T> | undefined;
    if (!res.ok || env?.status !== "success") {
      throw new HubIdError(`HubID ${method} ${path} failed (${res.status})`, res.status, env?.errors ?? json);
    }
    return env.data;
  }
}

function required(v: string | undefined, name: string): string {
  if (!v) throw new Error(`HubIdClient: ${name} is required for this call`);
  return v;
}

/** Build a client from the standard env vars (see .env.example). */
export function hubIdFromEnv(env: Record<string, string | undefined> = process.env): HubIdClient {
  return new HubIdClient({
    baseUrl: env.HUBID_API_URL ?? "https://id.hubculture.com",
    publicKey: env.HUBID_PUBLIC_KEY,
    privateKey: env.HUBID_PRIVATE_KEY,
  });
}
