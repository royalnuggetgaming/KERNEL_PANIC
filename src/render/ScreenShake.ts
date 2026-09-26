/**
 * Trauma-based screen shake (plan section 4 SHAKE). Each event adds at most CAMERA.SHAKE_MAX_TRAUMA_PER_EVENT;
 * trauma decays at CAMERA.SHAKE_DECAY per second. Offset = trauma^2 x settings.screenShake x 1D value noise:
 * at most CAMERA.SHAKE_MAX_OFFSET u of x/z translation and CAMERA.SHAKE_MAX_ROLL_DEG of roll. Applied after
 * framing (never feeds the solver). Disabled when reduce motion is on. Deterministic for a given seed and dt
 * sequence; pure (no three), allocation-free.
 */
import { CAMERA } from '../config/tuning';
import { DEG2RAD } from '../core/math';

/** Noise lattice frequency (Hz): fast enough to read as shake, slow enough not to strobe. */
const NOISE_HZ = 17;
const MAX_ROLL = CAMERA.SHAKE_MAX_ROLL_DEG * DEG2RAD;

function hash1(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1] (smoothstep between hashed lattice values). */
export function valueNoise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i, seed);
  const b = hash1(i + 1, seed);
  return a + (b - a) * u;
}

export class ScreenShake {
  /** 0..1. */
  trauma = 0;
  /** Current outputs (world units / radians). */
  offsetX = 0;
  offsetZ = 0;
  roll = 0;
  private time = 0;
  private scale = 1;
  private reduceMotion = false;
  private readonly seed: number;

  constructor(seed = 0x5eed) {
    this.seed = seed | 0;
  }

  /** Adds trauma from one event (clamped per event and in total). Ignores non-positive amounts. */
  add(amount: number): void {
    if (!(amount > 0)) return;
    const a = amount > CAMERA.SHAKE_MAX_TRAUMA_PER_EVENT ? CAMERA.SHAKE_MAX_TRAUMA_PER_EVENT : amount;
    const t = this.trauma + a;
    this.trauma = t > 1 ? 1 : t;
  }

  /** settings.screenShake in [0, 1]. */
  setScale(s: number): void {
    this.scale = s < 0 ? 0 : s > 1 ? 1 : s;
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
    if (on) this.reset();
  }

  reset(): void {
    this.trauma = 0;
    this.offsetX = 0;
    this.offsetZ = 0;
    this.roll = 0;
  }

  /** Advances time, decays trauma and recomputes the offsets. */
  update(dt: number): void {
    if (dt > 0) {
      this.time += dt;
      const t = this.trauma - CAMERA.SHAKE_DECAY * dt;
      this.trauma = t > 0 ? t : 0;
    }
    const k = this.reduceMotion ? 0 : this.trauma * this.trauma * this.scale;
    if (k <= 0) {
      this.offsetX = 0;
      this.offsetZ = 0;
      this.roll = 0;
      return;
    }
    const nt = this.time * NOISE_HZ;
    this.offsetX = k * CAMERA.SHAKE_MAX_OFFSET * valueNoise1(nt, this.seed);
    this.offsetZ = k * CAMERA.SHAKE_MAX_OFFSET * valueNoise1(nt + 101.3, this.seed + 1);
    this.roll = k * MAX_ROLL * valueNoise1(nt + 211.7, this.seed + 2);
  }
}
