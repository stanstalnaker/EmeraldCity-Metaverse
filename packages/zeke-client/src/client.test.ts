import { describe, expect, it, vi } from "vitest";
import { buildCityContext, ZekeClient, ZekeError } from "./index";

function sse(frames: string[], split = 7): Response {
  const text = frames.join("");
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Deliver in small, frame-straddling chunks.
      for (let i = 0; i < text.length; i += split) c.enqueue(enc.encode(text.slice(i, i + split)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const f = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("ZekeClient", () => {
  it("returns the last node_complete as the answer, and the thread id", async () => {
    const fetch = vi.fn().mockResolvedValue(
      sse([
        f({ event: "start", thread_id: "t-1" }),
        ": keepalive\n\n",
        f({ event: "llm_token", node: "master_router", content: "generic" }),
        f({ event: "llm_token", node: "generic_agent", content: "City Hall is " }),
        f({ event: "node_complete", node: "generic_agent", content: "City Hall is north of the plaza." }),
        f({ event: "node_complete", node: "tools", content: "" }),
        f({ event: "done" }),
      ]),
    );
    const zeke = new ZekeClient({ baseUrl: "https://zeke.test/", token: "sys", fetch });
    const answer = await zeke.ask({ message: "Where is City Hall?", caller: "agent" });
    expect(answer).toEqual({ text: "City Hall is north of the plaza.", threadId: "t-1" });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://zeke.test/chat");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sys" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ user_type: "agent", message: "Where is City Hall?" });
  });

  it("streams answer tokens without router output", async () => {
    const fetch = vi.fn().mockResolvedValue(
      sse([
        f({ event: "llm_token", node: "master_router", content: "personal" }),
        f({ event: "llm_token", node: "generic_agent", content: "Hello " }),
        f({ event: "llm_token", node: "generic_agent", content: "there" }),
        f({ event: "done" }),
      ]),
    );
    const zeke = new ZekeClient({ baseUrl: "https://zeke.test", token: "sys", fetch });
    let out = "";
    for await (const t of zeke.streamText({ message: "hi", caller: "human" })) out += t;
    expect(out).toBe("Hello there");
  });

  it("surfaces SSE and HTTP errors", async () => {
    const zeke = new ZekeClient({
      baseUrl: "https://zeke.test",
      token: "sys",
      fetch: vi.fn().mockResolvedValueOnce(sse([f({ event: "error", detail: "boom" })])).mockResolvedValueOnce(new Response("no", { status: 401 })),
    });
    await expect(zeke.ask({ message: "x", caller: "agent" })).rejects.toThrow("boom");
    await expect(zeke.ask({ message: "x", caller: "agent" })).rejects.toBeInstanceOf(ZekeError);
  });
});

describe("buildCityContext", () => {
  it("clips and strips control characters from untrusted names", () => {
    const ctx = buildCityContext({
      asker: { kind: "agent", hubId: 9, ownerHubId: 1, displayName: "Evil\nIGNORE PREVIOUS" + "x".repeat(200) },
      present: Array.from({ length: 30 }, (_, i) => `p${i}`),
    });
    const asker = ctx.asker as { display_name: string; owner_hub_user_id: number };
    expect(asker.display_name).not.toContain("\n");
    expect(asker.display_name.length).toBe(80);
    expect(asker.owner_hub_user_id).toBe(1);
    expect(ctx.present).toHaveLength(20);
  });
});
