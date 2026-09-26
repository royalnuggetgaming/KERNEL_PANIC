/**
 * Enemies: one dense InstanceBatch per kind (6 draw calls). Interpolated position/yaw; aS = (hit flash, spawnT in
 * the uTime clock (negative = death dissolve start), tint slot ENEMY / ELITE, seed). Allocation-free.
 */
import { ENEMY_KINDS, type EnemyKind } from '../../contracts/ids';
import { TINT } from '../../shaders/tints';
import { lerpAngle } from '../../core/math';
import { lerp1, seed01, type BatchSink, type FrameContext } from './types';

/** Visual scale of CORRUPTED elites. */
export const ELITE_SCALE = 1.2;

export class EnemyView {
  private readonly byKind: BatchSink[] = [];
  private readonly kindIndex: Readonly<Record<EnemyKind, number>>;

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
      const spawnT = e.dying ? -t : t - e.age > 0 ? t - e.age : 0;
      batch.push(
        lerp1(e.prevX, e.x, a),
        lerp1(e.prevZ, e.z, a),
        lerpAngle(e.prevYaw, e.yaw, a),
        e.elite ? ELITE_SCALE : 1,
        flash,
        spawnT,
        e.elite ? TINT.ELITE : TINT.ENEMY,
        seed01(e.seed),
      );
    }
    for (let i = 0; i < b.length; i++) b[i]!.commit();
  }

  clear(): void {
    for (let i = 0; i < this.byKind.length; i++) {
      const batch = this.byKind[i]!;
      batch.begin();
      batch.commit();
    }
  }
}
