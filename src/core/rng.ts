/**
 * Seeded sfc32 PRNG. Deterministic across runs in the same JS engine. Seeds are expanded with splitmix32.
 */
import type { Rng } from '../contracts/sim';
import { fnv1a, fnv1aMixU32 } from './hash';

function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

class Sfc32 implements Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const st = { s: this.seed };
    this.a = splitmix32(st);
    this.b = splitmix32(st);
    this.c = splitmix32(st);
    this.d = 1;
    // Warm up so nearby seeds decorrelate.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.nextU32() / 4294967296;
  }

  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('Rng.pick: empty array');
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  weightedPick(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!;
      if (w > 0) total += w;
    }
    if (!(total > 0)) throw new RangeError('Rng.weightedPick: weights must have a positive sum');
    let r = this.next() * total;
    let last = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!;
      if (w <= 0) continue;
      last = i;
      r -= w;
      if (r < 0) return i;
    }
    return last;
  }

  shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  fork(label: string, ...salts: number[]): Rng {
    let h = fnv1aMixU32(fnv1a(label), this.seed);
    for (const s of salts) h = fnv1aMixU32(h, s | 0);
    return new Sfc32(h);
  }

  getState(out: Uint32Array): void {
    out[0] = this.a >>> 0;
    out[1] = this.b >>> 0;
    out[2] = this.c >>> 0;
    out[3] = this.d >>> 0;
  }

  setState(state: ArrayLike<number>): void {
    if (state.length < 4) throw new RangeError('Rng.setState: need 4 words');
    this.a = state[0]! | 0;
    this.b = state[1]! | 0;
    this.c = state[2]! | 0;
    this.d = state[3]! | 0;
  }
}

/** Creates a seeded generator. Same seed => same sequence; fork() streams depend only on seed + label + salts. */
export function createRng(seed: number): Rng {
  return new Sfc32(seed);
}
