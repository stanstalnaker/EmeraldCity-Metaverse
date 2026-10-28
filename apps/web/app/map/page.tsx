import { cityProperties } from "@/lib/hubid";
import { mapStyleUrl } from "@/lib/map";
import MapView from "./MapView";

export const revalidate = 300;

export default async function MapPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const [properties, { property }] = await Promise.all([cityProperties(), searchParams]);
  const focus = properties.find((p) => p.id === Number(property))?.location ?? null;
  return (
    <div className="map-wrap">
      <MapView
        properties={properties}
        styleUrl={mapStyleUrl()}
        focus={focus}
      />
    </div>
  );
}
