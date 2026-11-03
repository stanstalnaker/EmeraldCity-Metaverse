/**
 * Google Maps geocoding and optional verification of real-world links.
 *
 * SERVER-SIDE ONLY: uses GOOGLE_MAPS_API_KEY (a new, server-restricted key; the legacy keys committed
 * in emerald-city-laravel must be rotated, see the private audit).
 */
import { evaluateLinkCredentials, profileAddress, type GeocodedPlace, type LinkCredentials, type LngLat } from "@emerald-city/core";
import type { HubIdClient } from "@emerald-city/hubid-client";

export interface GeocoderOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** Response language for formatted addresses. */
  language?: string;
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: { place_id: string; formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
}

export class GeocodeError extends Error {
  constructor(
    message: string,
    readonly status: string,
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

/** Google Geocoding API (https://developers.google.com/maps/documentation/geocoding). */
export class GoogleGeocoder {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GeocoderOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Best match for an address, or null if Google finds nothing. */
  geocode(address: string): Promise<GeocodedPlace | null> {
    return this.call(new URLSearchParams({ address }));
  }

  /** Address at a point, or null. */
  reverse(at: LngLat): Promise<GeocodedPlace | null> {
    return this.call(new URLSearchParams({ latlng: `${at.lat},${at.lng}` }));
  }

  private async call(q: URLSearchParams): Promise<GeocodedPlace | null> {
    q.set("key", this.opts.apiKey);
    if (this.opts.language) q.set("language", this.opts.language);
    const res = await this.fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${q}`);
    if (!res.ok) throw new GeocodeError(`Google geocoding failed (${res.status})`, String(res.status));
    const body = (await res.json()) as GoogleGeocodeResponse;
    if (body.status === "ZERO_RESULTS") return null;
    if (body.status !== "OK") throw new GeocodeError(body.error_message ?? `Google geocoding: ${body.status}`, body.status);
    const r = body.results[0];
    if (!r) return null;
    return { placeId: r.place_id, location: { lat: r.geometry.location.lat, lng: r.geometry.location.lng }, formattedAddress: r.formatted_address };
  }
}

export function geocoderFromEnv(env: Record<string, string | undefined> = process.env): GoogleGeocoder | null {
  return env.GOOGLE_MAPS_API_KEY ? new GoogleGeocoder({ apiKey: env.GOOGLE_MAPS_API_KEY }) : null;
}

export interface VerifyLinkInput {
  /** Where the virtual property links to. */
  location: LngLat;
  /** Address the person entered, if any (otherwise the point is reverse-geocoded). */
  address?: string;
  /** Whether they own the Gaia parcel under the point (from HubID parcels, once stored). */
  ownsGaiaParcel?: boolean;
}

export interface VerifiedLink extends LinkCredentials {
  /** Google's normalised address for the link, when found. */
  place: GeocodedPlace | null;
}

interface HubProfileSelf {
  profile?: { address?: string | null; city?: string | null; zip?: string | null; country?: string | null } | null;
}

/**
 * Checks a real-world link against Google Maps and the signed-in person's HubID record. Optional:
 * any step that can't run (no address on the profile, no check-ins, HubID unavailable) just earns
 * fewer badges; it never blocks the link.
 */
export async function verifyLink(input: VerifyLinkInput, deps: { geocoder: GoogleGeocoder; hubid: HubIdClient }): Promise<VerifiedLink> {
  const place = input.address ? await deps.geocoder.geocode(input.address) : await deps.geocoder.reverse(input.location);

  const [self, checkIns] = await Promise.all([
    deps.hubid.getSelf<HubProfileSelf>().catch(() => null),
    deps.hubid.getMyCheckIns().catch(() => []),
  ]);
  const homeAddress = self?.profile ? profileAddress(self.profile) : null;
  const profilePlace = homeAddress ? await deps.geocoder.geocode(homeAddress).catch(() => null) : null;

  const credentials = evaluateLinkCredentials({
    linkLocation: input.location,
    linkPlace: place,
    profilePlace,
    checkInPlaceIds: checkIns.map((c) => c.googlePlaceId),
    ownsGaiaParcel: input.ownsGaiaParcel,
  });
  return { ...credentials, place };
}
