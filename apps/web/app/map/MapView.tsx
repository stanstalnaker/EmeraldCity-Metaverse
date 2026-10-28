"use client";

import { useRouter } from "next/navigation";
import { GaiaMap } from "@emerald-city/gaia-map";
import type { LngLat, Property } from "@emerald-city/core";

export default function MapView({ properties, styleUrl, focus }: { properties: Property[]; styleUrl: string; focus: LngLat | null }) {
  const router = useRouter();
  return (
    <GaiaMap
      properties={properties}
      styleUrl={styleUrl}
      center={focus ? [focus.lng, focus.lat] : undefined}
      zoom={focus ? 16 : undefined}
      onSelectProperty={(id) => router.push(`/p/${id}`)}
    />
  );
}
