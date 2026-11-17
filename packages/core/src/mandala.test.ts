import { describe, expect, it } from "vitest";
import { deriveSigil } from "./mandala";

// Vectors from hub/HubID hubid_api/tests/Mandala/IdentityTest.php (mip1SigilMatchesTheReferenceImplementation).
describe("MIP1 sigil", () => {
  it("matches HubID and the reference implementation for an OAI hash", async () => {
    expect(await deriveSigil({ type: "agent", value: "oai1_3xq7mhc2l6vkzp4yaw5rdt2ogbnf7e4k" })).toEqual({
      rings: 6, symmetry: 10, hue: 176, saturation: 87, rotation: 215,
      petalsPerRing: [23, 21, 22, 8, 20, 18],
      fingerprint: "0d727130cf6bb73d7d8d22807a549be0c484e3259274ebbb5bae34516792d9da",
    });
  });
  it("matches for a did:key", async () => {
    expect(await deriveSigil({ namespace: "hubculture", type: "agent", value: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" })).toEqual({
      rings: 6, symmetry: 8, hue: 130, saturation: 95, rotation: 90,
      petalsPerRing: [18, 20, 7, 7, 9, 21],
      fingerprint: "9eb8f802d77c1ab9d27a25d96f338390ab8d2bce8c8beba3a2268f588105f592",
    });
  });
});
