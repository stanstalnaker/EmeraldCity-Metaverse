/**
 * Island → plot: the Gaia plot under a geolink.
 *
 * Plot ownership, buying and money live in Gaia (gaia.club, gaia-api) and Ven, never here. This
 * module only asks gaia-api which plot sits at a point (`GET {GAIA_API_URL}/plots/at?lat=&lng=`,
 * gaia-api's `/gaia/plots/at`) and turns the answer into something to show, with a link out to
 * gaia.club to buy it when it's free. It never says who owns a plot: only whitelisted plot
 * properties pass through `sanitizePlotAt()`.
 */
// No imports: this file also runs in the browser (`@emerald-city/archipelago/plots`), so it stays free of h3-js and worldgen.

export type PlotStatus = "free" | "owned" | "for_sale" | "reserved" | "unknown";
export type PlotKind = "land" | "ocean";

export interface PlotProperties {
  /** `land-…` or `ocean-…`. Missing on an ocean cell that can't be bought. */
  id?: string;
  kind?: PlotKind;
  area_m2?: number;
  price_ven?: number;
  status?: PlotStatus;
  /** When it's for sale. */
  listing?: { price_ven?: number } | null;
  /** Land plots. */
  tier?: string | number;
  region?: string;
  /** Ocean plots. */
  seller?: string;
  buyable?: boolean;
  /** Why an ocean cell can't be bought. */
  reason?: string;
  h3?: string;
}

export interface PlotFeature {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: PlotProperties;
}

export interface PlotAt {
  /** `pending`: the land around there is being cut into plots for the first time. */
  found: "plot" | "pending" | "none";
  plot: PlotFeature | null;
  buyable: boolean;
  /** gaia.club `/account?plot=<id>`. */
  buy_url?: string;
  retry_after_secs?: number | null;
  where: { lat: number; lng: number; cell: string; address: string };
}

/**
 * A lookup's outcome. `not-live`: gaia-api answered 404, so its plots/at route isn't deployed yet.
 */
export type PlotLookup =
  | { state: "ok"; at: PlotAt }
  | { state: "not-live" }
  | { state: "error"; message: string };

export interface PlotAtOptions {
  fetch?: typeof fetch;
  /** Default 5 s. */
  timeoutMs?: number;
  /** Extra fetch options (Next's `next: { revalidate }`, for one). */
  init?: RequestInit;
}

/** Validate a lat/lng pair from a query string. Both are required; empty strings don't count as 0. */
export function parseLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const a = num(lat), b = num(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  // ~10 cm: plenty for a plot, and it keeps cache keys short.
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

/** The plot at a point, from gaia-api (`apiBase` like `https://gaia.club/api/gaia`) or this app's `/api` proxy. */
export async function plotAt(apiBase: string, lat: number, lng: number, opts: PlotAtOptions = {}): Promise<PlotLookup> {
  const p = parseLatLng(lat, lng);
  if (!p) return { state: "error", message: "Not a place on Earth." };
  const url = `${apiBase.replace(/\/+$/, "")}/plots/at?lat=${p.lat}&lng=${p.lng}`;
  const f = opts.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(url, { ...opts.init, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { state: "error", message: timedOut ? "Gaia took too long to answer." : "Couldn't reach Gaia." };
  }
  if (r.status === 404) return { state: "not-live" };
  if (!r.ok) return { state: "error", message: `Gaia answered ${r.status}.` };
  try {
    const at = sanitizePlotAt(await r.json());
    return at ? { state: "ok", at } : { state: "error", message: "Gaia's answer wasn't a plot lookup." };
  } catch {
    return { state: "error", message: "Gaia's answer wasn't JSON." };
  }
}

const STATUSES: PlotStatus[] = ["free", "owned", "for_sale", "reserved", "unknown"];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Only https links on gaia.club (or a subdomain) are followed. */
export function isGaiaUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === "gaia.club" || x.hostname.endsWith(".gaia.club"));
  } catch {
    return false;
  }
}

/**
 * Keep the contract's fields and drop everything else, so owner details (and anything gaia-api adds
 * later) never pass through this app. Returns null if it isn't a plots/at answer.
 */
export function sanitizePlotAt(raw: unknown): PlotAt | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const found = o.found === "plot" || o.found === "pending" || o.found === "none" ? o.found : null;
  const w = o.where as Record<string, unknown> | undefined;
  if (!found || !w || fin(w.lat) === undefined || fin(w.lng) === undefined) return null;
  let plot: PlotFeature | null = null;
  const f = o.plot as { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> } | null | undefined;
  if (found === "plot" && f && typeof f === "object" && f.properties && typeof f.properties === "object") {
    const q = f.properties;
    const listing = q.listing as Record<string, unknown> | null | undefined;
    // An ocean cell that can't be bought carries its id on the Feature only.
    const id = str(q.id) ?? str(f.id);
    const props: PlotProperties = {
      id,
      kind: q.kind === "land" || q.kind === "ocean" ? q.kind : id?.startsWith("ocean-") ? "ocean" : id?.startsWith("land-") ? "land" : undefined,
      area_m2: fin(q.area_m2),
      price_ven: fin(q.price_ven),
      status: STATUSES.includes(q.status as PlotStatus) ? (q.status as PlotStatus) : q.status === undefined ? undefined : "unknown",
      listing: listing && typeof listing === "object" ? { price_ven: fin(listing.price_ven) } : null,
      tier: typeof q.tier === "string" || typeof q.tier === "number" ? q.tier : undefined,
      region: str(q.region),
      seller: str(q.seller),
      buyable: typeof q.buyable === "boolean" ? q.buyable : undefined,
      reason: str(q.reason),
      h3: str(q.h3),
    };
    for (const k of Object.keys(props) as (keyof PlotProperties)[]) if (props[k] === undefined) delete props[k];
    const g = f.geometry as { type?: unknown; coordinates?: unknown } | null | undefined;
    plot = {
      type: "Feature",
      ...(props.id ? { id: props.id } : {}),
      geometry: g && typeof g.type === "string" ? { type: g.type, coordinates: g.coordinates } : null,
      properties: props,
    };
  }
  const cell = str(w.cell) ?? "";
  return {
    found,
    plot,
    buyable: o.buyable === true,
    ...(isGaiaUrl(o.buy_url) ? { buy_url: o.buy_url } : {}),
    ...(fin(o.retry_after_secs) !== undefined ? { retry_after_secs: fin(o.retry_after_secs) } : {}),
    where: { lat: fin(w.lat)!, lng: fin(w.lng)!, cell, address: str(w.address) ?? (/^[0-9a-f]{15}$/.test(cell) ? `MIP1|GAIA|CELL|${cell}` : "") },
  };
}

// ---------------------------------------------------------------------------------------------
// What to show.

export type PlotTone = "free" | "listed" | "owned" | "reserved" | "pending" | "none" | "closed" | "unknown" | "not-live" | "error";

export interface PlotView {
  tone: PlotTone;
  /** The plot's status in plain words. */
  status: string;
  id?: string;
  kind?: PlotKind;
  /** "Land plot" / "Ocean plot". */
  kindLabel?: string;
  /** "1.2 ha", "850 m²". */
  size?: string;
  /** "120 Ven": the asking price (the listing's, when listed). */
  price?: string;
  /** Land: tier and region. Ocean: why it can't be bought. */
  detail?: string;
  /** Free ocean plots: where the money goes. */
  commons?: string;
  /** Only when it's free and Gaia says it can be bought: open in a new tab. */
  buy?: { url: string; label: string };
  /** Listed plots: see the listing on gaia.club. */
  listing?: { url: string; label: string };
  /** Pending: ask again after this long. */
  retryAfterSecs?: number;
}

export const OCEAN_COMMONS = "100% of ocean plot sales go to the Ocean Climate Fund";

export function formatVen(n: number): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} Ven`;
}

export function formatArea(m2: number): string {
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString("en-US")} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} ha`;
  return `${(m2 / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} km²`;
}

/** Turn a lookup into what an island card, a launch or the map shows. Never names an owner. */
export function plotView(l: PlotLookup): PlotView {
  if (l.state === "not-live") return { tone: "not-live", status: "Plot lookup isn't live yet" };
  if (l.state === "error") return { tone: "error", status: "Couldn't look up the plot" };
  const at = l.at;
  if (at.found === "pending") return { tone: "pending", status: "Being mapped", detail: "This land is being cut into plots for the first time.", retryAfterSecs: at.retry_after_secs ?? 20 };
  if (at.found === "none" || !at.plot) return { tone: "none", status: "No plot here yet" };

  const p = at.plot.properties;
  const kind = p.kind;
  const base: Omit<PlotView, "tone" | "status"> = {
    ...(p.id ? { id: p.id } : {}),
    ...(kind ? { kind, kindLabel: kind === "ocean" ? "Ocean plot" : "Land plot" } : {}),
    ...(p.area_m2 !== undefined ? { size: formatArea(p.area_m2) } : {}),
  };
  if (p.buyable === false) {
    return { ...base, tone: "closed", status: "Not for sale", ...(p.reason ? { detail: p.reason } : {}) };
  }
  const detail = kind === "land" ? [p.tier !== undefined ? `Tier ${p.tier}` : null, p.region].filter(Boolean).join(" · ") || undefined : undefined;
  const asked = p.price_ven !== undefined ? formatVen(p.price_ven) : undefined;
  const v = { ...base, ...(asked ? { price: asked } : {}), ...(detail ? { detail } : {}) };

  switch (p.status) {
    case "free": {
      const canBuy = at.buyable && at.buy_url !== undefined;
      return {
        ...v,
        tone: "free",
        status: canBuy ? `Free: buy on gaia.club${asked ? ` for ${asked}` : ""}` : "Free",
        ...(kind === "ocean" ? { commons: OCEAN_COMMONS } : {}),
        ...(canBuy ? { buy: { url: at.buy_url!, label: "Buy this plot" } } : {}),
      };
    }
    case "for_sale": {
      const price = p.listing?.price_ven ?? p.price_ven;
      return {
        ...v,
        ...(price !== undefined ? { price: formatVen(price) } : {}),
        tone: "listed",
        status: price !== undefined ? `Listed for ${formatVen(price)}` : "Listed for sale",
        ...(at.buy_url ? { listing: { url: at.buy_url, label: "See the listing" } } : {}),
      };
    }
    case "owned":
      return { ...v, tone: "owned", status: "Owned: links are open" };
    case "reserved":
      return { ...v, tone: "reserved", status: "Being bought" };
    default:
      return { ...v, tone: "unknown", status: "Status unknown" };
  }
}

// ---------------------------------------------------------------------------------------------
// Launches: a property launched on an island records the plot it sits on.

/**
 * The hubculture.city launch link for an island: `city`, `lat`, `lng`, plus `geolink` (the
 * island's resolution-9 H3 cell) and `gaia_plot` (the Gaia plot id under it, once looked up).
 * See docs/ARCHIPELAGO.md "Island → plot".
 */
export function launchLink(base: string, o: { city: string; geolink?: { lat: number; lng: number; h3: string }; plotId?: string }): string {
  const u = new URL(base);
  u.searchParams.set("city", o.city);
  if (o.geolink) {
    u.searchParams.set("lat", String(o.geolink.lat));
    u.searchParams.set("lng", String(o.geolink.lng));
    u.searchParams.set("geolink", o.geolink.h3);
  }
  if (o.plotId) u.searchParams.set("gaia_plot", o.plotId);
  return u.toString();
}
