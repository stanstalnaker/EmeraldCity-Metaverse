"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HubIdError, type ClaimQuote } from "@emerald-city/hubid-client";
import { parseLngLat } from "@emerald-city/core";
import { loadCity, SLUG_PATTERN, starterImportPayload } from "@/lib/cities";
import { getSession } from "@/lib/session";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

function hubMessage(err: unknown, fallback: string): string {
  if (err instanceof HubIdError) {
    const detail = Array.isArray(err.body) ? err.body.filter((x) => typeof x === "string").join(" ") : "";
    if (err.status === 402) return detail || "Not enough VEN.";
    if (err.status === 401 || err.status === 403) return detail || "You don't have permission to do that.";
    if (err.status === 409) return detail || "Someone else got there first.";
    if (err.status === 503) return detail || "Payments for this city aren't configured yet.";
    return detail || `${fallback} (HubID ${err.status})`;
  }
  return fallback;
}

async function requireSession(next: string) {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return session;
}

/** What claiming this parcel would cost the signed-in member. */
export async function quoteClaimAction(parcelId: string): Promise<{ quote?: ClaimQuote; error?: string }> {
  const session = await getSession();
  if (!session) return { error: "Sign in to claim land." };
  try {
    return { quote: await session.client.quoteClaim(parcelId) };
  } catch (err) {
    return { error: hubMessage(err, "Couldn't price this parcel.") };
  }
}

export async function claimParcelAction(slug: string, parcelId: string, pavilionId: number): Promise<ActionResult> {
  const session = await requireSession(`/cities/${slug}`);
  if (!session.entitlements.capabilities.has("claim-parcel")) return { error: "Your HubID membership can't launch properties yet." };
  try {
    const r = await session.client.claimParcel(parcelId, pavilionId);
    revalidatePath(`/cities/${slug}`);
    revalidatePath(`/p/${pavilionId}`);
    return { ok: true, message: `Claimed for ${r.total_ven} VEN.` };
  } catch (err) {
    return { error: hubMessage(err, "Couldn't claim this parcel.") };
  }
}

/** City admins: store the generated starter layout as the launched city's parcels. */
export async function publishStarterLayoutAction(slug: string): Promise<ActionResult> {
  if (!SLUG_PATTERN.test(slug)) return { error: "Invalid city." };
  const session = await requireSession(`/cities/${slug}`);
  const city = await loadCity(slug);
  if (city.source !== "hubid") return { error: "Launch the city in HubID first." };
  try {
    const { rulesVersion, parcels } = starterImportPayload(slug);
    const r = await session.client.importParcels(slug, rulesVersion, parcels);
    revalidatePath(`/cities/${slug}`);
    return { ok: true, message: `Published ${r.created + r.updated} parcels.` };
  } catch (err) {
    return { error: hubMessage(err, "Couldn't publish the layout.") };
  }
}

export async function listForSaleAction(pavilionId: number, _: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireSession(`/p/${pavilionId}`);
  const price = Number(form.get("price"));
  const broker = Number(form.get("broker") || 0);
  if (!Number.isFinite(price) || price <= 0) return { error: "Enter a price in VEN." };
  try {
    await session.client.createListing(pavilionId, Math.round(price * 100) / 100, broker > 0 ? broker : undefined);
  } catch (err) {
    return { error: hubMessage(err, "Couldn't list this property.") };
  }
  revalidatePath(`/p/${pavilionId}`);
  revalidatePath("/market");
  return { ok: true, message: broker > 0 ? "Listed with a broker (1% fee on sale)." : "Listed for sale." };
}

export async function withdrawListingAction(pavilionId: number, listingId: number): Promise<void> {
  const session = await requireSession(`/p/${pavilionId}`);
  await session.client.withdrawListing(listingId).catch(() => undefined);
  revalidatePath(`/p/${pavilionId}`);
  revalidatePath("/market");
}

export async function buyListingAction(listingId: number, pavilionId: number): Promise<ActionResult> {
  const session = await requireSession(`/p/${pavilionId}`);
  try {
    const r = await session.client.buyListing(listingId);
    revalidatePath(`/p/${pavilionId}`);
    revalidatePath("/market");
    revalidatePath("/my-properties");
    return { ok: true, message: `Bought for ${r.price_ven} VEN.` };
  } catch (err) {
    return { error: hubMessage(err, "Couldn't buy this property.") };
  }
}

export async function transferAction(pavilionId: number, _: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireSession(`/p/${pavilionId}`);
  const to = Number(form.get("to"));
  if (!Number.isInteger(to) || to <= 0) return { error: "Enter the recipient's HubID number." };
  try {
    await session.client.transferProperty(pavilionId, to);
  } catch (err) {
    return { error: hubMessage(err, "Couldn't transfer this property.") };
  }
  revalidatePath(`/p/${pavilionId}`);
  revalidatePath("/my-properties");
  return { ok: true, message: `Transferred to HubID ${to}.` };
}

export async function linkRealPlaceAction(pavilionId: number, _: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireSession(`/p/${pavilionId}`);
  const at = parseLngLat(form.get("lat"), form.get("lng"));
  if (!at) return { error: "Drop a pin on the real place." };
  const address = String(form.get("address") ?? "").trim() || undefined;
  try {
    const anchor = await session.client.createAnchor({ pavilionId, lat: at.lat, lng: at.lng, address });
    let message = anchor.needs_owner_approval
      ? "Linked. The land owner curates this land, so it shows once they approve."
      : anchor.rent_ven > 0
        ? `Linked. Rent of ${anchor.rent_ven} VEN was paid to the land owner.`
        : "Linked. It now shows to people nearby.";
    try {
      const v = await session.client.verifyAnchor(anchor.id);
      if (v.trust !== "unverified") message += ` Verified: ${v.badges.join(", ")}.`;
    } catch {
      // credentials are optional
    }
    revalidatePath(`/p/${pavilionId}`);
    return { ok: true, message };
  } catch (err) {
    return { error: hubMessage(err, "Couldn't link this property.") };
  }
}
