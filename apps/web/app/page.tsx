import Link from "next/link";
import { cityProperties } from "@/lib/hubid";

export const revalidate = 300;

export default async function Home() {
  const properties = await cityProperties();
  const placed = properties.filter((p) => p.location).length;
  return (
    <main>
      <h1>Emerald City (beta)</h1>
      <p className="muted">
        {properties.length} public properties, {placed} placed on the Gaia map.
      </p>
      <p>
        <Link href="/map">Open the Gaia map</Link> · <Link href="/properties">Browse properties</Link>
      </p>
    </main>
  );
}
