/**
 * Raw HubID pavilion as returned by `HubPavilions::preparePavilion()`
 * (hubid_api/app/Services/HubPavilions.php). Properties in the city are pavilions
 * whose `territory` is "Emerald City".
 *
 * The API encodes with JSON_NUMERIC_CHECK, so numeric-looking strings (ids,
 * lat/lng) may arrive as numbers or strings.
 */
export interface HubPavilion {
  id: number;
  group: number;
  group_data?: Record<string, unknown>;
  name: string;
  localename?: string | null;
  territory?: string | null;
  timezone?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  address?: string | null;
  url?: string | null;
  hours?: unknown;
  visible: 0 | 1;
  is_private: boolean | 0 | 1;
  image?: string | null;
  background_image?: string | null;
  message?: string;
  zones?: HubPavilionZone[];
  created_by_user?: {
    id: number;
    name?: string;
    [key: string]: unknown;
  } | null;
}

export interface HubPavilionZone {
  id: number;
  pavilion_id: number;
  order: number;
  name: string;
  type: string;
  zone_contents?: Array<{ id: number; type: "media-url" | "seat" | "file"; data: unknown }>;
}

/** Standard HubID response envelope (Controller::success). */
export interface HubEnvelope<T> {
  status: "success" | "error";
  errors: unknown[];
  data: T;
  code: number;
  time: number;
}

export interface HubPage<T> {
  offset: number;
  limit: number;
  total: number;
  count: number;
  items: T[];
}

export const EMERALD_CITY_TERRITORY = "Emerald City";
