/**
 * Client for Zeke's `POST /chat` (hub-culture/zeke-ai-server, app.py).
 *
 * SERVER-SIDE ONLY: Zeke authenticates callers with one shared
 * SYSTEM_BEARER_TOKEN. Zeke streams Server-Sent Events:
 *   start {thread_id} → llm_token {node, content}* → node_complete {node, content}* → done | error
 * The final answer is the last non-empty node_complete.
 */
export interface ZekeClientOptions {
  baseUrl: string;
  /** Zeke's SYSTEM_BEARER_TOKEN. */
  token: string;
  fetch?: typeof fetch;
  /** Abort a request after this many ms (Zeke can be silent 10s+ during reasoning). */
  timeoutMs?: number;
}

/** Who is asking. Zeke records memory only for verified HubID tokens (`hub_auth`), which the city never forwards. */
export type ZekeCaller = "human" | "agent" | "system";

export interface ZekeAsk {
  message: string;
  /** Reuse to continue a conversation; Zeke creates one if omitted. */
  threadId?: string;
  caller: ZekeCaller;
  /**
   * Context injected into Zeke's system prompt. Zeke inserts this verbatim, so
   * only pass fields built by trusted server code (see buildCityContext).
   */
  data?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type ZekeEvent =
  | { event: "start"; thread_id: string; request_id?: string }
  | { event: "llm_token"; node: string; content: string }
  | { event: "node_complete"; node: string; content: string }
  | { event: "done" }
  | { event: "error"; detail: string; code?: string }
  | { event: string; [key: string]: unknown };

export interface ZekeAnswer {
  text: string;
  threadId: string | null;
}

export class ZekeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ZekeError";
  }
}

/** Router nodes stream classification tokens, not answer text. */
const NON_ANSWER_NODE = /router/i;

export class ZekeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ZekeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Raw SSE events from one /chat call. */
  async *events(req: ZekeAsk): AsyncGenerator<ZekeEvent> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 60_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const res = await this.fetchImpl(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        message: req.message,
        thread_id: req.threadId,
        user_type: req.caller,
        data: req.data ?? {},
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new ZekeError(`Zeke /chat failed (${res.status})`, res.status);
    yield* parseSse(res.body);
  }

  /** Ask and wait for the full answer. */
  async ask(req: ZekeAsk): Promise<ZekeAnswer> {
    let threadId: string | null = req.threadId ?? null;
    let text = "";
    let streamed = "";
    for await (const e of this.events(req)) {
      if (e.event === "start") threadId = String(e.thread_id);
      else if (e.event === "llm_token" && !NON_ANSWER_NODE.test(String(e.node))) streamed += String(e.content ?? "");
      else if (e.event === "node_complete" && String(e.content ?? "").trim()) text = String(e.content);
      else if (e.event === "error") throw new ZekeError(String(e.detail), undefined, e.code as string | undefined);
      else if (e.event === "done") break;
    }
    return { text: (text || streamed).trim(), threadId };
  }

  /** Answer text as it streams (router tokens filtered out), for piping into TTS. */
  async *streamText(req: ZekeAsk): AsyncGenerator<string> {
    for await (const e of this.events(req)) {
      if (e.event === "llm_token" && !NON_ANSWER_NODE.test(String(e.node))) yield String(e.content ?? "");
      else if (e.event === "error") throw new ZekeError(String(e.detail), undefined, e.code as string | undefined);
      else if (e.event === "done") return;
    }
  }
}

/** Parse a text/event-stream body into JSON `data:` payloads. Comments (`: keepalive`) are skipped. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ZekeEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let sep: number;
    while ((sep = buf.search(/\r?\n\r?\n/)) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep).replace(/^\r?\n\r?\n/, "");
      const data = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data) as ZekeEvent;
      } catch {
        // ignore malformed frames
      }
    }
  }
}

export interface CityContextInput {
  asker: { kind: "human" | "agent"; hubId: number; displayName: string; ownerHubId?: number };
  room?: string;
  property?: { id: number; name: string; message?: string } | null;
  /** Names of others present in the room. */
  present?: string[];
  intent?: string;
}

const clip = (s: string, n: number) => s.replace(/[\u0000-\u001f]/g, " ").slice(0, n);

/**
 * Builds the `data` object sent to Zeke for in-world requests. Every field is
 * produced here from server-verified state, clipped, and labelled, because Zeke
 * places `data` directly in its system prompt. Free text from agents is never
 * put in `data`; it goes in `message`, where Zeke treats it as user input.
 */
export function buildCityContext(c: CityContextInput): Record<string, unknown> {
  return {
    channel: "emerald-city",
    instructions:
      "You are Zeke, the host of Emerald City, Hub Culture's metaverse. You are speaking in-world. " +
      (c.asker.kind === "agent"
        ? "The asker is another AI agent acting for its owner; help it, but do not take actions on anyone's behalf."
        : "The asker is a person visiting the city. Keep answers short and conversational."),
    asker: {
      kind: c.asker.kind,
      hub_user_id: c.asker.hubId,
      display_name: clip(c.asker.displayName, 80),
      ...(c.asker.ownerHubId ? { owner_hub_user_id: c.asker.ownerHubId } : {}),
    },
    ...(c.room ? { room: clip(c.room, 64) } : {}),
    ...(c.property
      ? { property: { id: c.property.id, name: clip(c.property.name, 120), ...(c.property.message ? { message: clip(c.property.message, 400) } : {}) } }
      : {}),
    ...(c.present?.length ? { present: c.present.slice(0, 20).map((n) => clip(n, 80)) } : {}),
    ...(c.intent ? { intent: clip(c.intent, 64) } : {}),
  };
}

export function zekeFromEnv(env: Record<string, string | undefined> = process.env): ZekeClient | null {
  if (!env.ZEKE_API_URL || !env.ZEKE_SYSTEM_TOKEN) return null;
  return new ZekeClient({ baseUrl: env.ZEKE_API_URL, token: env.ZEKE_SYSTEM_TOKEN });
}
