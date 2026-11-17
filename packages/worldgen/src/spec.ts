import { z } from "zod";

/**
 * A city spec: the small, checkable description a partner (or Claude, from a description) writes,
 * and the builder turns into streets, districts, buildings and landmarks. Everything is optional
 * except what the builder can't guess.
 */
export const DistrictUse = z.enum(["civic", "plaza", "commercial", "residential", "park", "agent-hub"]);
export const LandmarkKind = z.enum(["hall", "tower", "dome", "pavilion", "arena"]);
export const CityStyle = z.enum(["alpine", "tropical", "temperate", "futurist"]);

export const CitySpecSchema = z.object({
  name: z.string().min(2).max(60).describe("Display name of the city"),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/).describe("URL-safe id, lower case with dashes"),
  summary: z.string().max(400).describe("One or two sentences on what the city is for"),
  style: CityStyle.describe("Architectural style of the building kit"),
  sizeMeters: z.number().min(300).max(4000).describe("Width of the built-up area in metres"),
  density: z.enum(["low", "medium", "high"]),
  /** Street grid spacing in metres (block + street). */
  blockMeters: z.number().min(40).max(200),
  districts: z
    .array(z.object({ name: z.string().max(40), use: DistrictUse, share: z.number().min(0.02).max(1) }))
    .min(1)
    .max(8)
    .describe("Districts and the share of blocks each takes; shares are normalised"),
  landmarks: z
    .array(z.object({ name: z.string().max(50), kind: LandmarkKind, district: z.string().max(40) }))
    .max(8)
    .describe("Signature buildings, each placed in the named district"),
  palette: z
    .object({ walls: z.string().regex(/^#[0-9a-fA-F]{6}$/), roofs: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) })
    .describe("Main colours as hex"),
});

export type CitySpec = z.infer<typeof CitySpecSchema>;
