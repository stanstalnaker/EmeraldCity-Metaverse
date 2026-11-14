import { randomUUID } from "node:crypto";
import { decide, renderCard, type ApprovalRequest, type Card, type Decision } from "./decide";
import { ApprovalLog, type LogEntry } from "./log";
import type { LoadedPolicy } from "./policy";

export interface Pending {
  id: string;
  request: ApprovalRequest;
  decision: Extract<Decision, { outcome: "ask" }>;
  card: Card;
}

export type Resolution =
  | { status: "allowed"; requestId: string; review?: "retro" }
  | { status: "pending"; requestId: string; card: Card }
  | { status: "denied"; requestId: string; reason: string };

/** Delivers cards to the owner (Telegram, the Hub app, in-world). */
export interface CardChannel {
  send(p: Pending, ownerId: number | undefined): Promise<void> | void;
}

/**
 * The gate one agent owner's requests pass through: judges against the policy, records every
 * outcome, holds manual requests until the owner answers or the TTL runs out.
 */
export class ApprovalGate {
  readonly log: ApprovalLog;
  private pending = new Map<string, Pending>();

  constructor(private loaded: LoadedPolicy, private channel?: CardChannel, existingLog: LogEntry[] = []) {
    this.log = new ApprovalLog(existingLog);
  }

  get policySha(): string {
    return this.loaded.sha256;
  }

  async submit(request: ApprovalRequest, now = Date.now()): Promise<Resolution> {
    const requestId = randomUUID();
    const d = decide(this.loaded.policy, request, now);
    const actor = `${request.requester.kind}:${request.requester.hubId}`;
    const base = { classId: d.classId, actor, requestId, policy_sha256: this.loaded.sha256 };
    if (d.outcome === "allow") {
      this.log.append({ ...base, event: "request.allowed", data: { origin: request.origin, payload: request.payload } });
      if (d.review) this.log.append({ ...base, event: "review.retro" });
      return { status: "allowed", requestId, review: d.review };
    }
    if (d.outcome === "deny") {
      this.log.append({ ...base, event: "request.denied", data: { reason: d.reason } });
      return { status: "denied", requestId, reason: d.reason };
    }
    const card = renderCard(this.loaded.policy, request, d);
    const p: Pending = { id: requestId, request, decision: d, card };
    this.pending.set(requestId, p);
    this.log.append({ ...base, event: "request.asked", data: { origin: request.origin, payload: request.payload, expiresAt: d.expiresAt } });
    await this.channel?.send(p, request.requester.ownerId);
    return { status: "pending", requestId, card };
  }

  /**
   * The owner's answer. `approverHubId` must be the agent's owner: a card answered by anyone else
   * is refused. Returns false if the request is unknown, expired or answered by the wrong person.
   */
  answer(requestId: string, approverHubId: number, approve: boolean, now = Date.now()): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    if (now > p.decision.expiresAt) {
      this.expire(now);
      return false;
    }
    if (p.request.requester.ownerId !== approverHubId) return false;
    this.pending.delete(requestId);
    this.log.append({
      event: approve ? "approval.granted" : "approval.rejected",
      classId: p.decision.classId,
      actor: `human:${approverHubId}`,
      requestId,
      policy_sha256: this.loaded.sha256,
    });
    return true;
  }

  /** Close every request past its TTL (on_expiry: reject, as approval.md defaults). */
  expire(now = Date.now()): string[] {
    const gone: string[] = [];
    for (const [id, p] of this.pending) {
      if (now <= p.decision.expiresAt) continue;
      this.pending.delete(id);
      gone.push(id);
      this.log.append({ event: "approval.expired", classId: p.decision.classId, actor: "system", requestId: id,
        policy_sha256: this.loaded.sha256, data: { on_expiry: this.loaded.policy.defaults.on_expiry } });
    }
    return gone;
  }

  wasGranted(requestId: string): boolean {
    return this.log.all().some((e) => e.requestId === requestId && e.event === "approval.granted");
  }

  listPending(): Pending[] {
    return [...this.pending.values()];
  }
}
