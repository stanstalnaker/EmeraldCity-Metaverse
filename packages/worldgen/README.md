# World generator

Partners describe a city; the generator builds it into a world.

1. **Describe (Claude).** Claude Opus 5.5 writes a city spec from a plain-language brief, with structured output so the result always matches the schema in `src/spec.ts`. It needs Anthropic credentials (`ANTHROPIC_API_KEY`, or `ant auth login`). Review and edit the spec: it's a short JSON file.
   ```bash
   pnpm --filter @emerald-city/worldgen describe "A lakeside city for a climate summit, with a congress hall, an agent quarter and green parks" --out specs/summit.json
   ```
2. **Build (deterministic).** The spec becomes a city on the world's real terrain: a street grid along the valley, roads draped on the ground, districts by role (plaza and civic at the heart, commerce around them, homes outside, parks and an agent hub), buildings from the style's kit (alpine chalets, futurist towers, tropical or temperate houses) only on buildable slopes, and landmarks (hall, dome, tower, pavilion, arena).
   ```bash
   pnpm --filter @emerald-city/worldgen generate specs/davos-agents-city.json --world davos --center 0,0
   ```
   The city is written into `packages/world/data/<world>.world.json` as a `generated` entry. Rebuilding the same spec replaces it; the forest inside the city is cleared and each landmark is added to the Teleport menu. It's drawn as instanced batches: the Davos agents city is 9 draw calls for 3,379 parts and 496 buildings, with invisible collision boxes so you can't walk through walls.

`specs/davos-agents-city.json` is the first city: the Davos Agents City on the valley floor around Davos Platz, with Congress Plaza, the Agent Congress Hall, Davos Dome, Zeke Tower and the Ven Exchange Pavilion.
