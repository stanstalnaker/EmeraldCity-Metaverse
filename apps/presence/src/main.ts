import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { devResolver, hubIdResolver } from "./identity";
import { startPresenceServer } from "./server";

const port = Number(process.env.PRESENCE_PORT ?? 8787);
const secret = process.env.HUBID_JWT_SECRET;

const resolveIdentity = secret
  ? hubIdResolver({ jwtSecret: secret, hubid: hubIdFromEnv() })
  : (console.warn("HUBID_JWT_SECRET not set: using insecure dev identities (human:<id>:<name>)"), devResolver());

startPresenceServer({ port, resolveIdentity });
console.log(`presence listening on ws://localhost:${port}`);
