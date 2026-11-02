import Link from "next/link";
import { notFound } from "next/navigation";
import { RULES } from "@emerald-city/parcels";
import { SLUG_PATTERN, STARTER_PRICING, starterCity } from "@/lib/cities";
import CityView from "./CityView";

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) notFound();
  const city = starterCity(slug);
  const s = city.summary;
  return (
    <main style={{ maxWidth: 1200 }}>
      <p>
        <Link href="/cities">← Cities</Link>
      </p>
      <h1>{slug}</h1>
      <p className="muted">
        Starter topography (generated from the city name) · {s.parcels} parcels · median {s.medianHa} ha · largest {s.largestHa} ha ·
        roads {s.roadsPct}% · water {s.waterPct}% · rules {RULES.version} · starter price {STARTER_PRICING.venPerHectare} VEN/ha
      </p>
      <CityView slug={slug} />
    </main>
  );
}
