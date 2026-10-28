import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { HubIdError, type HubIdClient } from "@emerald-city/hubid-client";
import { hubid } from "./hubid";

/** httpOnly cookie holding the user's HubID JWT (24h, matching HubID's token TTL). Never readable by browser JS. */
export const SESSION_COOKIE = "ec_hubid";
const MAX_AGE = 24 * 60 * 60;

export interface SessionUser {
  hubId: number;
  name: string;
}

export interface Session {
  user: SessionUser;
  /** HubID client acting as this user. Server-side only. */
  client: HubIdClient;
}

interface HubSelf {
  id: number;
  name?: string;
  first?: string;
  last?: string;
}

export async function setSessionToken(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Verified against HubID once per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const client = hubid.withToken(token);
  try {
    const self = await client.getSelf<HubSelf>();
    const name = self.name || [self.first, self.last].filter(Boolean).join(" ") || `HubID ${self.id}`;
    return { user: { hubId: Number(self.id), name }, client };
  } catch (err) {
    if (err instanceof HubIdError && err.status >= 400 && err.status < 500) return null; // expired or revoked
    throw err;
  }
});
