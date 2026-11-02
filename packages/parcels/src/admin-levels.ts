/**
 * Which OpenStreetMap admin_level means "state" and "county" in each country. National borders are
 * always admin_level 2. The meaning of the other levels varies by country, so this table decides
 * which lines cut parcels. Extend it as cities launch; unknown countries use DEFAULT_ADMIN_LEVELS.
 * Source: https://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative#admin_level
 */
export interface AdminLevels {
  state: number;
  county: number;
}

export const DEFAULT_ADMIN_LEVELS: AdminLevels = { state: 4, county: 6 };

export const ADMIN_LEVELS: Record<string, AdminLevels> = {
  US: { state: 4, county: 6 }, // states, counties
  CA: { state: 4, county: 6 }, // provinces, census divisions / counties
  GB: { state: 4, county: 6 }, // nations (England, Scotland…), counties / unitary authorities
  IE: { state: 5, county: 6 }, // provinces, counties
  FR: { state: 4, county: 6 }, // régions, départements
  DE: { state: 4, county: 6 }, // Länder, Kreise
  ES: { state: 4, county: 6 }, // comunidades autónomas, provincias
  IT: { state: 4, county: 6 }, // regioni, province
  CH: { state: 4, county: 6 }, // cantons, districts
  NL: { state: 4, county: 8 }, // provinces, municipalities
  AU: { state: 4, county: 6 }, // states, local government areas
  NZ: { state: 4, county: 6 }, // regions, territorial authorities
  BR: { state: 4, county: 8 }, // states, municipalities
  MX: { state: 4, county: 6 }, // states, municipalities
  IN: { state: 4, county: 5 }, // states, districts
  CN: { state: 4, county: 5 }, // provinces, prefectures
  JP: { state: 4, county: 7 }, // prefectures, municipalities
  KR: { state: 4, county: 6 }, // provinces, cities / counties
  ZA: { state: 4, county: 6 }, // provinces, districts
  AE: { state: 4, county: 6 }, // emirates
  SG: { state: 6, county: 6 }, // city-state: regions only
  BM: { state: 4, county: 6 }, // Bermuda parishes
};

export function adminLevelsFor(countryCode?: string): AdminLevels {
  return (countryCode && ADMIN_LEVELS[countryCode.toUpperCase()]) || DEFAULT_ADMIN_LEVELS;
}
