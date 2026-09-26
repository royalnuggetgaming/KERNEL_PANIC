/**
 * Projectiles (3 draw calls). Player shots and enemy shots use SPARSE slot-indexed batches: a linear bullet is
 * written once on spawn (origin, heading, speed, spawn sim time) and extrapolated in the vertex shader from
 * uSimTime; it is rewritten only when its velocity changes (bounce) and zeroed (radius 0) on despawn. Homing shots
 * are rewritten every frame with speed 0. Missiles and mines go to the dense `missiles` batch every frame.
 * Record: aT = (x, z, heading, speed); aS = (radius, spawn sim time, tint slot, seed). Allocation-free.
 */
import { NO_HANDLE } from '../../contracts/ids';
import { PROJECTILE_KINDS, type PoolView, type ProjectileEntity } from '../../contracts/sim';
import { SOURCE_LINK, type DamageSource } from '../../contracts/simEvents';
import { TINT } from '../../shaders/tints';
import { lerp1, seed01, type BatchSink, type FrameContext } from './types';

/** Degenerate record position for zeroed slots (radius 0 already hides them in the shader). */
const FAR = 1e5;

export function projectileTint(owner: DamageSource): number {
  if (owner === 0) return TINT.P1;
  if (owner === 1) return TINT.P2;
  if (owner === SOURCE_LINK) return TINT.LINK;
  return TINT.ENEMY_SHOT;
}

/** True for kinds drawn by the dense missiles batch. */
export function isMissileKind(kind: number): boolean {
  return kind === PROJECTILE_KINDS.missile || kind === PROJECTILE_KINDS.mine;
}

/** Slot-indexed write-on-change tracker for one projectile pool. */
export class SparseShotTracker {
  readonly batch: BatchSink;
  /** Sequence written per slot (-1 = empty). */
  private readonly seq: Float64Array;
  private readonly vx: Float32Array;
  private readonly vz: Float32Array;
  private readonly stamp: Uint32Array;
  private live: Int32Array;
  private next: Int32Array;
  private liveCount = 0;
  private frame = 0;
  /** Records written this frame (tests / perf probes). */
  writes = 0;

  constructor(batch: BatchSink) {
    this.batch = batch;
    const n = batch.capacity;
    this.seq = new Float64Array(n).fill(-1);
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.stamp = new Uint32Array(n);
    this.live = new Int32Array(n);
    this.next = new Int32Array(n);
  }

  sync(pool: PoolView<Readonly<ProjectileEntity>>, ctx: FrameContext, skipMissiles: boolean): void {
    const b = this.batch;
    const cap = b.capacity;
    const frame = ++this.frame;
    this.writes = 0;
    let nextCount = 0;
    let top = -1;
    const a = ctx.alpha;
    for (let i = 0; i < pool.count; i++) {
      const p = pool.active[i]!;
      const s = p.slot;
      if (s >= cap) continue;
      if (skipMissiles && isMissileKind(p.kind)) continue;
      this.stamp[s] = frame;
      this.next[nextCount++] = s;
      if (s > top) top = s;
      const tint = projectileTint(p.owner);
      if (p.homing !== NO_HANDLE) {
        b.writeAt(
          s,
          lerp1(p.prevX, p.x, a),
          lerp1(p.prevZ, p.z, a),
          Math.atan2(p.vx, p.vz),
          0,
          p.radius,
          ctx.simTime,
          tint,
          seed01(s),
        );
        // NaN velocity forces a rebase at the current state once homing ends.
        this.seq[s] = p.seq;
        this.vx[s] = Number.NaN;
        this.vz[s] = Number.NaN;
        this.writes++;
        continue;
      }
      if (this.seq[s] !== p.seq) {
        // Fresh spawn in this slot: origin + spawn time, extrapolated on the GPU.
        b.writeAt(
          s,
          p.originX,
          p.originZ,
          Math.atan2(p.vx, p.vz),
          Math.sqrt(p.vx * p.vx + p.vz * p.vz),
          p.radius,
          p.spawnTime,
          tint,
          seed01(s),
        );
        this.seq[s] = p.seq;
        this.vx[s] = p.vx;
        this.vz[s] = p.vz;
        this.writes++;
      } else if (this.vx[s] !== Math.fround(p.vx) || this.vz[s] !== Math.fround(p.vz)) {
        // Velocity changed (bounce/ricochet): rebase at the current sim state.
        b.writeAt(
          s,
          p.x,
          p.z,
          Math.atan2(p.vx, p.vz),
          Math.sqrt(p.vx * p.vx + p.vz * p.vz),
          p.radius,
          ctx.world.time,
          tint,
          seed01(s),
        );
        this.vx[s] = p.vx;
        this.vz[s] = p.vz;
        this.writes++;
      }
    }
    // Zero every slot that was live last frame and is gone now.
    for (let i = 0; i < this.liveCount; i++) {
      const s = this.live[i]!;
      if (this.stamp[s] === frame) continue;
      b.writeAt(s, FAR, FAR, 0, 0, 0, 0, 0, 0);
      this.seq[s] = -1;
      this.writes++;
    }
    const tmp = this.live;
    this.live = this.next;
    this.next = tmp;
    this.liveCount = nextCount;
    b.setCount(top + 1);
    b.commit(false);
  }

  /** Zeroes every live slot (run end). */
  clear(): void {
    const b = this.batch;
    for (let i = 0; i < this.liveCount; i++) {
      const s = this.live[i]!;
      b.writeAt(s, FAR, FAR, 0, 0, 0, 0, 0, 0);
      this.seq[s] = -1;
    }
    this.liveCount = 0;
    b.setCount(0);
    b.commit(false);
  }
}

export interface ProjectileBatches {
  readonly playerShots: BatchSink;
  readonly enemyShots: BatchSink;
  readonly missiles: BatchSink;
}

export class ProjectileView {
  readonly player: SparseShotTracker;
  readonly enemy: SparseShotTracker;
  private readonly missiles: BatchSink;

  constructor(b: ProjectileBatches) {
    this.player = new SparseShotTracker(b.playerShots);
    this.enemy = new SparseShotTracker(b.enemyShots);
    this.missiles = b.missiles;
  }

  sync(ctx: FrameContext): void {
    const w = ctx.world;
    this.player.sync(w.playerShots, ctx, true);
    this.enemy.sync(w.enemyShots, ctx, false);
    const m = this.missiles;
    m.begin();
    const pool = w.playerShots;
    const a = ctx.alpha;
    for (let i = 0; i < pool.count; i++) {
      const p = pool.active[i]!;
      if (!isMissileKind(p.kind)) continue;
      m.push(
        lerp1(p.prevX, p.x, a),
        lerp1(p.prevZ, p.z, a),
        Math.atan2(p.vx, p.vz),
        0,
        p.radius,
        ctx.simTime,
        projectileTint(p.owner),
        seed01(p.slot),
      );
    }
    m.commit();
  }

  clear(): void {
    this.player.clear();
    this.enemy.clear();
    this.missiles.begin();
    this.missiles.commit();
  }
}
