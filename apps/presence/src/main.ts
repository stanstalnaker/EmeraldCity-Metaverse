import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { devResolver, hubIdResolver } from "./identity";
import { liveKitFromEnv } from "./media";
import { startPresenceServer } from "./server";

const port = Number(process.env.PRESENCE_PORT ?? 8787);
const secret = process.env.HUBID_JWT_SECRET;

const resolveIdentity = secret
  ? hubIdResolver({ jwtSecret: secret, hubid: hubIdFromEnv() })
  : (console.warn("HUBID_JWT_SECRET not set: using insecure dev identities (human:<id>:<name>)"), devResolver());

const media = liveKitFromEnv();
if (!media) console.warn("LIVEKIT_* not set: voice/video disabled");

// Named services agents can address by name, e.g. PRESENCE_SERVICES=zeke:12345
const services = Object.fromEntries(
  (process.env.PRESENCE_SERVICES ?? "")
    .split(",")
    .map((s) => s.trim().split(":"))
    .filter((kv): kv is [string, string] => kv.length === 2 && Number(kv[1]) > 0)
    .map(([name, id]) => [name, Number(id)]),
);

startPresenceServer({ port, resolveIdentity, media, services });
console.log(`presence listening on ws://localhost:${port}`);
