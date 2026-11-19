import { city3dUrl, hubIslands, launchUrl, loadTerritories, ultraUrl } from "@/lib/archipelago";
import { mapStyleUrl } from "@/lib/map";
import ArchipelagoMap from "./ArchipelagoMap";

export const revalidate = 300;
export const metadata = { title: "The archipelago · Emerald City" };

export default async function ArchipelagoPage() {
  const [{ source, features }, islands] = await Promise.all([loadTerritories(), hubIslands()]);
  return (
    <ArchipelagoMap
      styleUrl={mapStyleUrl()}
      islands={islands}
      territories={{ type: "FeatureCollection", features }}
      source={source}
      links={{ city3d: city3dUrl(), launch: launchUrl(), ultra: ultraUrl() }}
    />
  );
}
