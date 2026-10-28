import Link from "next/link";
import { redirect } from "next/navigation";
import { territory } from "@/lib/hubid";
import { getSession } from "@/lib/session";

export default async function MyPropertiesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/my-properties");
  const properties = await session.client.myProperties(territory);
  const unplaced = properties.filter((p) => !p.location);

  return (
    <main>
      <h1>My properties</h1>
      <p>
        <Link href="/properties/new" className="btn">+ Launch a property</Link>
      </p>
      {unplaced.length > 0 && (
        <p className="notice">
          {unplaced.length} of your properties {unplaced.length === 1 ? "isn't" : "aren't"} on the Gaia map yet. Edit{" "}
          {unplaced.length === 1 ? "it" : "them"} to drop a pin.
        </p>
      )}
      {properties.length === 0 && <p className="muted">You don&apos;t own any Emerald City properties yet.</p>}
      <div className="grid">
        {properties.map((p) => (
          <div key={p.id} className="card">
            <h3>
              <Link href={`/p/${p.id}`}>{p.name}</Link>
            </h3>
            <p className="muted">
              {p.isPrivate ? "Private" : "Public"} · {p.location ? "On the map" : "Not placed"}
            </p>
            <Link href={`/p/${p.id}/edit`}>Edit</Link>
          </div>
        ))}
      </div>
    </main>
  );
}
