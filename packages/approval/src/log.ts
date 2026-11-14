import { createHash } from "node:crypto";

/**
 * Append-only, hash-chained approval log. Every entry carries `seq`, the previous entry's hash
 * and the `policy_sha256` it was judged under, so anyone holding the log can prove no entry was
 * changed, dropped or reordered. Mirrors the approval.md log shape; storage is up to the caller.
 */

export type LogEvent =
  | "request.allowed"
  | "request.asked"
  | "request.denied"
  | "approval.granted"
  | "approval.rejected"
  | "approval.expired"
  | "review.retro"
  | "policy.attested";

export interface LogEntry {
  seq: number;
  ts: string;
  event: LogEvent;
  classId: string;
  /** `agent:<hubId>` or `human:<hubId>`. */
  actor: string;
  requestId: string;
  policy_sha256: string;
  data?: Record<string, unknown>;
  prev: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

/** Deterministic JSON: object keys sorted, so the hash doesn't depend on insertion order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

function hashOf(e: Omit<LogEntry, "hash">): string {
  return createHash("sha256").update(canonical(e)).digest("hex");
}

export class ApprovalLog {
  private entries: LogEntry[] = [];

  constructor(existing: LogEntry[] = []) {
    const check = verifyLog(existing);
    if (!check.ok) throw new Error(`log rejected at seq ${check.badSeq}: ${check.reason}`);
    this.entries = [...existing];
  }

  append(e: Omit<LogEntry, "seq" | "ts" | "prev" | "hash"> & { ts?: string }): LogEntry {
    const last = this.entries[this.entries.length - 1];
    const body: Omit<LogEntry, "hash"> = {
      ...e,
      seq: last ? last.seq + 1 : 0,
      ts: e.ts ?? new Date().toISOString(),
      prev: last ? last.hash : GENESIS,
    };
    const entry = { ...body, hash: hashOf(body) };
    this.entries.push(entry);
    return entry;
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  head(): string {
    return this.entries[this.entries.length - 1]?.hash ?? GENESIS;
  }
}

export function verifyLog(entries: readonly LogEntry[]): { ok: true } | { ok: false; badSeq: number; reason: string } {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...body } = entries[i]!;
    if (body.seq !== i) return { ok: false, badSeq: body.seq, reason: "sequence gap" };
    if (body.prev !== prev) return { ok: false, badSeq: i, reason: "broken chain" };
    if (hashOf(body) !== hash) return { ok: false, badSeq: i, reason: "entry altered" };
    prev = hash;
  }
  return { ok: true };
}
