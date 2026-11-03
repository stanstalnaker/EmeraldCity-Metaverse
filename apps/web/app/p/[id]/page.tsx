import Link from "next/link";
import { notFound } from "next/navigation";
import { HubIdError } from "@emerald-city/hubid-client";
import { hubid } from "@/lib/hubid";
import { getSession } from "@/lib/session";
import { mapStyleUrl } from "@/lib/map";
import { PropertyMarket } from "@/components/PropertyMarket";

export const revalidate = 300;

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const property = await hubid.getProperty(numericId).catch((err) => {
    if (err instanceof HubIdError && err.status < 500) return null;
    throw err;
  });
  const session = await getSession().catch(() => null);
  const canEdit = session ? (await session.client.myProperties().catch(() => [])).some((p) => p.id === numericId) : false;
  const listing = await hubid
    .listings({ pavilionId: numericId })
    .then((r) => r.items.find((l) => l.status === "active") ?? null)
    .catch(() => null);
  // Private properties are visible only to their owners.
  if (!property || (property.isPrivate && !canEdit)) notFound();

  return (
    <main>
      <p>
        <Link href="/properties">← Properties</Link>
      </p>
      <h1>{property.name}</h1>
      {canEdit && (
        <p>
          <Link href={`/p/${property.id}/edit`}>Edit property</Link>
        </p>
      )}
      {property.message && <p>{property.message}</p>}
      {property.location ? (
        <p>
          <Link href={`/map?property=${property.id}`}>
            View on the Gaia map ({property.location.lat.toFixed(4)}, {property.location.lng.toFixed(4)})
          </Link>
        </p>
      ) : (
        <p className="muted">This property hasn&apos;t been placed on the Gaia map yet.</p>
      )}
      {property.parcelId ? (
        <p>
          Sits on parcel <code>{property.parcelId}</code>
        </p>
      ) : (
        canEdit && (
          <p className="muted">
            Not on a parcel yet. Pick land in a <Link href="/cities">city</Link> and claim it for this property.
          </p>
        )
      )}
      <PropertyMarket
        pavilionId={property.id}
        isOwner={canEdit}
        signedIn={!!session}
        onParcel={!!property.parcelId}
        listing={listing ? { id: listing.id, priceVen: Number(listing.price_ven), brokered: !!listing.broker_user_id } : null}
        location={property.location}
        styleUrl={mapStyleUrl()}
      />
    </main>
  );
}
