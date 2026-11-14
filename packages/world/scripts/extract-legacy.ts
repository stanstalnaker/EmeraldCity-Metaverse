/**
 * Imports Emerald City from the legacy vr.hubculture.city scene into a world manifest.
 *
 *   pnpm --filter @emerald-city/world extract:legacy /path/to/vr-hubculture-city
 *
 * Parses src/scripts/scenes/demo3t.js with acorn and evaluates ONLY literal data (numbers,
 * strings, arrays, objects, `new BABYLON.Vector3(...)`). No legacy code is executed. Reads the
 * legacy repo; writes data/emerald-city.world.json here. The live site is not touched.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as acorn from "acorn";
import type { ScreenContent, Spawn, TeleportDestination, Vec3, WorldManifest, WorldModel, WorldScreen, WorldZone } from "../src/index";

type Node = acorn.Node & Record<string, any>;

const repo = process.argv[2];
if (!repo) {
  console.error("usage: extract-legacy <path to vr-hubculture-city checkout>");
  process.exit(1);
}
const file = "src/scripts/scenes/demo3t.js";
const src = readFileSync(join(repo, file), "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true }) as Node;

const SKIP = Symbol("skip");
const env: Record<string, unknown> = { genRadius: 555 };

/** Evaluate a literal-only expression; anything else becomes SKIP. */
function evaluate(n: Node | null | undefined): any {
  if (!n) return undefined;
  switch (n.type) {
    case "Literal":
      return n.value;
    case "TemplateLiteral":
      return n.expressions.length === 0 ? n.quasis.map((q: Node) => q.value.cooked).join("") : SKIP;
    case "ArrayExpression":
      return n.elements.map((e: Node) => evaluate(e));
    case "ObjectExpression": {
      const o: Record<string, unknown> = {};
      for (const p of n.properties) {
        if (p.type !== "Property") continue;
        const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
        o[key] = evaluate(p.value);
      }
      return o;
    }
    case "UnaryExpression": {
      const v = evaluate(n.argument);
      if (typeof v !== "number") return SKIP;
      return n.operator === "-" ? -v : n.operator === "+" ? v : SKIP;
    }
    case "BinaryExpression": {
      const a = evaluate(n.left), b = evaluate(n.right);
      if (typeof a !== "number" || typeof b !== "number") return SKIP;
      return ({ "+": a + b, "-": a - b, "*": a * b, "/": a / b } as Record<string, number>)[n.operator] ?? SKIP;
    }
    case "MemberExpression":
      return n.object.name === "Math" && n.property.name === "PI" ? Math.PI : SKIP;
    case "Identifier":
      return n.name in env ? env[n.name] : SKIP;
    case "NewExpression": {
      const c = n.callee;
      if (c.type === "MemberExpression" && c.property.name === "Vector3") {
        const [x, y, z] = n.arguments.map((a: Node) => evaluate(a));
        if ([x, y, z].every((v) => typeof v === "number")) return { x, y, z };
      }
      return SKIP;
    }
    default:
      return SKIP;
  }
}

/** Depth-first walk over every AST node. */
function walk(n: any, visit: (n: Node) => void) {
  if (!n || typeof n.type !== "string") return;
  visit(n);
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit));
    else if (v && typeof v.type === "string") walk(v, visit);
  }
}

let zoneMeshes: any[] = [];
let meshInfo: Record<string, any> = {};
let teleportCoords: Record<string, Vec3> = {};
let sceneArray: any[] = [];
let defaultSpawn: Spawn = { position: { x: 52, y: 3.6, z: 388 }, rotationY: 0 };
const spawns: Record<string, Spawn> = {};

walk(ast, (n) => {
  if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && n.left.object.name === "window") {
    if (n.left.property.name === "zoneMeshes") zoneMeshes = evaluate(n.right);
    if (n.left.property.name === "meshInfo") meshInfo = evaluate(n.right);
  }
  if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
    if (n.id.name === "TELEPORT_COORDS") teleportCoords = evaluate(n.init);
    if (n.id.name === "sceneArray") sceneArray = evaluate(n.init);
    if (n.id.name === "spawnPosition") {
      const p = evaluate(n.init);
      if (p && typeof p === "object" && "x" in p) defaultSpawn = { position: p, rotationY: 0 };
    }
  }
  if (n.type === "SwitchStatement" && n.discriminant.type === "Identifier" && n.discriminant.name === "propertyID") {
    for (const c of n.cases) {
      const key = c.test ? String(evaluate(c.test)) : null;
      if (key === null) continue;
      let position: Vec3 | undefined;
      let rotationY = 0;
      for (const st of c.consequent) {
        if (st.type !== "ExpressionStatement" || st.expression.type !== "AssignmentExpression") continue;
        const target = st.expression.left.name;
        const v = evaluate(st.expression.right);
        if (target === "spawnPosition" && v && typeof v === "object") position = v;
        if (target === "spawnRotationY" && typeof v === "number") rotationY = v;
      }
      // The legacy switch lists '235' twice; the first case wins in JavaScript, so keep the first.
      if (position && !(key in spawns)) spawns[key] = { position, rotationY };
    }
  }
});

// Models: sceneArray entries are [anchor | "", dir, file, scene, callback].
const models: WorldModel[] = [];
for (const entry of sceneArray) {
  if (!Array.isArray(entry)) continue;
  const [anchor, dir, name] = entry as [any, string, string];
  if (typeof dir !== "string" || typeof name !== "string") continue;
  const path = `${dir}${name}`.replace(/^\//, "");
  const base = path.replace(/^models\//, "").replace(/\.babylon$/, "").replace(/\/2$/, "");
  const id = base.replace(/[/_]/g, "-").toLowerCase();
  const hasAnchor = Array.isArray(anchor) && anchor.length >= 4 && anchor.slice(0, 4).every((v: unknown) => typeof v === "number");
  models.push({
    id: models.some((m) => m.id === id) ? `${id}-${models.length}` : id,
    file: path,
    anchor: hasAnchor ? { x: anchor[0], y: anchor[1], z: anchor[2] } : null,
    radius: hasAnchor ? anchor[3] : null,
  });
}

/**
 * A few legacy models are re-placed in their load callbacks (demo3t.js `newCoords`): scale about the
 * origin, rotate by the angle about Y, then translate, which equals one parent transform. Those
 * callbacks are code, not data, so their values are carried here with the source lines.
 */
const TRANSFORMS: Record<string, WorldModel["transform"]> = {
  // demo3t.js:1974-1976 (newCoords with baseCoords [-1450, -0.01, -195], scale 24.801, angle 0)
  "wellness-underwater": { position: { x: -1450, y: -0.01, z: -195 }, scale: 24.801, rotationY: 0 },
  // demo3t.js:2494-2498 (baseCoords [475, 0, 889], scale 25.4, angle 0.33·π/2)
  btg: { position: { x: 475, y: 0, z: 889 }, scale: 25.4, rotationY: (0.33 * Math.PI) / 2 },
  // demo3t.js:1801-1807 (root rotated π/2 about Y, at (1590, 130.5, -92), scale 0.9)
  high3: { position: { x: 1590, y: 130.5, z: -92 }, scale: 0.9, rotationY: Math.PI / 2 },
};
for (const m of models) if (TRANSFORMS[m.id]) m.transform = TRANSFORMS[m.id];

// Screens and zones.
const zones: WorldZone[] = zoneMeshes.map((z) => ({
  pavilionId: Number(z.pav_id),
  pavilionName: String(z.pav_name),
  zoneId: Number(z.id),
  name: String(z.name),
  type: String(z.type),
  mediaScreens: (z.blackScreens ?? []).map(String),
  fileScreens: (z.whiteScreens ?? []).map(String),
}));

const zoneTypeById = new Map(zones.map((z) => [z.zoneId, z.type]));
const screens: WorldScreen[] = [];
const skipped: string[] = [];
for (const [mesh, info] of Object.entries(meshInfo)) {
  let content: ScreenContent | null = null;
  if (info?.type === "link" && typeof info.data === "string") content = { kind: "link", url: info.data };
  else if (info?.type === "html" && typeof info.data === "string") content = { kind: "html", html: info.data };
  else if (info?.type === "hub" && info.info && typeof info.info === "object") {
    const i = info.info;
    content = {
      kind: "zone",
      pavilionId: Number(i.pav_id),
      pavilionName: String(i.pav_name),
      zoneId: Number(i.zone_id),
      zoneName: String(i.name),
      // The legacy object has two \`type\` keys (zone type, then media/file) and the later one wins,
      // so take the zone type from the zone list.
      zoneType: zoneTypeById.get(Number(i.zone_id)) ?? "",
      // The legacy object has two `type` keys; the later one (media/file) wins, as in JavaScript.
      slot: i.color === "white" || i.type === "file" ? "file" : "media",
      index: Number(i.i ?? 0),
      ...(typeof info.data === "string" ? { fallbackUrl: info.data } : {}),
    };
  }
  if (content) screens.push({ mesh, content });
  else skipped.push(mesh);
}

const KIOSK_LABELS: Record<string, string> = {
  arrival_button1: "Cognizant", arrival_button2: "Children's House", arrival_button3: "University", arrival_button4: "Fashion",
  arrival_button5: "Bridging The Gap", arrival_button6: "Beach", arrival_button7: "Memorial", arrival_button8: "Amphitheatre",
  arrival_button9: "Emerald Plaza", arrival_button10: "Lotus", arrival_button11: "City Hall",
};
const teleports: TeleportDestination[] = Object.entries(teleportCoords)
  .filter(([, p]) => p && typeof p === "object" && "x" in p)
  .map(([id, position]) => ({
    id,
    label: KIOSK_LABELS[id] ?? id,
    position,
    group: id.startsWith("arrival_button") ? "kiosk" : /^(button_|f[12]_button|u\d|up|d[a-h]\d?_button|elevator|high_elev)/.test(id) ? "lift" : "other",
  }));

let commit: string | undefined;
try {
  commit = execSync(`git -C "${repo}" rev-parse --short HEAD`, { encoding: "utf8" }).trim();
} catch {
  // not a git checkout
}

const manifest: WorldManifest = {
  version: 1,
  slug: "emerald-city",
  name: "Emerald City",
  source: { repo: "hub/vr-hubculture-city", file, commit, extractedAt: new Date().toISOString().slice(0, 10) },
  models,
  screens,
  zones,
  defaultSpawn,
  spawns,
  teleports,
};
const out = new URL("../data/emerald-city.world.json", import.meta.url);
writeFileSync(out, JSON.stringify(manifest, null, 1) + "\n");
const kinds = screens.reduce<Record<string, number>>((a, s) => ((a[s.content.kind] = (a[s.content.kind] ?? 0) + 1), a), {});
console.log(
  `models ${models.length} · screens ${screens.length} ${JSON.stringify(kinds)} · zones ${zones.length} · spawns ${Object.keys(spawns).length} · teleports ${teleports.length}` +
    (skipped.length ? ` · skipped ${skipped.length}: ${skipped.slice(0, 5).join(", ")}` : ""),
);
