import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApprovalGate, DEFAULT_APPROVAL_MD, classifyTool, decide, loadPolicy, ruleFor, verifyLog,
  type ApprovalRequest, type Pending,
} from "./index";

const agent = { kind: "agent" as const, hubId: 501, ownerId: 42, name: "Ava" };
const loaded = loadPolicy(DEFAULT_APPROVAL_MD);

describe("policy loading", () => {
  it("loads the Emerald City default", () => {
    expect(loaded.error).toBeUndefined();
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ruleFor(loaded.policy, "ven.send").autonomy).toBe("manual");
  });

  it("loads Edge City's Agent Village template unchanged", () => {
    const md = readFileSync(new URL("./fixtures/agentvillage-APPROVAL.md", import.meta.url), "utf8");
    const av = loadPolicy(md);
    expect(av.error).toBeUndefined();
    expect(ruleFor(av.policy, "intent.publish.inferred.index").autonomy).toBe("manual");
    expect(ruleFor(av.policy, "intent.publish.other.thing")).toMatchObject({ autonomy: "manual", agent_may_request: true });
    expect(ruleFor(av.policy, "policy.core").autonomy).toBe("human-only");
    expect(classifyTool(av.policy, "browser_click").classId).toBe("browser.exec");
    expect(classifyTool(av.policy, "mcp__index__accept_opportunity").classId).toBe("opportunity.accept");
  });

  it("fails closed on a broken or unknown policy", () => {
    for (const md of ["no block here", "```yaml approval-policy\nversion: 1\n```\n", "```yaml approval-policy\nversion: \"0.1\"\nsurprise: true\n```\n"]) {
      const p = loadPolicy(md);
      expect(p.error).toBeTruthy();
      expect(ruleFor(p.policy, "world.move").autonomy).toBe("manual");
    }
  });
});

describe("decisions", () => {
  const req = (origin: ApprovalRequest["origin"], payload = {}): ApprovalRequest => ({ requester: agent, origin, payload });

  it("lets agents live in the world but asks before money or land moves", () => {
    expect(decide(loaded.policy, req({ via: "hook", tool: "city_move" })).outcome).toBe("allow");
    expect(decide(loaded.policy, req({ via: "hook", tool: "hubid_send_ven" })).outcome).toBe("ask");
    expect(decide(loaded.policy, req({ via: "propose", classId: "parcel.claim" })).outcome).toBe("ask");
  });

  it("refuses human-only classes and proposals the class doesn't accept", () => {
    expect(decide(loaded.policy, req({ via: "verb", classId: "city.launch" })).outcome).toBe("deny");
    expect(decide(loaded.policy, req({ via: "propose", classId: "world.move" })).outcome).toBe("deny");
  });

  it("asks for unmapped tools by default", () => {
    expect(decide(loaded.policy, req({ via: "hook", tool: "rm_rf" }))).toMatchObject({ outcome: "ask", classId: "harness.tool.unmapped" });
  });

  it("lets humans act for themselves", () => {
    expect(decide(loaded.policy, { requester: { kind: "human", hubId: 42 }, origin: { via: "verb", classId: "city.launch" }, payload: {} }).outcome).toBe("allow");
  });
});

describe("gate and log", () => {
  it("cards, owner-only answers, expiry and a verifiable chain", async () => {
    const sent: Pending[] = [];
    const gate = new ApprovalGate(loaded, { send: (p) => void sent.push(p) });
    const t0 = 1_000_000;
    const r = await gate.submit({ requester: agent, origin: { via: "propose", classId: "ven.send" },
      payload: { to: "zeke", amount: 10, memo: "parcel fee" }, summary: "pay for the extra parcel" }, t0);
    expect(r.status).toBe("pending");
    expect(sent[0]!.card.title).toBe("Ava wants to send VEN from your account");
    expect(sent[0]!.card.fields).toEqual([
      { label: "To", value: "zeke" }, { label: "Amount (VEN)", value: "10" }, { label: "Memo", value: "parcel fee" },
    ]);
    expect(sent[0]!.card.unverifiedNote).toBe("pay for the extra parcel");

    expect(gate.answer(r.requestId, 999, true, t0 + 1)).toBe(false); // not the owner
    expect(gate.answer(r.requestId, 42, true, t0 + 2)).toBe(true);
    expect(gate.wasGranted(r.requestId)).toBe(true);

    const late = await gate.submit({ requester: agent, origin: { via: "propose", classId: "parcel.claim" }, payload: {} }, t0);
    expect(gate.expire(t0 + 73 * 3600e3)).toEqual([late.requestId]);
    expect(gate.answer(late.requestId, 42, true, t0 + 73 * 3600e3)).toBe(false);

    const entries = [...gate.log.all()];
    expect(entries.map((e) => e.event)).toEqual(["request.asked", "approval.granted", "request.asked", "approval.expired"]);
    expect(entries.every((e) => e.policy_sha256 === loaded.sha256)).toBe(true);
    expect(verifyLog(entries).ok).toBe(true);

    const tampered = entries.map((e) => ({ ...e }));
    tampered[1]!.actor = "human:999";
    expect(verifyLog(tampered)).toMatchObject({ ok: false, badSeq: 1 });
    expect(verifyLog(entries.slice(1)).ok).toBe(false);
  });
});
