import { describe, expect, it } from "vitest";
import { crossesPortal } from "./movement";

const p = { to: "davos", label: "Davos", position: [44, 3.6, 384] as [number, number, number] };
const v = (x: number, y: number, z: number) => ({ x, y, z });

describe("crossesPortal", () => {
  it("walking through the opening counts, even in one big step", () => {
    expect(crossesPortal(v(44, 5.3, 380), v(44, 5.3, 384.5), p)).toBe(true);
    expect(crossesPortal(v(44.5, 5.3, 374), v(44.5, 5.3, 393), p)).toBe(true); // sprinting at a low frame rate
    expect(crossesPortal(v(44, 5.3, 390), v(44, 5.3, 383), p)).toBe(true); // from the other side
  });
  it("passing beside, over or under it does not", () => {
    expect(crossesPortal(v(47, 5.3, 380), v(47, 5.3, 388), p)).toBe(false);
    expect(crossesPortal(v(44, 15, 380), v(44, 15, 388), p)).toBe(false);
    expect(crossesPortal(v(44, 3.0, 380), v(44, 3.0, 388), p)).toBe(false);
    expect(crossesPortal(v(40, 5.3, 380), v(40, 5.3, 381), p)).toBe(false);
  });
  it("follows the portal's facing", () => {
    const turned = { ...p, rotationY: Math.PI / 2 }; // opening now faces ±x
    expect(crossesPortal(v(40, 5.3, 384), v(48, 5.3, 384), turned)).toBe(true);
    expect(crossesPortal(v(46.5, 5.3, 380), v(46.5, 5.3, 388), turned)).toBe(false); // walking past it, side-on
  });
  it("flying in at an angle counts", () => {
    expect(crossesPortal(v(42, 9, 378), v(45, 5.5, 386), p)).toBe(true);
  });
});
