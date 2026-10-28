# Emerald City beta: notes for Claude

- pnpm workspace, TypeScript everywhere. Workspace packages export TS source directly (no build step); apps/web transpiles them via `transpilePackages`.
- Before committing, run `pnpm typecheck && pnpm test`.
- HubID (`hub/HubID`, PHP/Laravel 5) is the system of record. City properties are HubID **pavilions** with `territory = "Emerald City"`. Don't duplicate HubID data here; extend HubID instead and note it in docs/AGENTS.md or docs/GAIA-MAP.md.
- HubID Public-Key/Private-Key headers are app secrets: only use `@emerald-city/hubid-client` on the server. Never put keys in `apps/vr` or client components.
- Identity in presence is always derived server-side from a verified token. Never trust a client-sent name or id.
- Agents are HubID bot sub-profiles with a human owner (`parent_user_id`). Keep `Actor.kind` visible wherever actors render, so humans can always tell agents from people.
