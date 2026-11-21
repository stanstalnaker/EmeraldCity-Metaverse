import { NextResponse } from "next/server";
import { parseLatLng, plotAt } from "@emerald-city/archipelago";
import { gaiaApiUrl } from "@/lib/archipelago";

/** Seconds a plot answer may be reused: statuses change when someone buys, so keep it short. */
const FRESH = 30;

/**
 * The Gaia plot at a point, proxied from gaia-api (`GET {GAIA_API_URL}/plots/at`) so the browser
 * never calls Gaia directly and answers can be cached briefly. Same contract as gaia-api's, with
 * plot properties cut down to the public ones (never who owns it). 404 means gaia-api's route isn't
 * live yet; 502 means Gaia couldn't be reached. Nothing is stored and nothing is paid here.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const p = parseLatLng(q.get("lat"), q.get("lng"));
  if (!p) return NextResponse.json({ error: "lat (-90 to 90) and lng (-180 to 180) are required" }, { status: 400 });
  const r = await plotAt(gaiaApiUrl(), p.lat, p.lng, { timeoutMs: 6000, init: { next: { revalidate: FRESH } } as RequestInit });
  if (r.state === "not-live") {
    return NextResponse.json({ error: "not_live", message: "Plot lookup isn't live yet" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (r.state === "error") return NextResponse.json({ error: "gaia_unreachable", message: r.message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  // Pending: the land is being cut now, so don't hold on to that for long.
  const age = r.at.found === "pending" ? Math.min(FRESH, r.at.retry_after_secs ?? 10) : FRESH;
  return NextResponse.json(r.at, { headers: { "Cache-Control": `public, max-age=${age}, s-maxage=${age}` } });
}
