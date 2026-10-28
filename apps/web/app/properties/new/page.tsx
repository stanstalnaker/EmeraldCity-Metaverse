import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { mapStyleUrl } from "@/lib/map";
import { createProperty } from "../../actions";
import { PropertyForm } from "@/components/PropertyForm";

export default async function NewPropertyPage() {
  if (!(await getSession())) redirect("/login?next=/properties/new");
  return (
    <main>
      <h1>Launch a property</h1>
      <PropertyForm action={createProperty} styleUrl={mapStyleUrl()} submitLabel="Create property" />
    </main>
  );
}
