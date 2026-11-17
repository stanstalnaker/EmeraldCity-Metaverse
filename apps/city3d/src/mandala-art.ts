import { Color3, DynamicTexture, type Scene } from "@babylonjs/core";
import type { SigilParams } from "@emerald-city/core";

/**
 * Draws a MIP1 Mandala sigil (the same parameters HubID derives) onto a canvas texture: concentric
 * rings of petals (petalsPerRing), a centre star and spokes with the sigil's symmetry, coloured from
 * its hue and saturation, turned by its rotation. Transparent outside the mandala.
 */
export function mandalaTexture(scene: Scene, s: SigilParams, size = 512): DynamicTexture {
  const tex = new DynamicTexture(`mandala-${s.fingerprint.slice(0, 12)}`, { width: size, height: size }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  drawMandala(ctx, s, size);
  tex.update();
  return tex;
}

export function drawMandala(ctx: CanvasRenderingContext2D, s: SigilParams, size: number) {
  const c = size / 2;
  const R = size * 0.48;
  const hsl = (h: number, sat: number, l: number, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${sat}%, ${l}%, ${a})`;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate((s.rotation * Math.PI) / 180);

  // Ground disc.
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = hsl(s.hue, Math.min(60, s.saturation), 10);
  ctx.fill();

  // Spokes: the sigil's symmetry.
  ctx.strokeStyle = hsl(s.hue, s.saturation, 70, 0.35);
  ctx.lineWidth = size * 0.004;
  for (let k = 0; k < s.symmetry * 2; k++) {
    const a = (k * Math.PI) / s.symmetry;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97);
    ctx.stroke();
  }

  // Rings of petals, inside out.
  const inner = R * 0.2;
  const step = (R * 0.95 - inner) / s.rings;
  for (let i = 0; i < s.rings; i++) {
    const n = s.petalsPerRing[i]!;
    const r = inner + step * (i + 0.5);
    const len = step * 0.95;
    const width = Math.min(step * 0.7, ((2 * Math.PI * r) / n) * 0.55);
    const hue = s.hue + i * (150 / s.rings);
    const light = 38 + (i / Math.max(1, s.rings - 1)) * 30;
    const offset = (i % 2) * (Math.PI / n);
    for (let k = 0; k < n; k++) {
      const a = offset + (k * 2 * Math.PI) / n;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(r, 0);
      ctx.beginPath();
      // Teardrop petal pointing outwards.
      ctx.moveTo(-len / 2, 0);
      ctx.quadraticCurveTo(0, -width, len / 2, 0);
      ctx.quadraticCurveTo(0, width, -len / 2, 0);
      ctx.fillStyle = hsl(hue, s.saturation, light, 0.92);
      ctx.fill();
      ctx.lineWidth = size * 0.003;
      ctx.strokeStyle = hsl(hue + 30, s.saturation, Math.min(92, light + 28), 0.9);
      ctx.stroke();
      ctx.restore();
    }
    // Ring line between petal rings.
    ctx.beginPath();
    ctx.arc(0, 0, inner + step * (i + 1), 0, Math.PI * 2);
    ctx.strokeStyle = hsl(hue, s.saturation, 75, 0.45);
    ctx.lineWidth = size * 0.003;
    ctx.stroke();
  }

  // Centre star with `symmetry` points.
  ctx.beginPath();
  for (let k = 0; k <= s.symmetry * 2; k++) {
    const a = (k * Math.PI) / s.symmetry;
    const rr = k % 2 === 0 ? inner * 0.95 : inner * 0.45;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = hsl(s.hue + 40, s.saturation, 70);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, inner * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = hsl(s.hue, 20, 96);
  ctx.fill();

  // Rim.
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.strokeStyle = hsl(s.hue, s.saturation, 65);
  ctx.lineWidth = size * 0.012;
  ctx.stroke();
  ctx.restore();
}

/** A body colour drawn from the sigil, so a person's avatar and mandala belong together. */
export function sigilColour(s: SigilParams): Color3 {
  return Color3.FromHSV(s.hue, Math.min(0.75, s.saturation / 130), 0.62);
}
