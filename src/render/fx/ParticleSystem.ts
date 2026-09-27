/**
 * GPU particles: write-once records in the 8192-slot `particles` ring (shaders/ringLayouts.ts PARTICLE_RECORD);
 * motion and fade are evaluated in the vertex shader. Visual randomness uses the fx rng only (never the sim's).
 * The quality preset's particleCap scales emission counts (Low halves them). Allocation-free.
 */
import type { Rng } from '../../contracts/sim';
import { CAPACITY } from '../../config/tuning';
import { PARTICLE_RECORD } from '../../shaders/ringLayouts';
import type { RingSink } from '../views/types';

function offsetOf(name: string): number {
  for (const a of PARTICLE_RECORD.attributes) if (a.name === name) return a.offset;
  throw new Error(`ParticleSystem: PARTICLE_RECORD has no ${name}`);
}

const O_P0 = offsetOf('aP0');
const O_V0 = offsetOf('aV0');
const O_PX = offsetOf('aPX');

export interface BurstSpec {
  count: number;
  speedMin: number;
  speedMax: number;
  /** Upward speed range added to each particle. */
  upMin: number;
  upMax: number;
  lifeMin: number;
  lifeMax: number;
  size: number;
  drag: number;
  gravity: number;
  tint: number;
  /** Spawn jitter radius (u). */
  spread: number;
}

export function burstSpec(
  count: number,
  speedMin: number,
  speedMax: number,
  life: number,
  size: number,
  tint: number,
): BurstSpec {
  return {
    count,
    speedMin,
    speedMax,
    upMin: 1,
    upMax: 4,
    lifeMin: life * 0.6,
    lifeMax: life,
    size,
    drag: 2.5,
    gravity: 9,
    tint,
    spread: 0.2,
  };
}

/** A ground-plane point (sim events and scratch objects satisfy it; passed by reference, never boxed). */
export interface XZ {
  readonly x: number;
  readonly z: number;
}

/** A point plus a heading (ShotEvent satisfies it). */
export interface Ray extends XZ {
  readonly dirX: number;
  readonly dirZ: number;
}

/** Uniforms drawn per burst/cone particle. */
const DRAWS = 6;

export class ParticleSystem {
  private readonly ring: RingSink;
  /** mulberry32 state, seeded once from the injected fx rng (visual randomness only, never the sim's). */
  private readonly state = new Int32Array(1);
  /** Scratch uniforms in [0, 1): filled in place so no double is returned across a call (no HeapNumbers). */
  private readonly u = new Float64Array(DRAWS);
  private capScale = 1;
  /** Records written since the last commit. */
  pending = 0;

  constructor(ring: RingSink, rng: Rng) {
    this.ring = ring;
    this.state[0] = rng.nextU32() | 0;
  }

  /** Quality particle cap (Low = 4096 of 8192). */
  setCap(cap: number): void {
    const s = cap / CAPACITY.particles;
    this.capScale = s > 1 ? 1 : s < 0.1 ? 0.1 : s;
  }

  /** Uniform [0, 1) from the fx stream (for low-volume emitters). */
  random(): number {
    this.draw(1);
    return this.u[0]!;
  }

  scaledCount(n: number): number {
    const c = Math.round(n * this.capScale);
    return n > 0 && c < 1 ? 1 : c;
  }

  /** One particle from explicit values (continuous emitters: a handful per frame). */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    t0: number,
    life: number,
    size: number,
    drag: number,
    gravity: number,
    tint: number,
  ): void {
    const r = this.ring;
    const o = r.claim();
    const d = r.data;
    d[o + O_P0] = x;
    d[o + O_P0 + 1] = y;
    d[o + O_P0 + 2] = z;
    d[o + O_P0 + 3] = t0;
    d[o + O_V0] = vx;
    d[o + O_V0 + 1] = vy;
    d[o + O_V0 + 2] = vz;
    d[o + O_V0 + 3] = life;
    d[o + O_PX] = size;
    d[o + O_PX + 1] = drag;
    d[o + O_PX + 2] = gravity;
    d[o + O_PX + 3] = tint;
    this.pending++;
  }

  /** Radial burst on the ground plane at p. Writes straight into the ring (hot path: no boxed doubles). */
  burst(p: Readonly<XZ>, y: number, t0: number, s: Readonly<BurstSpec>): void {
    const n = this.scaledCount(s.count);
    const u = this.u;
    const r = this.ring;
    const d = r.data;
    for (let i = 0; i < n; i++) {
      this.draw(DRAWS);
      const ang = u[0]! * Math.PI * 2;
      const sp = s.speedMin + (s.speedMax - s.speedMin) * u[1]!;
      const sx = Math.sin(ang);
      const sz = Math.cos(ang);
      const j = u[2]! * s.spread;
      const o = r.claim();
      d[o + O_P0] = p.x + sx * j;
      d[o + O_P0 + 1] = y;
      d[o + O_P0 + 2] = p.z + sz * j;
      d[o + O_P0 + 3] = t0;
      d[o + O_V0] = sx * sp;
      d[o + O_V0 + 1] = s.upMin + (s.upMax - s.upMin) * u[3]!;
      d[o + O_V0 + 2] = sz * sp;
      d[o + O_V0 + 3] = s.lifeMin + (s.lifeMax - s.lifeMin) * u[4]!;
      d[o + O_PX] = s.size * (0.7 + 0.6 * u[5]!);
      d[o + O_PX + 1] = s.drag;
      d[o + O_PX + 2] = s.gravity;
      d[o + O_PX + 3] = s.tint;
      this.pending++;
    }
  }

  /**
   * Cone burst along the ray's heading from `forward` units ahead of it (muzzle flashes, dash streaks,
   * thrusters). Writes straight into the ring.
   */
  cone(
    ray: Readonly<Ray>,
    forward: number,
    y: number,
    halfAngle: number,
    t0: number,
    s: Readonly<BurstSpec>,
  ): void {
    const base = Math.atan2(ray.dirX, ray.dirZ);
    const x = ray.x + ray.dirX * forward;
    const z = ray.z + ray.dirZ * forward;
    const n = this.scaledCount(s.count);
    const u = this.u;
    const r = this.ring;
    const d = r.data;
    for (let i = 0; i < n; i++) {
      this.draw(DRAWS);
      const ang = base + (u[0]! * 2 - 1) * halfAngle;
      const sp = s.speedMin + (s.speedMax - s.speedMin) * u[1]!;
      const sx = Math.sin(ang);
      const sz = Math.cos(ang);
      const o = r.claim();
      d[o + O_P0] = x;
      d[o + O_P0 + 1] = y;
      d[o + O_P0 + 2] = z;
      d[o + O_P0 + 3] = t0;
      d[o + O_V0] = sx * sp;
      d[o + O_V0 + 1] = s.upMin + (s.upMax - s.upMin) * u[3]!;
      d[o + O_V0 + 2] = sz * sp;
      d[o + O_V0 + 3] = s.lifeMin + (s.lifeMax - s.lifeMin) * u[4]!;
      d[o + O_PX] = s.size * (0.7 + 0.6 * u[5]!);
      d[o + O_PX + 1] = s.drag;
      d[o + O_PX + 2] = s.gravity;
      d[o + O_PX + 3] = s.tint;
      this.pending++;
    }
  }

  commit(): void {
    if (this.pending === 0) return;
    this.ring.commit();
    this.pending = 0;
  }

  reset(): void {
    this.ring.reset();
    this.pending = 0;
  }

  /** Fills u[0..n) with mulberry32 uniforms (integer math on a typed array; nothing escapes as a double). */
  private draw(n: number): void {
    const st = this.state;
    const u = this.u;
    for (let i = 0; i < n; i++) {
      const a = (st[0]! + 0x6d2b79f5) | 0;
      st[0] = a;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      u[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  }
}
