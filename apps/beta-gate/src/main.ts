import { hubIdFromEnv } from "@emerald-city/hubid-client";

/**
 * Which HubID people sign in with. Beta runs on staging HubID, but access is meant to come from
 * members' real HubID levels, so the gate can point at a different HubID than the rest of beta:
 * GATE_HUBID_API_URL / GATE_HUBID_PUBLIC_KEY / GATE_HUBID_PRIVATE_KEY, falling back to HUBID_*.
 */
const gateHubId = () =>
  hubIdFromEnv({
    HUBID_API_URL: process.env.GATE_HUBID_API_URL ?? process.env.HUBID_API_URL,
    HUBID_PUBLIC_KEY: process.env.GATE_HUBID_PUBLIC_KEY ?? process.env.HUBID_PUBLIC_KEY,
    HUBID_PRIVATE_KEY: process.env.GATE_HUBID_PRIVATE_KEY ?? process.env.HUBID_PRIVATE_KEY,
  });
import { startGate } from "./server";

const secret = process.env.GATE_SECRET ?? "";
if (secret.length < 32) throw new Error("Set GATE_SECRET (32+ random characters)");
const domain = process.env.GATE_DOMAIN ?? "beta.hubculture.city";

startGate({
  port: Number(process.env.GATE_PORT ?? 8790),
  hubid: gateHubId(),
  secret,
  domain,
  loginOrigin: process.env.GATE_LOGIN_ORIGIN ?? `https://${domain}`,
  extraLevels: (process.env.GATE_LEVELS ?? "").split(",").filter(Boolean),
  ttlSeconds: Number(process.env.GATE_SESSION_HOURS ?? 12) * 3600,
  maxSendVen: Number(process.env.GATE_MAX_SEND_VEN ?? 1000),
});
console.log(`beta gate on :${process.env.GATE_PORT ?? 8790} for *.${domain}, signing in with ${process.env.GATE_HUBID_API_URL ?? process.env.HUBID_API_URL ?? "https://id.hubculture.com"}`);
