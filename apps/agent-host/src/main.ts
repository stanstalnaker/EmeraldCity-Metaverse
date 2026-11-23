/**
 * Agent host: runs the Mandala agents listed in AGENTS_FILE in the worlds.
 *
 *   PRESENCE_URL=wss://presence.hubculture.city
 *   AGENTS_FILE=agents.json            definitions (see AgentDef); tokens are the agents' own
 *   BRAIN=zeke | script                 zeke: ZEKE_API_URL + ZEKE_SYSTEM_TOKEN (default when set)
 *   LEDGER=sandbox                      (hubid once agents hold ven:send)
 *   ZEKE_TREASURY_HUBID=39              where thinking is paid
 *   AGENT_API_PORT=8790  AGENT_API_ORIGINS=https://vr.hubculture.city
 *   OWNER_VERIFY=hubid  HUBID_API_URL=...  HUBID_PUBLIC_KEY=...   (dev accepts human:<id> tokens)
 */
import { readFileSync } from "node:fs";
import { SandboxLedger } from "@emerald-city/agents";
import { loadAtlas } from "./atlas";
import { ScriptBrain, ZekeBrain, type Action, type Brain } from "./brain";
import { AgentRuntime, type AgentDef } from "./runtime";
import { devOwners, hubIdOwners, startApi } from "./api";

type FileDef = AgentDef & { openingVen?: number; script?: Action[]; rules?: { floorVen?: number; ceilingVen?: number; loop?: boolean } };

const defs = JSON.parse(readFileSync(process.env.AGENTS_FILE ?? "agents.json", "utf8")) as FileDef[];
const atlas = loadAtlas();
const ledger = new SandboxLedger(Object.fromEntries(defs.map((d) => [d.hubId, d.openingVen ?? 0])));
const zekeUrl = process.env.ZEKE_API_URL, zekeToken = process.env.ZEKE_SYSTEM_TOKEN;
const useZeke = (process.env.BRAIN ?? (zekeUrl && zekeToken ? "zeke" : "script")) === "zeke";
if (useZeke && !(zekeUrl && zekeToken)) throw new Error("BRAIN=zeke needs ZEKE_API_URL and ZEKE_SYSTEM_TOKEN");

const runtimes = new Map<number, AgentRuntime>();
for (const d of defs) {
  const brain: Brain = useZeke ? new ZekeBrain(zekeUrl!, zekeToken!) : new ScriptBrain(d.script ?? [], d.rules);
  const rt = new AgentRuntime(d, {
    atlas,
    brain,
    ledger,
    presenceUrl: process.env.PRESENCE_URL ?? "ws://localhost:8787",
    zekeTreasury: Number(process.env.ZEKE_TREASURY_HUBID ?? 39),
  });
  runtimes.set(d.hubId, rt.start());
}

startApi({
  port: Number(process.env.AGENT_API_PORT ?? 8790),
  runtimes,
  ledger,
  owners: process.env.OWNER_VERIFY === "hubid" ? hubIdOwners(process.env.HUBID_API_URL!, process.env.HUBID_PUBLIC_KEY!) : devOwners(),
  corsOrigins: (process.env.AGENT_API_ORIGINS ?? "http://localhost:5174").split(",").map((s) => s.trim()),
});
console.log(`agent-host: ${runtimes.size} agents, brain ${useZeke ? "Zeke" : "script"}, ledger ${ledger.mode}, islands with 3D: ${[...atlas.worlds.keys()].join(", ")}`);
