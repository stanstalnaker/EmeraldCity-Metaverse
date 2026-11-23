/**
 * Services in the 3D city: People (here now, HubID friends), Wallet (Ven balance, send Ven), Profile,
 * and the Map. In the old vr.hubculture.city these called HubID from the browser with the app's
 * private key; here they go through the beta gate (VITE_GATE_URL), which holds HubID's keys and the
 * member's session. Without a gate (local development) a clearly marked sample stands in.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Ven amounts: two decimals (brand guide, section 04); the Ven lion sits before them. */
const fmtVen = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface Me {
  hubId: number;
  name: string;
  picture: string | null;
  venBalance: number | null;
}
export interface Friend {
  id: number;
  name: string;
  picture: string | null;
}
export interface PersonHere {
  hubId: number;
  name: string;
  kind: "human" | "agent";
  distance: number;
}

/** The member API on the beta gate. */
export class MemberApi {
  constructor(private readonly gate: string | null) {}

  get live() {
    return !!this.gate;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.gate) return sample<T>(path, init);
    const r = await fetch(`${this.gate}/_gate/api/${path}`, { credentials: "include", ...init });
    const body = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(body.error === "signed_out" ? "Sign in with your HubID to use this." : body.error ?? "Something went wrong.");
    return body;
  }

  me() {
    return this.call<Me>("me");
  }
  friends(name?: string) {
    return this.call<{ count: number; items: Friend[] }>(`friends${name ? `?name=${encodeURIComponent(name)}` : ""}`);
  }
  sendVen(to: number, amount: number, message?: string) {
    return this.call<{ ok: boolean; message: string }>("ven/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Action": "send-ven" },
      body: JSON.stringify({ to, amount, message }),
    });
  }
}

/** Local development only: a sample member so the panels can be seen without a gate. */
async function sample<T>(path: string, init: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 150));
  if (path === "me") return { hubId: 1001, name: "Sample Member", picture: null, venBalance: 250 } as T;
  if (path.startsWith("friends")) return { count: 3, items: [{ id: 1002, name: "Ada Admin", picture: null }, { id: 1003, name: "Max Member", picture: null }, { id: 1004, name: "Tess Tester", picture: null }] } as T;
  if (path === "ven/send") {
    const b = JSON.parse(String(init.body)) as { amount: number };
    return { ok: true, message: `Sample: ${b.amount} Ven would be sent (no gate in local development).` } as T;
  }
  throw new Error("not available");
}

type Panel = "people" | "wallet" | "profile";

export function setupServices(o: {
  api: MemberApi;
  /** Everyone in this world now (presence), nearest first. */
  here: () => PersonHere[];
  /** Stand next to someone in this world. */
  goTo: (hubId: number) => boolean;
  /** Where member pages live (hubculture.city on beta). */
  siteUrl: string;
  gateUrl: string | null;
}) {
  let me: Me | null = null;
  let friends: Friend[] = [];
  let tab: "here" | "friends" = "here";
  let sendTo: { id: number; name: string } | null = null;
  const open = new Set<Panel>();

  const show = (p: Panel, on?: boolean) => {
    const want = on ?? !open.has(p);
    for (const other of ["people", "wallet", "profile"] as Panel[]) {
      $(`${other}-panel`).classList.toggle("open", want && other === p);
      if (other !== p || !want) open.delete(other);
    }
    if (want) open.add(p);
    if (want && p === "people") renderPeople();
    if (want && (p === "wallet" || p === "profile")) void loadMe();
    if (want && p === "people" && tab === "friends" && !friends.length) void loadFriends();
  };
  for (const p of ["people", "wallet", "profile"] as Panel[]) {
    $(`${p}-panel`).addEventListener("pointerdown", (e) => e.stopPropagation());
    $(`${p}-panel`).querySelector(".close")?.addEventListener("click", () => show(p, false));
  }
  $("people-btn").onclick = (e) => (e.stopPropagation(), show("people"));
  $("wallet-btn").onclick = (e) => (e.stopPropagation(), show("wallet"));
  $("me").addEventListener("click", (e) => {
    if (o.gateUrl && !me && !$("me").getAttribute("data-signed-in")) return; // the chip links to sign-in
    e.preventDefault();
    e.stopPropagation();
    show("profile");
  });
  window.addEventListener("pointerdown", () => open.forEach((p) => show(p, false)));
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Escape") open.forEach((p) => show(p, false));
    if (e.key === "p" || e.key === "P") show("people");
    if (e.key === "v" || e.key === "V") show("wallet");
  });

  // ---- Me (wallet and profile)
  async function loadMe() {
    try {
      me = await o.api.me();
      $("me").setAttribute("data-signed-in", "1");
    } catch (err) {
      me = null;
      $("wallet-balance").textContent = "—";
      $("profile-body").innerHTML = `<p class="muted">${esc(err instanceof Error ? err.message : String(err))}</p>`;
      return;
    }
    $("wallet-balance").textContent = me.venBalance === null ? "—" : fmtVen(me.venBalance);
    $("profile-body").innerHTML = `
      <div class="profile-head"><span class="avatar">${me.picture ? `<img src="${esc(me.picture)}" alt="">` : esc(initials(me.name))}</span>
        <div><b>${esc(me.name)}</b><small>HubID ${me.hubId}</small></div></div>
      <div class="ven-big"><span class="ven-glyph" aria-hidden="true"></span>${me.venBalance === null ? "—" : fmtVen(me.venBalance)}<small>Ven</small></div>
      <nav class="profile-links">
        <a href="${o.siteUrl}/my-properties" target="_blank" rel="noopener">My properties ↗</a>
        <a href="${o.siteUrl}/investment" target="_blank" rel="noopener">My bonds ↗</a>
        <a href="https://hubculture.com" target="_blank" rel="noopener">Manage HubID ↗</a>
        ${o.gateUrl ? `<a href="${o.gateUrl}/_gate/logout">Sign out</a>` : ""}
      </nav>
      ${o.api.live ? "" : `<p class="muted small">Sample member: local development has no beta gate.</p>`}`;
  }

  // ---- People: here now and HubID friends
  $("people-tabs").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
    if (!b) return;
    tab = b.dataset.tab as typeof tab;
    renderPeople();
    if (tab === "friends" && !friends.length) void loadFriends();
  });
  let searchTimer = 0;
  $<HTMLInputElement>("people-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = (e.target as HTMLInputElement).value;
    searchTimer = window.setTimeout(() => (tab === "friends" ? void loadFriends(q) : renderPeople()), 250);
  });
  $<HTMLInputElement>("people-search").addEventListener("keydown", (e) => e.stopPropagation());

  async function loadFriends(q?: string) {
    $("people-list").innerHTML = `<p class="muted">Loading your friends…</p>`;
    try {
      friends = (await o.api.friends(q && q.trim().length >= 2 ? q : undefined)).items;
      renderPeople();
    } catch (err) {
      $("people-list").innerHTML = `<p class="muted">${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  function renderPeople() {
    document.querySelectorAll<HTMLButtonElement>("#people-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const q = $<HTMLInputElement>("people-search").value.trim().toLowerCase();
    const here = o.here();
    const hereIds = new Set(here.map((p) => p.hubId));
    let rows: string;
    if (tab === "here") {
      const list = here.filter((p) => !q || p.name.toLowerCase().includes(q));
      rows = list.length
        ? list.map((p) => personRow(p.hubId, p.name, p.kind, `${p.distance < 1000 ? Math.round(p.distance) + " m away" : (p.distance / 1000).toFixed(1) + " km away"}`, true)).join("")
        : `<p class="muted">${here.length ? "Nobody matches." : "Nobody else is in this world right now. Your friends are in the Friends tab."}</p>`;
    } else {
      rows = friends.length
        ? friends.map((f) => personRow(f.id, f.name, "human", hereIds.has(f.id) ? "Here now" : "", hereIds.has(f.id), f.picture)).join("")
        : `<p class="muted">No friends to show yet.</p>`;
    }
    $("people-count").textContent = String(here.length);
    $("people-list").innerHTML = rows;
  }

  function personRow(id: number, name: string, kind: "human" | "agent", note: string, canGo: boolean, picture?: string | null) {
    return `<div class="person" data-id="${id}" data-name="${esc(name)}">
      <span class="avatar${kind === "agent" ? " agent" : ""}">${picture ? `<img src="${esc(picture)}" alt="">` : esc(initials(name))}</span>
      <span class="who"><b>${esc(name)}</b><small>${kind === "agent" ? '<i class="ai">AI</i> ' : ""}${esc(note)}</small></span>
      ${canGo ? `<button class="btn mini" data-act="go">Go to</button>` : ""}
      ${kind === "human" ? `<button class="btn mini ven" data-act="ven">Send Ven</button>` : ""}
    </div>`;
  }

  $("people-list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const row = b?.closest<HTMLElement>(".person");
    if (!b || !row) return;
    const id = Number(row.dataset.id);
    if (b.dataset.act === "go") {
      if (o.goTo(id)) show("people", false);
      else b.textContent = "Not here";
    } else {
      sendTo = { id, name: row.dataset.name ?? `HubID ${id}` };
      show("wallet", true);
      prepareSend();
    }
  });

  // ---- Wallet: send Ven
  function prepareSend() {
    $<HTMLInputElement>("send-to").value = sendTo ? sendTo.name : "";
    $("send-result").textContent = "";
    $<HTMLInputElement>(sendTo ? "send-amount" : "send-to").focus();
  }
  for (const id of ["send-to", "send-amount", "send-note"]) $(id).addEventListener("keydown", (e) => e.stopPropagation());
  $("send-to").addEventListener("input", () => (sendTo = null));
  $<HTMLFormElement>("send-form").onsubmit = async (e) => {
    e.preventDefault();
    const result = $("send-result");
    const raw = $<HTMLInputElement>("send-to").value.trim();
    const to = sendTo?.id ?? (/^\d+$/.test(raw) ? Number(raw) : friends.find((f) => f.name.toLowerCase() === raw.toLowerCase())?.id);
    const amount = Number($<HTMLInputElement>("send-amount").value);
    if (!to) return void (result.textContent = "Choose someone from People, or enter their HubID number.");
    if (!(amount > 0)) return void (result.textContent = "Enter an amount of Ven.");
    const btn = $<HTMLButtonElement>("send-btn");
    btn.disabled = true;
    result.textContent = "Sending…";
    try {
      const r = await o.api.sendVen(to, amount, $<HTMLInputElement>("send-note").value.trim() || undefined);
      result.textContent = r.message || `Sent ${fmtVen(amount)} Ven.`;
      result.className = "ok";
      $<HTMLInputElement>("send-amount").value = "";
      $<HTMLInputElement>("send-note").value = "";
      void loadMe();
    } catch (err) {
      result.textContent = err instanceof Error ? err.message : String(err);
      result.className = "err";
    } finally {
      btn.disabled = false;
    }
  };

  // Keep "here now" fresh while the panel is open.
  setInterval(() => open.has("people") && tab === "here" && renderPeople(), 2000);
  return { refreshMe: loadMe };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "·";
}
