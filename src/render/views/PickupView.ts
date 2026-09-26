/**
 * Shard pickups: one dense batch (spin and bob happen in the shader). Scale by denomination, blink as a flash
 * square wave after PICKUPS.BLINK_AT, spawn dissolve from age. Record: aT = (x, z, 0, scale); aS = (flash,
 * spawnT (uTime clock), TINT.PICKUP, seed).
 */
import { PICKUPS } from '../../config/tuning';
import { TINT } from '../../shaders/tints';
import { lerp1, seed01, type BatchSink, type FrameContext } from './types';

const BLINK_HZ = 7;

export function pickupScale(value: number): number {
  return value >= 25 ? 1.35 : value >= 5 ? 1.05 : 0.8;
}

export function pickupBlink(age: number): number {
  if (age < PICKUPS.BLINK_AT) return 0;
  return Math.floor(age * BLINK_HZ * 2) % 2 === 0 ? 0.85 : 0;
}

export class PickupView {
  private readonly batch: BatchSink;

  constructor(batch: BatchSink) {
    this.batch = batch;
  }

  sync(ctx: FrameContext): void {
    const b = this.batch;
    b.begin();
    const pool = ctx.world.pickups;
    const a = ctx.alpha;
    const t = ctx.time;
    for (let i = 0; i < pool.count; i++) {
      const p = pool.active[i]!;
      const spawnT = t - p.age;
      b.push(
        lerp1(p.prevX, p.x, a),
        lerp1(p.prevZ, p.z, a),
        0,
        pickupScale(p.value),
        pickupBlink(p.age),
        spawnT > 0 ? spawnT : 0,
        TINT.PICKUP,
        seed01(p.slot),
      );
    }
    b.commit();
  }

  clear(): void {
    this.batch.begin();
    this.batch.commit();
  }
}
