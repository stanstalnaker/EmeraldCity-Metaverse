/**
 * MIP1: deterministic Mandala sigil parameters, identical to HubID's App\Mandala\Identity\Mip1Sigil
 * (itself ported from the v2.1 reference identity/mip1.ts). Same input, same sigil everywhere: on
 * hubculture.com beside the QR code, and on avatars in the 3D city.
 *
 *   canonical = "MIP1|" + namespace + "|" + type + "|" + value
 *   bytes     = SHA-256(canonical)
 *   rings         = 3 + b[0] % 5          (3..7)
 *   symmetry      = 4 + b[1] % 9          (4..12)
 *   hue           = (b[2] << 8 | b[3]) % 360
 *   saturation    = 45 + b[4] % 55        (45..99)
 *   rotation      = (b[5] << 8 | b[6]) % 360
 *   petalsPerRing = 6 + b[8 + i] % 18 for each ring i (6..23)
 *
 * A sigil is a picture of an identity, not a credential: it proves nothing.
 */
export interface SigilParams {
  rings: number;
  symmetry: number;
  hue: number;
  saturation: number;
  rotation: number;
  petalsPerRing: number[];
  fingerprint: string;
}

/** Which identity a sigil is drawn from. Agents use their OAI hash (as HubID does). */
export interface SigilIdentity {
  namespace?: string;
  type: "agent" | "user";
  value: string;
}

export function sigilFromDigest(b: Uint8Array): SigilParams {
  const rings = 3 + (b[0]! % 5);
  const petalsPerRing = Array.from({ length: rings }, (_, i) => 6 + (b[8 + i]! % 18));
  return {
    rings,
    symmetry: 4 + (b[1]! % 9),
    hue: ((b[2]! << 8) | b[3]!) % 360,
    saturation: 45 + (b[4]! % 55),
    rotation: ((b[5]! << 8) | b[6]!) % 360,
    petalsPerRing,
    fingerprint: [...b].map((x) => x.toString(16).padStart(2, "0")).join(""),
  };
}

/** Works in browsers and Node 20+ (Web Crypto). */
export async function deriveSigil(id: SigilIdentity): Promise<SigilParams> {
  const canonical = `MIP1|${id.namespace ?? "hubculture"}|${id.type}|${id.value}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return sigilFromDigest(new Uint8Array(digest));
}
