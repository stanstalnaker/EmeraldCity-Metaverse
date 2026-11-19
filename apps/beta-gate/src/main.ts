import { hubIdFromEnv } from "@emerald-city/hubid-client";
import { startGate } from "./server";

const secret = process.env.GATE_SECRET ?? "";
if (secret.length < 32) throw new Error("Set GATE_SECRET (32+ random characters)");
const domain = process.env.GATE_DOMAIN ?? "beta.hubculture.city";

startGate({
  port: Number(process.env.GATE_PORT ?? 8790),
  hubid: hubIdFromEnv(),
  secret,
  domain,
  loginOrigin: process.env.GATE_LOGIN_ORIGIN ?? `https://${domain}`,
  extraLevels: (process.env.GATE_LEVELS ?? "").split(",").filter(Boolean),
  ttlSeconds: Number(process.env.GATE_SESSION_HOURS ?? 12) * 3600,
});
console.log(`beta gate on :${process.env.GATE_PORT ?? 8790} for *.${domain}`);
