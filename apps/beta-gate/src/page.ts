/**
 * The beta sign-in page. Hub Culture's language: deep night navy, the three-colour Hub ring
 * (magenta, indigo, cyan) and Emerald City's emerald, with the faceted gem.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function loginPage(o: { next: string; error?: string; email?: string; csrf: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Emerald City beta · Sign in with HubID</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--night:#050b1f;--navy:#0a1838;--ink:#e8f0ff;--muted:#93a4c8;--emerald:#17c38b;--magenta:#e6007e;--indigo:#322783;--cyan:#009ee3}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font:16px/1.5 Inter,system-ui,sans-serif;color:var(--ink);background:radial-gradient(1200px 700px at 80% -10%,#123a6b55,transparent 60%),radial-gradient(900px 600px at -10% 110%,#0b5d3b55,transparent 60%),var(--night);display:grid;place-items:center;padding:24px}
.facets{position:fixed;inset:0;pointer-events:none;opacity:.18;background:
 conic-gradient(from 210deg at 70% 30%,#0b5d3b 0 12%,transparent 12% 30%,#0a3d6b 30% 41%,transparent 41% 60%,#17c38b 60% 66%,transparent 66%),
 conic-gradient(from 30deg at 20% 80%,#0a3d6b 0 15%,transparent 15% 45%,#0b5d3b 45% 52%,transparent 52%)}
.card{position:relative;width:min(420px,100%);padding:36px 32px 28px;border-radius:20px;background:linear-gradient(180deg,#0e1f47ee,#0a1736ee);box-shadow:0 30px 80px #0008,inset 0 1px 0 #ffffff14}
.card:before{content:"";position:absolute;inset:0;border-radius:20px;padding:1.5px;background:linear-gradient(135deg,var(--magenta),var(--indigo) 50%,var(--cyan));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.gem{width:58px;height:58px;margin:0 auto 14px;display:block}
h1{font:800 22px/1.2 Montserrat,sans-serif;letter-spacing:.14em;text-transform:uppercase;text-align:center;margin:0}
.sub{color:var(--muted);text-align:center;margin:8px 0 26px;font-size:14px}
label{display:block;font-size:13px;color:var(--muted);margin:14px 0 6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2a3d6b;background:#071230;color:var(--ink);font:inherit}
input:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 0 3px #009ee333}
button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;font:700 15px Montserrat,sans-serif;letter-spacing:.06em;color:#fff;cursor:pointer;background:linear-gradient(90deg,#0f9e70,var(--emerald))}
button:hover{filter:brightness(1.08)}
.err{margin-top:16px;padding:10px 12px;border-radius:10px;background:#e6007e1f;border:1px solid #e6007e55;font-size:14px}
.foot{margin-top:22px;text-align:center;font-size:13px;color:var(--muted)}.foot a{color:var(--cyan);text-decoration:none}
.ring{display:flex;justify-content:center;gap:6px;margin-top:18px}.ring i{width:22px;height:3px;border-radius:2px}
</style></head><body><div class="facets"></div>
<main class="card">
<svg class="gem" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ff2c0"/><stop offset=".55" stop-color="#17c38b"/><stop offset="1" stop-color="#0b5d3b"/></linearGradient></defs>
<path d="M20 6h24l14 14v24L44 58H20L6 44V20z" fill="url(#g)"/><path d="M20 6l12 14 12-14M6 20h52M32 20v38M6 44l26-24 26 24" fill="none" stroke="#e8fff6" stroke-opacity=".45" stroke-width="1.2"/></svg>
<h1>Emerald City beta</h1>
<p class="sub">Sign in with your HubID. Beta testers and Hub Culture admins get in.</p>
<form method="post" action="/_gate/login" autocomplete="on">
<input type="hidden" name="next" value="${esc(o.next)}"><input type="hidden" name="csrf" value="${esc(o.csrf)}">
<label for="email">HubID email</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(o.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
<button>Sign in</button>
${o.error ? `<div class="err" role="alert">${esc(o.error)}</div>` : ""}
</form>
<p class="foot">No HubID yet? <a href="https://hubculture.com">Join Hub Culture</a> · Want to test? Ask for <b>Beta Tester</b> access.</p>
<div class="ring"><i style="background:var(--magenta)"></i><i style="background:var(--indigo)"></i><i style="background:var(--cyan)"></i></div>
</main></body></html>`;
}
