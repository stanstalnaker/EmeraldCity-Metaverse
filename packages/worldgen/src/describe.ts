import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CitySpecSchema, type CitySpec } from "./spec";

/**
 * Turns a partner's description of a city into a CitySpec with Claude (structured output, so the
 * result always matches the schema). The spec is then reviewed and built with buildCity(); nothing
 * Claude writes goes into a world without that build step.
 *
 * Credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile).
 */
const SYSTEM = `You design cities for Emerald City, Hub Culture's metaverse, where partners launch their own cities.
Turn the partner's description into a city spec. Guidance:
- Keep it buildable: 600-2000 m wide for a town, block size 60-120 m.
- Districts: always include at least one plaza or civic district at the heart; use "agent-hub" for places where AI agents work and meet people.
- Landmarks: 2-5 signature buildings, each assigned to one of your districts by its exact name.
- Choose the style and palette from the place and the brief (alpine for mountain towns, tropical for islands).
- The summary is one or two plain sentences on what the city is for.`;

export async function describeCity(description: string, client = new Anthropic()): Promise<CitySpec> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // On a safety decline the API re-runs the request on a fallback model automatically.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(CitySpecSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: description }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to design this city${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`);
  }
  if (!response.parsed_output) throw new Error(`No city spec came back (stop reason: ${response.stop_reason})`);
  return CitySpecSchema.parse(response.parsed_output);
}
