import { propertiesToParcels, propertiesToPoints } from "@emerald-city/core";
import { cityProperties } from "@/lib/hubid";

export const revalidate = 300;

/**
 * GET /api/properties?shape=points|parcels
 * Public GeoJSON of placed properties for the VR client, agents and gaia.club.
 */
export async function GET(req: Request) {
  const shape = new URL(req.url).searchParams.get("shape");
  const properties = await cityProperties();
  const body = shape === "parcels" ? propertiesToParcels(properties) : propertiesToPoints(properties);
  return Response.json(body, { headers: { "Access-Control-Allow-Origin": "*" } });
}
