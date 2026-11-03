import { hubid } from "@/lib/hubid";

/** GET /api/anchors/near?lat=&lng=&radius= : visible worlds anchored near a real place (proxy to HubID). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  const radius = Math.min(Number(u.searchParams.get("radius") ?? 200) || 200, 5000);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "lat and lng required" }, { status: 400 });
  }
  try {
    const anchors = await hubid.anchorsNear(lat, lng, radius);
    // Add property names and images for the spheres (nearest 20; HubID returns at most 50).
    const items = await Promise.all(
      anchors.map(async (a, i) => {
        if (a.kind !== "virtual-property" || i >= 20) return a;
        const p = await hubid.getProperty(Number(a.ref)).catch(() => null);
        return p ? { ...a, title: p.name, thumbnail: p.image } : a;
      }),
    );
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "HubID unavailable" }, { status: 502 });
  }
}
