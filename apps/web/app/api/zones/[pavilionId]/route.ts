import { hubid } from "@/lib/hubid";

export const revalidate = 60;

/**
 * GET /api/zones/{pavilionId}: what each zone's screens show (uploaded media and files), for the 3D
 * city. Read server-side with the HubID private key; the browser never sees a key. Public
 * properties only: HubID refuses private ones without the owner's token.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ pavilionId: string }> }) {
  const id = Number((await ctx.params).pavilionId);
  const headers = { "Access-Control-Allow-Origin": process.env.CITY3D_ORIGIN ?? "*", "Cache-Control": "public, max-age=60" };
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad_id" }, { status: 400, headers });
  try {
    return Response.json({ pavilionId: id, zones: await hubid.zoneContent(id) }, { headers });
  } catch (err) {
    console.error(`zones ${id}: HubID request failed`, err);
    return Response.json({ pavilionId: id, zones: [] }, { status: 502, headers });
  }
}
