/**
 * Enemies: one dense InstanceBatch per kind (6 draw calls). Interpolated position/yaw; geometry is authored at
 * world size (instance scale 1 = config radius, hover baked in), so scale = radius / config radius (x ELITE_SCALE
 * for CORRUPTED). aS = (hit flash, spawnT in the uTime clock, tint slot ENEMY / ELITE, seed); a dying enemy gets
 * -(death start time), latched once per slot + spawn sequence so the death dissolve advances. Allocation-free.
 */
import { ENEMY_KINDS, type EnemyKind } from '../../contracts/ids';
import { ENEMY_DEFS } from '../../config/enemies';
import { CAPACITY } from '../../config/tuning';
import { TINT } from '../../shaders/tints';
import { TAU } from '../../core/math';
import { appendRecord, REC, seed01, type BatchSink, type FrameContext } from './types';

/** Visual scale of CORRUPTED elites. */
export const ELITE_SCALE = 1.2;

export class EnemyView {
  private readonly byKind: BatchSink[] = [];
  private readonly kindIndex: Readonly<Record<EnemyKind, number>>;
  /** Per enemy slot: spawn sequence seen and latched death start (uTime clock, -1 = alive). */
  private readonly slotSeq = new Float64Array(CAPACITY.enemies).fill(-1);
  private readonly deathStart = new Float64Array(CAPACITY.enemies).fill(-1);

  constructor(batches: Readonly<Record<`enemy:${EnemyKind}`, BatchSink>>) {
    const idx: Record<string, number> = {};
    for (let i = 0; i < ENEMY_KINDS.length; i++) {
      const k = ENEMY_KINDS[i]!;
      idx[k] = i;
      this.byKind.push(batches[`enemy:${k}`]);
    }
    this.kindIndex = idx as Readonly<Record<EnemyKind, number>>;
  }

  sync(ctx: FrameContext): void {
    const b = this.byKind;
    for (let i = 0; i < b.length; i++) b[i]!.begin();
    const pool = ctx.world.enemies;
    const a = ctx.alpha;
    const t = ctx.time;
    for (let i = 0; i < pool.count; i++) {
      const e = pool.active[i]!;
      const batch = b[this.kindIndex[e.kind]]!;
      const flash = e.flash > 1 ? 1 : e.flash < 0 ? 0 : e.flash;
      let spawnT = t - e.age > 0 ? t - e.age : 0;
      const slot = e.slot;
      if (slot < this.slotSeq.length) {
        if (this.slotSeq[slot] !== e.seq) {
          this.slotSeq[slot] = e.seq;
          this.deathStart[slot] = -1;
        }
        if (e.dying) {
          if (this.deathStart[slot]! < 0) this.deathStart[slot] = t;
          spawnT = -this.deathStart[slot]!;
        }
      } else if (e.dying) {
        spawnT = -t;
      }
      const base = ENEMY_DEFS[e.kind].radius;
      const scale = (base > 0 ? e.radius / base : 1) * (e.elite ? ELITE_SCALE : 1);
      const o = appendRecord(batch);
      if (o < 0) continue;
      const d = batch.data;
      // Interpolation written inline: helper calls with double arguments/returns get boxed when not inlined.
      d[o + REC.X] = e.prevX + (e.x - e.prevX) * a;
      d[o + REC.Z] = e.prevZ + (e.z - e.prevZ) * a;
      let dy = (e.yaw - e.prevYaw) % TAU;
      if (dy <= -Math.PI) dy += TAU;
      else if (dy > Math.PI) dy -= TAU;
      d[o + REC.YAW] = e.prevYaw + dy * a;
      d[o + REC.SCALE] = scale;
      d[o + REC.FLASH] = flash;
      d[o + REC.SPAWN] = spawnT;
      d[o + REC.TINT] = e.elite ? TINT.ELITE : TINT.ENEMY;
      d[o + REC.SEED] = seed01(e.seed);
    }
    for (let i = 0; i < b.length; i++) b[i]!.commit();
  }

  clear(): void {
    this.slotSeq.fill(-1);
    this.deathStart.fill(-1);
    for (let i = 0; i < this.byKind.length; i++) {
      const batch = this.byKind[i]!;
      batch.begin();
      batch.commit();
    }
  }
}
