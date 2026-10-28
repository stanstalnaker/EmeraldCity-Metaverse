import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { mapStyleUrl } from "@/lib/map";
import { updateProperty } from "../../../actions";
import { PropertyForm } from "@/components/PropertyForm";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const session = await getSession();
  if (!session) redirect(`/login?next=/p/${numericId}/edit`);

  // Only properties the user owns can be edited here. HubID's own check applies on save too.
  const mine = await session.client.myProperties();
  const property = mine.find((p) => p.id === numericId);
  if (!property) notFound();

  return (
    <main>
      <p>
        <Link href={`/p/${property.id}`}>← {property.name}</Link>
      </p>
      <h1>Edit property</h1>
      <PropertyForm
        action={updateProperty.bind(null, property.id)}
        styleUrl={mapStyleUrl()}
        initial={{ name: property.name, location: property.location, isPrivate: property.isPrivate }}
        submitLabel="Save changes"
      />
    </main>
  );
}
