import "server-only";
import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { EMERALD_CITY_TERRITORY, type Property } from "@emerald-city/core";

export const hubid = hubIdFromEnv();
export const territory = process.env.CITY_TERRITORY ?? EMERALD_CITY_TERRITORY;

/** All public city properties. Returns [] (and logs) if HubID is unreachable, so pages still render. */
export async function cityProperties(): Promise<Property[]> {
  try {
    return await hubid.listProperties({ territory });
  } catch (err) {
    console.error("cityProperties: HubID request failed", err);
    return [];
  }
}
