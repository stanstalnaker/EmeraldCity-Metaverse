import { hash53 } from "./cut";

/** Seeded PRNG (sfc32): the same seed always yields the same sequence, in browsers and Node. */
export class Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    const h = hash53(seed);
    this.a = h >>> 0;
    this.b = Math.floor(h / 4294967296) >>> 0;
    this.c = hash53(seed, 1) >>> 0;
    this.d = 1;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
