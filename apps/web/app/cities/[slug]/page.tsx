import Link from "next/link";
import { notFound } from "next/navigation";
import { RULES } from "@emerald-city/parcels";
import { loadCity, SLUG_PATTERN } from "@/lib/cities";
import { getSession } from "@/lib/session";
import CityView from "./CityView";
import PublishLayout from "./PublishLayout";

export const dynamic = "force-dynamic";

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) notFound();
  const [city, session] = await Promise.all([loadCity(slug), getSession().catch(() => null)]);
  const myUnplaced = session && city.source === "hubid"
    ? (await session.client.myProperties().catch(() => [])).filter((p) => !p.parcelId).map((p) => ({ id: p.id, name: p.name }))
    : [];
  const s = city.summary;
  const launched = city.source === "hubid";

  return (
    <main style={{ maxWidth: 1200 }}>
      <p>
        <Link href="/cities">← Cities</Link>
      </p>
      <h1>{city.city?.name ?? slug}</h1>
      <p className="muted">
        {launched ? "Launched city" : "Starter preview (generated from the city name; not launched yet)"} · {s.parcels} parcels · median {s.medianHa} ha ·
        largest {s.largestHa} ha · {city.pricing.venPerHectare} VEN/ha · rules {city.city?.rules_version ?? RULES.version}
        {launched && city.city?.launch_policy !== "open" && <> · launching here needs the city&apos;s {city.city?.launch_policy}</>}
      </p>
      {launched && s.parcels === 0 && session && <PublishLayout slug={slug} />}
      <CityView slug={slug} launched={launched} signedIn={!!session} myUnplaced={myUnplaced} />
    </main>
  );
}
