/**
 * Shard pickups: one dense batch (spin and bob happen in the shader). Scale by denomination, blink as a flash
 * square wave after PICKUPS.BLINK_AT, spawn dissolve from age. Record: aT = (x, z, 0, scale); aS = (flash,
 * spawnT (uTime clock), TINT.PICKUP, seed).
 */
import { PICKUPS } from '../../config/tuning';
import { TINT } from '../../shaders/tints';
import { appendRecord, REC, type BatchSink, type FrameContext } from './types';

const BLINK_HZ = 7;

/** Denomination scale (PickupView.sync inlines the same expression). */
export function pickupScale(value: number): number {
  return value >= 25 ? 1.35 : value >= 5 ? 1.05 : 0.8;
}

/** Blink flash (PickupView.sync inlines the same expression). */
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
    const d = b.data;
    // Fields are stored straight into the batch (appendRecord): push()'s eight double arguments, and the doubles
    // returned by lerp1/pickupScale/pickupBlink/seed01, are boxed whenever those calls are not inlined.
    for (let i = 0; i < pool.count; i++) {
      const p = pool.active[i]!;
      const o = appendRecord(b);
      if (o < 0) break;
      const age = p.age;
      const spawnT = t - age;
      const v = p.value;
      d[o + REC.X] = p.prevX + (p.x - p.prevX) * a;
      d[o + REC.Z] = p.prevZ + (p.z - p.prevZ) * a;
      d[o + REC.YAW] = 0;
      d[o + REC.SCALE] = v >= 25 ? 1.35 : v >= 5 ? 1.05 : 0.8;
      d[o + REC.FLASH] = age < PICKUPS.BLINK_AT ? 0 : Math.floor(age * BLINK_HZ * 2) % 2 === 0 ? 0.85 : 0;
      d[o + REC.SPAWN] = spawnT > 0 ? spawnT : 0;
      d[o + REC.TINT] = TINT.PICKUP;
      d[o + REC.SEED] = ((p.slot >>> 0) % 4099) / 4099;
    }
    b.commit();
  }

  clear(): void {
    this.batch.begin();
    this.batch.commit();
  }
}
