/**
 * Damage digits: write-once records in the 256-slot `digits` ring (DIGIT_RECORD). At most MAX_PER_FRAME new
 * numbers per frame (the rest are dropped, so a 1024-hit frame never floods the ring); crits pop larger.
 */
import { DIGIT_RECORD } from '../../shaders/ringLayouts';
import type { RingSink } from '../views/types';

/** Where and how much (HitEvent satisfies it; passed by reference so no double is boxed per digit). */
export interface DigitSource {
  readonly x: number;
  readonly z: number;
  readonly amount: number;
}

function offsetOf(name: string): number {
  for (const a of DIGIT_RECORD.attributes) if (a.name === name) return a.offset;
  throw new Error(`DamageNumbers: DIGIT_RECORD has no ${name}`);
}

const O_D0 = offsetOf('aD0');
const O_D1 = offsetOf('aD1');

export const MAX_DIGITS_PER_FRAME = 24;
export const DIGIT_LIFE = 0.8;
export const CRIT_SCALE = 1.5;

export class DamageNumbers {
  private readonly ring: RingSink;
  private thisFrame = 0;
  enabled = true;

  constructor(ring: RingSink) {
    this.ring = ring;
  }

  /** Returns false when dropped (disabled, per-frame limit, or value < 1). */
  spawn(src: Readonly<DigitSource>, t0: number, tint: number, crit: boolean): boolean {
    if (!this.enabled || this.thisFrame >= MAX_DIGITS_PER_FRAME) return false;
    const v = Math.round(src.amount);
    if (v < 1) return false;
    const o = this.ring.claim();
    const d = this.ring.data;
    d[o + O_D0] = src.x;
    d[o + O_D0 + 1] = 1.6;
    d[o + O_D0 + 2] = src.z;
    d[o + O_D0 + 3] = t0;
    d[o + O_D1] = v > 999999 ? 999999 : v;
    d[o + O_D1 + 1] = crit ? DIGIT_LIFE * 1.25 : DIGIT_LIFE;
    d[o + O_D1 + 2] = tint;
    d[o + O_D1 + 3] = crit ? CRIT_SCALE : 1;
    this.thisFrame++;
    return true;
  }

  commit(): void {
    if (this.thisFrame === 0) return;
    this.ring.commit();
    this.thisFrame = 0;
  }

  reset(): void {
    this.ring.reset();
    this.thisFrame = 0;
  }
}
