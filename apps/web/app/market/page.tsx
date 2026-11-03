import Link from "next/link";
import { hubid } from "@/lib/hubid";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const listings = await hubid.listings().catch(() => ({ total: 0, items: [] }));
  return (
    <main>
      <h1>Market</h1>
      <p className="muted">
        Properties for sale across Emerald City. Owners can also transfer directly with no fee. Brokered listings pay 1% to the Real Estate
        Agent or AI agent promoting them.
      </p>
      {listings.items.length === 0 && <p className="muted">Nothing for sale right now.</p>}
      <div className="grid">
        {listings.items.map((l) => (
          <Link key={l.id} href={`/p/${l.pavilion_id}`} className="card">
            <h3>{Number(l.price_ven)} VEN</h3>
            <p className="muted">
              Parcel {l.parcel_id}
              {l.area_m2 ? <> · {(Number(l.area_m2) / 10_000).toFixed(2)} ha</> : null}
              {l.tier ? <> · {l.tier}</> : null}
              {l.broker_user_id ? <> · brokered</> : null}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
