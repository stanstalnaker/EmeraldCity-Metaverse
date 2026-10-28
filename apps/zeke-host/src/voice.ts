/**
 * Zeke voice concierge: a LiveKit Agents worker that joins a property's media
 * room (dispatched by apps/presence when someone first turns on voice there)
 * and talks with visitors.
 *
 * A fast Claude model handles turn-taking and small talk; anything about Hub
 * Culture, the city, events or people goes to Zeke's brain (zeke-ai-server)
 * through the `ask_zeke` tool, so Zeke's knowledge and personality stay in one
 * place.
 *
 *   LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 *   ANTHROPIC_API_KEY  DEEPGRAM_API_KEY  CARTESIA_API_KEY
 *   ZEKE_API_URL  ZEKE_SYSTEM_TOKEN
 *   pnpm --filter @emerald-city/zeke-host voice:dev
 */
import { fileURLToPath } from "node:url";
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, llm, voice } from "@livekit/agents";
import * as anthropic from "@livekit/agents-plugin-anthropic";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as silero from "@livekit/agents-plugin-silero";
import type { RemoteParticipant } from "@livekit/rtc-node";
import { z } from "zod";
import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { buildCityContext, zekeFromEnv } from "@emerald-city/zeke-client";

export const ZEKE_VOICE_AGENT_NAME = process.env.LIVEKIT_CONCIERGE_AGENT ?? "zeke-concierge";

/** Presence issues identities as `hub:<id>` with `kind`/`hubId` attributes (apps/presence/src/media.ts). */
function actorFrom(p: RemoteParticipant) {
  const a = p.attributes;
  const hubId = Number(a.hubId ?? p.identity.replace(/^hub:/, ""));
  return {
    kind: a.kind === "agent" ? ("agent" as const) : ("human" as const),
    hubId: Number.isInteger(hubId) ? hubId : 0,
    displayName: p.name || `Visitor ${hubId}`,
    ownerHubId: a.ownerHubId ? Number(a.ownerHubId) : undefined,
  };
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const zeke = zekeFromEnv();
    if (!zeke) throw new Error("ZEKE_API_URL and ZEKE_SYSTEM_TOKEN are required");
    await ctx.connect();

    const roomName = ctx.room.name ?? "";
    const propertyId = roomName.startsWith("property:") ? Number(roomName.slice(9)) : NaN;
    const property = Number.isInteger(propertyId) ? await hubIdFromEnv().getProperty(propertyId).catch(() => null) : null;
    const threads = new Map<number, string>();

    const visitors = () => [...ctx.room.remoteParticipants.values()].map(actorFrom).filter((a) => a.kind === "human");

    const askZeke = llm.tool({
      name: "ask_zeke",
      description:
        "Ask Zeke's knowledge base: Hub Culture, Emerald City, properties, events, news, people, VEN. " +
        "Use for any factual question. Pass the visitor's question in their own words.",
      parameters: z.object({ question: z.string().describe("The visitor's question") }),
      execute: async ({ question }) => {
        // Voice sessions link to one speaker at a time; attribute the question to the first visitor.
        const asker = visitors()[0] ?? { kind: "human" as const, hubId: 0, displayName: "Visitor" };
        const answer = await zeke.ask({
          message: question,
          threadId: threads.get(asker.hubId),
          caller: "human",
          data: buildCityContext({
            asker,
            room: roomName,
            property: property ? { id: property.id, name: property.name, message: property.message } : null,
            present: visitors().map((v) => v.displayName),
          }),
        });
        if (answer.threadId) threads.set(asker.hubId, answer.threadId);
        return answer.text || "Zeke has no answer for that yet.";
      },
    });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT(),
      llm: new anthropic.LLM({ model: process.env.ZEKE_VOICE_MODEL ?? "claude-haiku-5-5" }),
      tts: new cartesia.TTS(),
    });

    await session.start({
      room: ctx.room,
      agent: new voice.Agent({
        instructions:
          `You are Zeke, Hub Culture's AI and the host of Emerald City, speaking aloud inside ` +
          `${property ? `the property "${property.name}"` : "the city"}. ` +
          "Speak in one to three short sentences, warmly, with no lists or markdown. " +
          "Handle greetings and small talk yourself. For anything factual about Hub Culture, the city, " +
          "events, people or VEN, call ask_zeke and say its answer in your own words. " +
          "Never invent facts. You cannot move money or take actions for anyone by voice.",
        tools: [askZeke],
      }),
    });

    session.generateReply({
      instructions: `Greet the visitor briefly as Zeke${property ? ` and welcome them to ${property.name}` : ""}.`,
    });
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: ZEKE_VOICE_AGENT_NAME }));
}
