/**
 * The 3D client's interface in Hub Culture's language (see index.html): splash, worlds panel,
 * "Go to" places, settings, member chip, fading controls help. Popovers close on Esc or a click
 * outside, and never steal keys from walking.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface WorldCard {
  slug: string;
  name: string;
  blurb: string;
  colors: [string, string];
}

/** The archipelago, in travel order. */
export const WORLD_CARDS: WorldCard[] = [
  { slug: "emerald-city", name: "Emerald City", blurb: "The island city: pavilions, plazas, screens and Zeke at arrival.", colors: ["#17c38b", "#0a3d6b"] },
  { slug: "davos", name: "Davos", blurb: "Real Alpine terrain above Davos Platz, the chalet and the agents' town.", colors: ["#6fb8ff", "#e6f4ff"] },
  { slug: "bermuda", name: "Bermuda", blurb: "The beach house, pool and tennis court on a palm-lined island.", colors: ["#19c6c0", "#ffb37a"] },
];

const TAGLINES: Record<string, string> = Object.fromEntries(WORLD_CARDS.map((w) => [w.slug, w.blurb]));

export function splash(worldSlug: string, worldName: string) {
  $("splash-world").textContent = worldName;
  $("splash-tag").textContent = TAGLINES[worldSlug] ?? "";
  document.title = `${worldName} · Emerald City`;
  return {
    status: (text: string) => ($("splash-status").textContent = text),
    done: () => $("splash").classList.add("gone"),
  };
}

const POPS = ["worlds", "goto", "settings"] as const;
type Pop = (typeof POPS)[number];

function closeAll(except?: Pop) {
  for (const id of POPS) if (id !== except) $(id).classList.remove("open");
}
function toggle(id: Pop) {
  closeAll(id);
  $(id).classList.toggle("open");
}

export function setupUi(o: {
  worldSlug: string;
  travel: (slug: string, name: string) => void;
  places: { label: string; group: string; go: () => void }[];
  gateUrl: string | null;
}) {
  // Popovers
  $("worlds-btn").onclick = (e) => (e.stopPropagation(), toggle("worlds"));
  $("goto-btn").onclick = (e) => (e.stopPropagation(), toggle("goto"));
  $("settings-btn").onclick = (e) => (e.stopPropagation(), toggle("settings"));
  for (const id of POPS) $(id).addEventListener("pointerdown", (e) => e.stopPropagation());
  window.addEventListener("pointerdown", () => closeAll());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "?") helpToggle();
  });

  // Worlds: the archipelago, with the one you're in marked.
  $("worlds-list").innerHTML = WORLD_CARDS.map(
    (w) => `<button class="world${w.slug === o.worldSlug ? " here" : ""}" data-slug="${w.slug}">
      <svg class="thumb" viewBox="0 0 54 54"><defs><linearGradient id="t-${w.slug}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${w.colors[1]}"/><stop offset="1" stop-color="${w.colors[0]}"/></linearGradient></defs>
      <rect width="54" height="54" rx="10" fill="#071230"/><circle cx="27" cy="27" r="17" fill="url(#t-${w.slug})" opacity=".9"/><circle cx="27" cy="27" r="20" fill="none" stroke="${w.colors[0]}" stroke-width="1.5" opacity=".7"/></svg>
      <span><b>${w.name}</b><small>${w.blurb}</small></span>
      <span class="go">${w.slug === o.worldSlug ? "Here" : "Travel"}</span></button>`,
  ).join("");
  $("worlds-list").onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.world");
    const w = WORLD_CARDS.find((c) => c.slug === b?.dataset.slug);
    if (!w || w.slug === o.worldSlug) return;
    closeAll();
    o.travel(w.slug, w.name);
  };

  // Go to: places in this world, grouped.
  const list = $("goto-list");
  if (!o.places.length) $("goto-btn").style.display = "none";
  list.innerHTML = o.places.map((p, i) => `<button data-i="${i}"><span>${escapeHtml(p.label)}</span><small>${escapeHtml(p.group)}</small></button>`).join("");
  list.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    const p = o.places[Number(b?.dataset.i)];
    if (!p) return;
    closeAll();
    p.go();
    $("c").focus();
  };

  // Settings: quality is a reload (it sizes buffers and shadow maps up front).
  const params = new URLSearchParams(location.search);
  const current = params.get("quality") ?? "auto";
  document.querySelectorAll<HTMLButtonElement>("#quality-seg button").forEach((b) => {
    b.classList.toggle("on", b.dataset.q === current);
    b.onclick = () => {
      params.set("quality", b.dataset.q!);
      location.search = params.toString();
    };
  });
  const signout = $<HTMLAnchorElement>("signout");
  if (o.gateUrl) signout.href = `${o.gateUrl}/_gate/logout`;
  else signout.closest(".row")!.remove();

  // Controls help: visible for a first look, then out of the way (? brings it back).
  const help = $("help");
  let timer = window.setTimeout(() => help.classList.add("faded"), 9000);
  function helpToggle() {
    clearTimeout(timer);
    help.classList.toggle("faded");
    if (!help.classList.contains("faded")) timer = window.setTimeout(() => help.classList.add("faded"), 9000);
  }
  $("help-btn").onclick = helpToggle;
}

/** The member chip: who you are in the city (from the beta gate), or a way to sign in. */
export function setMember(m: { name: string } | null, gateUrl: string | null) {
  const a = $<HTMLAnchorElement>("me");
  if (m) {
    $("me-name").textContent = m.name;
    $("me-dot").textContent = initials(m.name);
    a.title = `Signed in with HubID as ${m.name}`;
    a.setAttribute("data-signed-in", "1");
    a.setAttribute("href", "#");
  } else {
    $("me-name").textContent = gateUrl ? "Sign in" : "Guest";
    $("me-dot").textContent = "·";
    if (gateUrl) a.href = `${gateUrl}/_gate/login?next=${encodeURIComponent(location.href)}`;
    else a.removeAttribute("href");
  }
}

/** Dock buttons keep their icon; only the label and state change. */
export function setButton(id: string, label: string, on: boolean) {
  const b = $(id);
  const l = b.querySelector(".label");
  if (l) l.textContent = label;
  b.classList.toggle("on", on);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "·";
}
function escapeHtml(t: string) {
  return t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}
