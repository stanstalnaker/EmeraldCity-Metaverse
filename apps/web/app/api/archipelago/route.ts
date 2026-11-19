import { NextResponse } from "next/server";
import { generateArchipelago, linksFor } from "@emerald-city/archipelago";
import { hubIslands, loadTerritories } from "@/lib/archipelago";

/** The archipelago as data, for the map, the 3D client, agents and gaia.club. */
export async function GET() {
  const [{ source, features }, islands] = await Promise.all([loadTerritories(), hubIslands()]);
  return NextResponse.json({ source, islands, territories: { type: "FeatureCollection", features } }, { headers: { "Cache-Control": "public, max-age=300" } });
}

/** Andromeda preview: generate an archipelago tied to a place and show what it links to. Nothing is saved. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string; seed?: string; lat?: number; lng?: number; islands?: number } | null;
  const name = String(body?.name ?? "").trim().slice(0, 60);
  if (name.length < 2) return NextResponse.json({ error: "Give your archipelago a name." }, { status: 400 });
  const lat = Number(body?.lat), lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Pick a place on the map." }, { status: 400 });
  }
  const { index } = await loadTerritories();
  const a = generateArchipelago({ name, seed: String(body?.seed ?? name).slice(0, 80), anchor: { lat, lng }, islands: Number(body?.islands ?? 4) });
  return NextResponse.json({ ...a, links: a.islands.map((i) => linksFor(i, index)) });
}
