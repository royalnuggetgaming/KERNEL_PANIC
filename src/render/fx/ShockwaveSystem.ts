/**
 * Shockwaves: expanding ground rings in the `shockwaves` ring (SHOCKWAVE_RECORD) plus the 8-slot floor ripple
 * ring in the shared uRipples uniform ((x, z, startTime, strength), cycled round-robin). Allocation-free.
 */
import type { Vector4 } from 'three';
import { SHOCKWAVE_RECORD } from '../../shaders/ringLayouts';
import type { RingSink } from '../views/types';
import type { XZ } from './ParticleSystem';

function offsetOf(name: string): number {
  for (const a of SHOCKWAVE_RECORD.attributes) if (a.name === name) return a.offset;
  throw new Error(`ShockwaveSystem: SHOCKWAVE_RECORD has no ${name}`);
}

const O_W0 = offsetOf('aW0');
const O_W1 = offsetOf('aW1');

export class ShockwaveSystem {
  private readonly ring: RingSink;
  private readonly ripples: readonly Vector4[];
  private rippleHead = 0;
  private pending = 0;

  constructor(ring: RingSink, ripples: readonly Vector4[]) {
    this.ring = ring;
    this.ripples = ripples;
  }

  /** Expanding ring at p (passed by reference: event positions are not boxed per call). */
  spawn(
    p: Readonly<XZ>,
    t0: number,
    life: number,
    maxRadius: number,
    width: number,
    tint: number,
    strength: number,
  ): void {
    const o = this.ring.claim();
    const d = this.ring.data;
    d[o + O_W0] = p.x;
    d[o + O_W0 + 1] = p.z;
    d[o + O_W0 + 2] = t0;
    d[o + O_W0 + 3] = life;
    d[o + O_W1] = maxRadius;
    d[o + O_W1 + 1] = width;
    d[o + O_W1 + 2] = tint;
    d[o + O_W1 + 3] = strength;
    this.pending++;
  }

  /** Floor ripple (grid warp) in the shared uniform ring. */
  ripple(p: Readonly<XZ>, t0: number, strength: number): void {
    const n = this.ripples.length;
    if (n === 0) return;
    const v = this.ripples[this.rippleHead]!;
    v.x = p.x;
    v.y = p.z;
    v.z = t0;
    v.w = strength;
    this.rippleHead = (this.rippleHead + 1) % n;
  }

  commit(): void {
    if (this.pending === 0) return;
    this.ring.commit();
    this.pending = 0;
  }

  reset(): void {
    this.ring.reset();
    this.pending = 0;
    for (let i = 0; i < this.ripples.length; i++) this.ripples[i]!.set(0, 0, -100, 0);
    this.rippleHead = 0;
  }
}
