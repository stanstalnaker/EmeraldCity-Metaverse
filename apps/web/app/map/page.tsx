import { cityProperties } from "@/lib/hubid";
import MapView from "./MapView";

export const revalidate = 300;

export default async function MapPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const [properties, { property }] = await Promise.all([cityProperties(), searchParams]);
  const focus = properties.find((p) => p.id === Number(property))?.location ?? null;
  return (
    <div className="map-wrap">
      <MapView
        properties={properties}
        styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty"}
        focus={focus}
      />
    </div>
  );
}
