import { loadCity, SLUG_PATTERN } from "@/lib/cities";

/** GET /api/cities/{slug}/parcels: the city's parcels as GeoJSON (display coordinates). */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) return Response.json({ error: "invalid city slug" }, { status: 400 });
  const city = await loadCity(slug);
  return Response.json(city.parcels, {
    headers: {
      // Launched cities change as parcels are claimed; previews are deterministic.
      "Cache-Control": city.source === "hubid" ? "no-store" : "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
