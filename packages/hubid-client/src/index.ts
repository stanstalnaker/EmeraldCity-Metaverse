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

  /** GET /user: the signed-in user's profile. */
  async getSelf<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("GET", "/user", { key: "private", auth: true });
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
