import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

/**
 * The beta access rules, kept in one place for every *.beta.hubculture.city site.
 *
 * Who gets in: HubID super administrators, general administrators and Beta Testers (HubID level 8),
 * plus any extra level names set in GATE_LEVELS. Membership names come from HubID's GET /user
 * (`memberships`, the levels table's names; `sadmin` for super admins).
 */
export const DEFAULT_LEVELS = ["Super Administrators", "General Administrators", "Beta Testers", "Beta Tester"];

export interface Member {
  hubId: number;
  name: string;
  picture: string | null;
  memberships: string[];
  sadmin?: boolean;
}

export function hasBetaAccess(m: Pick<Member, "memberships" | "sadmin">, extraLevels: string[] = []): boolean {
  if (m.sadmin) return true;
  const allowed = new Set([...DEFAULT_LEVELS, ...extraLevels].map((l) => l.trim().toLowerCase()).filter(Boolean));
  return m.memberships.some((n) => allowed.has(n.trim().toLowerCase()));
}

/** Session: an encrypted (A256GCM) JWT holding the member and their HubID token, in one HttpOnly cookie. */
export interface Session {
  hubId: number;
  name: string;
  picture: string | null;
  /** HubID token, so the 3D city can verify presence. Never readable by other sites. */
  token: string;
}

const keyFrom = (secret: string) => createHash("sha256").update(secret, "utf8").digest();

export async function sealSession(s: Session, secret: string, ttlSeconds: number): Promise<string> {
  if (secret.length < 32) throw new Error("GATE_SECRET must be at least 32 characters");
  return new EncryptJWT({ name: s.name, picture: s.picture, tok: s.token })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(String(s.hubId))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(keyFrom(secret));
}

export async function openSession(jwe: string | undefined, secret: string): Promise<Session | null> {
  if (!jwe) return null;
  try {
    const { payload } = await jwtDecrypt(jwe, keyFrom(secret));
    const hubId = Number(payload.sub);
    if (!Number.isInteger(hubId) || hubId <= 0 || typeof payload.tok !== "string") return null;
    return { hubId, name: String(payload.name ?? ""), picture: typeof payload.picture === "string" ? payload.picture : null, token: payload.tok };
  } catch {
    return null;
  }
}

/** Only send people back to a beta site: https and the gate's own domain (beta.hubculture.city or a subdomain). */
export function safeNext(next: string | null | undefined, domain: string, fallback: string): string {
  if (!next) return fallback;
  try {
    const u = new URL(next);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return fallback;
    if (host !== domain && !host.endsWith(`.${domain}`)) return fallback;
    return u.toString();
  } catch {
    return fallback;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
