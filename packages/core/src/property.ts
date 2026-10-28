import type { HubPavilion } from "./pavilion";
import { type LngLat, parseLngLat, squareFootprint } from "./geo";

/** A city property: the normalised, map-ready view of a HubID pavilion. */
export interface Property {
  id: number;
  slug: string | null;
  name: string;
  territory: string | null;
  isPrivate: boolean;
  image: string | null;
  backgroundImage: string | null;
  message: string;
  /** HubID user id of the property's bot sub-profile (`object__property`), which owns the pavilion. */
  ownerProfileId: number | null;
  /** Where the property drops onto the Gaia map. Null when the pavilion has no usable coordinates. */
  location: LngLat | null;
}

export function toProperty(p: HubPavilion): Property {
  return {
    id: Number(p.id),
    slug: p.url ?? null,
    name: p.name,
    territory: p.territory ?? null,
    isPrivate: Boolean(p.is_private),
    image: p.image || null,
    backgroundImage: p.background_image || null,
    message: p.message ?? "",
    ownerProfileId: p.created_by_user?.id ?? null,
    location: parseLngLat(p.latitude, p.longitude),
  };
}

export type PropertyFeatureProps = Pick<Property, "id" | "slug" | "name" | "image"> & { kind: "property" };

export interface FeatureCollection<G, P> {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; id: number; geometry: G; properties: P }>;
}

export interface PointGeometry {
  type: "Point";
  coordinates: [number, number];
}

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: [number, number][][];
}

function featureProps(p: Property): PropertyFeatureProps {
  return { kind: "property", id: p.id, slug: p.slug, name: p.name, image: p.image };
}

/** Properties as map pins. Private and unplaced properties are left out. */
export function propertiesToPoints(props: Property[]): FeatureCollection<PointGeometry, PropertyFeatureProps> {
  return {
    type: "FeatureCollection",
    features: placedPublic(props).map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.location.lng, p.location.lat] },
      properties: featureProps(p),
    })),
  };
}

/** Properties as one-hectare parcels, for extrusion on the Gaia map. */
export function propertiesToParcels(props: Property[]): FeatureCollection<PolygonGeometry, PropertyFeatureProps> {
  return {
    type: "FeatureCollection",
    features: placedPublic(props).map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Polygon", coordinates: [squareFootprint(p.location)] },
      properties: featureProps(p),
    })),
  };
}

function placedPublic(props: Property[]): Array<Property & { location: LngLat }> {
  return props.filter((p): p is Property & { location: LngLat } => p.location !== null && !p.isPrivate);
}
