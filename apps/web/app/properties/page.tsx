import Link from "next/link";
import { cityProperties } from "@/lib/hubid";

export const revalidate = 300;

export default async function PropertiesPage() {
  const properties = await cityProperties();
  return (
    <main>
      <h1>Properties</h1>
      {properties.length === 0 && <p className="muted">No properties loaded. Check HUBID_API_URL.</p>}
      <div className="grid">
        {properties.map((p) => (
          <Link key={p.id} href={`/p/${p.id}`} className="card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.image ? <img src={p.image} alt="" /> : <div style={{ aspectRatio: "16/9" }} />}
            <h3>{p.name}</h3>
            <span className="muted">{p.location ? "On the map" : "Not yet placed"}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
