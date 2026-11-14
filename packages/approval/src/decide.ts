import { classifyTool, parseDuration, ruleFor, UNMAPPED_TOOL_CLASS, type ApprovalPolicy, type CardWords } from "./policy";

/** Who is acting. Agents are HubID bot sub-profiles; `ownerId` is the human (parent_user_id). */
export interface Requester {
  kind: "human" | "agent";
  hubId: number;
  ownerId?: number;
  name?: string;
}

export type Origin =
  /** A tool call caught by the hook (Hermes `POST /hook/hermes`). */
  | { via: "hook"; tool: string }
  /** The agent asks first (approval.md `propose`). */
  | { via: "propose"; classId: string }
  /** A named verb on the service (`POST /verb/<name>`). */
  | { via: "verb"; classId: string };

export interface ApprovalRequest {
  requester: Requester;
  origin: Origin;
  /** What would happen; shown on the card according to the class's `quote` map. */
  payload: Record<string, unknown>;
  /** The agent's one-line summary. Shown as "not checked". */
  summary?: string;
}

export type Decision =
  | { outcome: "allow"; classId: string; record: true; review?: "retro" }
  | { outcome: "ask"; classId: string; expiresAt: number; approver: string }
  | { outcome: "deny"; classId: string; reason: string };

export function classOf(policy: ApprovalPolicy, origin: Origin): string {
  return origin.via === "hook" ? classifyTool(policy, origin.tool).classId : origin.classId;
}

/**
 * Judge one request. Humans acting for themselves are always allowed (and still recorded);
 * the policy governs what agents do on their behalf.
 */
export function decide(policy: ApprovalPolicy, req: ApprovalRequest, now = Date.now()): Decision {
  const classId = classOf(policy, req.origin);
  if (req.requester.kind === "human") return { outcome: "allow", classId, record: true };

  // Unmapped hooked tools follow defaults.unmapped_tool unless the policy has a row for them.
  const hasRow = policy.classes[classId] !== undefined;
  if (classId === UNMAPPED_TOOL_CLASS && !hasRow) {
    return policy.defaults.unmapped_tool === "record"
      ? { outcome: "allow", classId, record: true }
      : ask(policy, classId, now);
  }

  const rule = ruleFor(policy, classId);
  if (req.origin.via === "propose" && !rule.agent_may_request)
    return { outcome: "deny", classId, reason: "class does not accept agent proposals" };

  switch (rule.autonomy) {
    case "autonomous":
      return { outcome: "allow", classId, record: true };
    case "supervised-retro":
      return { outcome: "allow", classId, record: true, review: "retro" };
    case "human-only":
      return { outcome: "deny", classId, reason: "human-only: the owner must do this themselves" };
    case "manual":
      return ask(policy, classId, now);
  }
}

function ask(policy: ApprovalPolicy, classId: string, now: number): Decision {
  const approver = Object.keys(policy.approvers)[0] ?? "owner";
  return { outcome: "ask", classId, approver, expiresAt: now + parseDuration(policy.defaults.approval_ttl) };
}

export interface Card {
  title: string;
  /** Labelled fields from the request, in the policy's order. */
  fields: { label: string; value: string }[];
  /** The agent's own summary, marked unverified. */
  unverifiedNote?: string;
  /** Full request for the "Full details" fold. */
  technical: string;
  expiresAt: number;
  /** Fields the request carried but the policy keeps off the card. */
  hidden: string[];
}

/** Render the minimal approval card (approval.md 0.4.1 style). */
export function renderCard(policy: ApprovalPolicy, req: ApprovalRequest, d: Extract<Decision, { outcome: "ask" }>): Card {
  const words = cardWords(policy, d.classId);
  const who = req.requester.name ?? `Agent ${req.requester.hubId}`;
  const technical = JSON.stringify({ class: d.classId, origin: req.origin, payload: req.payload }, null, 2);
  const keys = Object.keys(req.payload);
  const undeclared = !words?.quote || keys.some((k) => !(k in words.quote!));
  if (!words || undeclared) {
    return { title: `${who} wants to use ${d.classId}`, fields: [], technical, expiresAt: d.expiresAt, hidden: keys,
      unverifiedNote: req.summary };
  }
  const fields: Card["fields"] = [];
  const hidden: string[] = [];
  for (const [k, label] of Object.entries(words.quote!)) {
    if (!(k in req.payload)) continue;
    if (label === null) hidden.push(k);
    else fields.push({ label, value: stringify(req.payload[k]) });
  }
  return {
    title: `${who} wants to ${words.does ?? `use ${d.classId}`}`,
    fields,
    unverifiedNote: words.note === "none" ? undefined : req.summary,
    technical,
    expiresAt: d.expiresAt,
    hidden,
  };
}

function cardWords(policy: ApprovalPolicy, classId: string): CardWords | undefined {
  for (const ch of Object.values(policy.channels)) {
    const w = ch.prompt?.say?.[classId];
    if (w) return w;
  }
  return undefined;
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}
