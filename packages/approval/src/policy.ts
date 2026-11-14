import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

/**
 * approval.md compatibility (Edge City Agent Village, MIT).
 *
 * An approval.md file is Markdown with one fenced ```yaml approval-policy block. We read the
 * same block so a HubID agent's policy file can move between Emerald City and an Agent Village
 * without edits. Like core approval.md, a policy we cannot load **fails closed**: every class
 * resolves `manual`.
 */

export type Autonomy = "autonomous" | "manual" | "human-only" | "supervised-retro";
export const AUTONOMY: readonly Autonomy[] = ["autonomous", "manual", "human-only", "supervised-retro"];

export interface ClassRule {
  autonomy: Autonomy;
  /** Lets an agent open a request for this class with `propose`. */
  agent_may_request?: boolean;
}

export interface CardWords {
  does?: string;
  /** Field → label; `null` keeps the field off the card. */
  quote?: Record<string, string | null>;
  note?: "none";
}

export interface ToolMatcher {
  match: string;
  class: string;
}

export interface ApprovalPolicy {
  version: string;
  defaults: {
    autonomy: Autonomy;
    channel?: string;
    approval_ttl: string;
    on_expiry: "reject" | "approve";
    unmapped_tool: "record" | "ask";
  };
  approvers: Record<string, { channels: string[]; senders: Record<string, string> }>;
  channels: Record<string, { prompt?: { say?: Record<string, CardWords> }; [k: string]: unknown }>;
  classes: Record<string, ClassRule>;
  tools: ToolMatcher[];
}

export interface LoadedPolicy {
  policy: ApprovalPolicy;
  /** sha256 of the policy block's exact bytes; stamped on every log entry. */
  sha256: string;
  /** Set when the file was rejected: the policy is then the fail-closed one. */
  error?: string;
}

const KNOWN_TOP = new Set(["version", "defaults", "approvers", "channels", "classes", "tools"]);
export const UNMAPPED_TOOL_CLASS = "harness.tool.unmapped";

export function failClosedPolicy(): ApprovalPolicy {
  return {
    version: "0.1",
    defaults: { autonomy: "manual", approval_ttl: "4m", on_expiry: "reject", unmapped_tool: "ask" },
    approvers: {},
    channels: {},
    classes: {},
    tools: [],
  };
}

/** Pull the ```yaml approval-policy block out of an approval.md file. */
export function extractPolicyBlock(markdown: string): string | null {
  const m = markdown.match(/^```yaml approval-policy[^\n]*\n([\s\S]*?)^```\s*$/m);
  return m ? m[1]! : null;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadPolicy(markdown: string): LoadedPolicy {
  const block = extractPolicyBlock(markdown);
  if (block === null) return { policy: failClosedPolicy(), sha256: sha256(""), error: "no approval-policy block" };
  const digest = sha256(block);
  try {
    return { policy: validate(parseYaml(block)), sha256: digest };
  } catch (e) {
    return { policy: failClosedPolicy(), sha256: digest, error: (e as Error).message };
  }
}

function isAutonomy(v: unknown): v is Autonomy {
  return typeof v === "string" && (AUTONOMY as readonly string[]).includes(v);
}

function validate(raw: unknown): ApprovalPolicy {
  if (!raw || typeof raw !== "object") throw new Error("policy is not a mapping");
  const r = raw as Record<string, any>;
  for (const k of Object.keys(r)) if (!KNOWN_TOP.has(k)) throw new Error(`unknown top-level key: ${k}`);
  if (typeof r.version !== "string") throw new Error("version must be a string");
  const d = r.defaults ?? {};
  if (d.autonomy !== undefined && !isAutonomy(d.autonomy)) throw new Error(`bad defaults.autonomy: ${d.autonomy}`);
  const classes: Record<string, ClassRule> = {};
  for (const [id, rule] of Object.entries<any>(r.classes ?? {})) {
    if (!rule || !isAutonomy(rule.autonomy)) throw new Error(`class ${id}: bad autonomy`);
    if (rule.agent_may_request !== undefined && typeof rule.agent_may_request !== "boolean")
      throw new Error(`class ${id}: agent_may_request must be boolean`);
    classes[id] = { autonomy: rule.autonomy, agent_may_request: rule.agent_may_request };
  }
  const tools: ToolMatcher[] = [];
  for (const t of r.tools ?? []) {
    if (!t || typeof t.match !== "string" || typeof t.class !== "string") throw new Error("tools: each needs match and class");
    tools.push({ match: t.match, class: t.class });
  }
  for (const t of tools)
    if (!resolveRule(classes, t.class)) throw new Error(`tools: ${t.match} maps to unknown class ${t.class}`);
  if (d.approval_ttl !== undefined) parseDuration(String(d.approval_ttl));
  return {
    version: r.version,
    defaults: {
      autonomy: d.autonomy ?? "manual",
      channel: d.channel,
      approval_ttl: String(d.approval_ttl ?? "4m"),
      on_expiry: d.on_expiry === "approve" ? "approve" : "reject",
      unmapped_tool: d.unmapped_tool === "record" ? "record" : "ask",
    },
    approvers: r.approvers ?? {},
    channels: r.channels ?? {},
    classes,
    tools,
  };
}

/** "72h", "4m", "30s", "1d" → milliseconds. */
export function parseDuration(s: string): number {
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) throw new Error(`bad duration: ${s}`);
  const n = Number(m[1]);
  return n * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "ms" | "s" | "m" | "h" | "d"];
}

/** Exact class first, then the longest `prefix.*` row that covers it. */
function resolveRule(classes: Record<string, ClassRule>, id: string): ClassRule | undefined {
  if (classes[id]) return classes[id];
  let best: { len: number; rule: ClassRule } | undefined;
  for (const [k, rule] of Object.entries(classes)) {
    if (!k.endsWith(".*")) continue;
    const prefix = k.slice(0, -1); // keeps the dot
    if (id.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, rule };
  }
  return best?.rule;
}

export function ruleFor(policy: ApprovalPolicy, classId: string): ClassRule {
  return resolveRule(policy.classes, classId) ?? { autonomy: policy.defaults.autonomy };
}

function globToRegExp(glob: string): RegExp {
  return new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

/** The class a tool call is judged under: first matching `tools:` line, else the unmapped class. */
export function classifyTool(policy: ApprovalPolicy, toolName: string): { classId: string; mapped: boolean } {
  for (const t of policy.tools) if (globToRegExp(t.match).test(toolName)) return { classId: t.class, mapped: true };
  return { classId: UNMAPPED_TOOL_CLASS, mapped: false };
}
