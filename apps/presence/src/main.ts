import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { devResolver, hubIdRemoteResolver, hubIdResolver, parseServiceKeys, withServiceKeys } from "./identity";
import { liveKitFromEnv } from "./media";
import { startPresenceServer } from "./server";

const port = Number(process.env.PRESENCE_PORT ?? 8787);
const secret = process.env.HUBID_JWT_SECRET;

/**
 * Which HubID verifies tokens. Behind the beta gate people sign in with the real HubID, so presence
 * must check their tokens there too: PRESENCE_HUBID_API_URL (+ _PUBLIC_KEY / _PRIVATE_KEY), falling
 * back to HUBID_*. PRESENCE_VERIFY=hubid checks each token by asking that HubID, with no signing
 * secret on this server; otherwise HUBID_JWT_SECRET verifies tokens locally.
 */
const hubid = hubIdFromEnv({
  HUBID_API_URL: process.env.PRESENCE_HUBID_API_URL ?? process.env.HUBID_API_URL,
  HUBID_PUBLIC_KEY: process.env.PRESENCE_HUBID_PUBLIC_KEY ?? process.env.HUBID_PUBLIC_KEY,
  HUBID_PRIVATE_KEY: process.env.PRESENCE_HUBID_PRIVATE_KEY ?? process.env.HUBID_PRIVATE_KEY,
});
const memberResolver =
  process.env.PRESENCE_VERIFY === "hubid"
    ? hubIdRemoteResolver({ hubid })
    : secret
      ? hubIdResolver({ jwtSecret: secret, hubid })
      : (console.warn("HUBID_JWT_SECRET not set: using insecure dev identities (human:<id>:<name>)"), devResolver());

const media = liveKitFromEnv();
if (!media) console.warn("LIVEKIT_* not set: voice/video disabled");

// House agents (Zeke, concierges) sign in with server-to-server keys: PRESENCE_SERVICE_KEYS=zeke:39:<secret>
const serviceKeys = parseServiceKeys(process.env.PRESENCE_SERVICE_KEYS, Number(process.env.PRESENCE_SERVICE_OWNER ?? 1));
const resolveIdentity = withServiceKeys(serviceKeys, memberResolver);

// Named services agents can address by name, e.g. PRESENCE_SERVICES=zeke:12345 (service keys add theirs)
const services = Object.fromEntries(
  (process.env.PRESENCE_SERVICES ?? "")
    .split(",")
    .map((s) => s.trim().split(":"))
    .filter((kv): kv is [string, string] => kv.length === 2 && Number(kv[1]) > 0)
    .map(([name, id]) => [name, Number(id)]),
);

for (const k of serviceKeys) services[k.name] ??= k.hubId;
startPresenceServer({ port, resolveIdentity, media, services });
console.log(`presence listening on ws://localhost:${port}`);
