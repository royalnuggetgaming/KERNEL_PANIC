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

export class ParticleSystem {
  private readonly ring: RingSink;
  private readonly rng: Rng;
  private capScale = 1;
  /** Records written since the last commit. */
  pending = 0;

  constructor(ring: RingSink, rng: Rng) {
    this.ring = ring;
    this.rng = rng;
  }

  /** Quality particle cap (Low = 4096 of 8192). */
  setCap(cap: number): void {
    const s = cap / CAPACITY.particles;
    this.capScale = s > 1 ? 1 : s < 0.1 ? 0.1 : s;
  }

  /** Uniform [0, 1) from the fx rng. */
  random(): number {
    return this.rng.next();
  }

  scaledCount(n: number): number {
    const c = Math.round(n * this.capScale);
    return n > 0 && c < 1 ? 1 : c;
  }

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

  /** Radial burst on the ground plane at (x, z). */
  burst(x: number, z: number, y: number, t0: number, s: Readonly<BurstSpec>): void {
    const rng = this.rng;
    const n = this.scaledCount(s.count);
    for (let i = 0; i < n; i++) {
      const ang = rng.next() * Math.PI * 2;
      const sp = rng.range(s.speedMin, s.speedMax);
      const sx = Math.sin(ang);
      const sz = Math.cos(ang);
      const j = rng.next() * s.spread;
      this.emit(
        x + sx * j,
        y,
        z + sz * j,
        sx * sp,
        rng.range(s.upMin, s.upMax),
        sz * sp,
        t0,
        rng.range(s.lifeMin, s.lifeMax),
        s.size * (0.7 + 0.6 * rng.next()),
        s.drag,
        s.gravity,
        s.tint,
      );
    }
  }

  /** Cone burst along (dirX, dirZ) (muzzle flashes, dash streaks, thrusters). */
  cone(
    x: number,
    z: number,
    y: number,
    dirX: number,
    dirZ: number,
    halfAngle: number,
    t0: number,
    s: Readonly<BurstSpec>,
  ): void {
    const rng = this.rng;
    const base = Math.atan2(dirX, dirZ);
    const n = this.scaledCount(s.count);
    for (let i = 0; i < n; i++) {
      const ang = base + (rng.next() * 2 - 1) * halfAngle;
      const sp = rng.range(s.speedMin, s.speedMax);
      const sx = Math.sin(ang);
      const sz = Math.cos(ang);
      this.emit(
        x,
        y,
        z,
        sx * sp,
        rng.range(s.upMin, s.upMax),
        sz * sp,
        t0,
        rng.range(s.lifeMin, s.lifeMax),
        s.size * (0.7 + 0.6 * rng.next()),
        s.drag,
        s.gravity,
        s.tint,
      );
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
}
