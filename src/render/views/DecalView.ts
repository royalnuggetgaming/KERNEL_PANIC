/**
 * Ground decals (one dense batch): telegraph rings/lines with fill progress (transient list from TelegraphEvents),
 * Patch Drone heal areas, and contact-glow blobs under players and bosses (the no-shadow-map grounding).
 * Record: aT = (x, z, yaw, size); aS = (progress 0..1, spawnT (uTime clock), style, seed).
 */
import { DECAL_KIND } from '../../shaders/decal';
import { encodeStyle, TINT } from '../../shaders/tints';
import type { TransientList } from '../fx/TransientList';
import { lerp1, type BatchSink, type FrameContext } from './types';

const PLAYER_GLOW = 2.4;
const BOSS_GLOW_MUL = 1.7;

export class DecalView {
  private readonly batch: BatchSink;

  constructor(batch: BatchSink) {
    this.batch = batch;
  }

  sync(ctx: FrameContext, telegraphs: TransientList): void {
    const b = this.batch;
    const w = ctx.world;
    const a = ctx.alpha;
    const t = ctx.time;
    b.begin();
    for (let i = 0; i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      if (p.life !== 'alive' && p.life !== 'downed') continue;
      const tint = i === 0 ? TINT.P1 : TINT.P2;
      const x = lerp1(p.prevX, p.x, a);
      const z = lerp1(p.prevZ, p.z, a);
      const k = p.life === 'downed' ? 0.5 : 1;
      b.push(x, z, 0, PLAYER_GLOW * k, k, 0, encodeStyle(DECAL_KIND.GLOW, tint), i);
      const sp = p.special;
      if (sp.active && sp.kind === 'patchDrone') {
        const left = sp.duration > 0 ? sp.timer / sp.duration : 0;
        b.push(
          sp.x,
          sp.z,
          0,
          sp.radius,
          left,
          t - (sp.duration - sp.timer),
          encodeStyle(DECAL_KIND.CIRCLE, tint),
          0.5 + i * 0.1,
        );
      }
    }
    const bosses = w.bosses;
    for (let i = 0; i < bosses.length; i++) {
      const boss = bosses[i]!;
      if (!boss.alive) continue;
      b.push(
        lerp1(boss.prevX, boss.x, a),
        lerp1(boss.prevZ, boss.z, a),
        0,
        boss.radius * BOSS_GLOW_MUL,
        1,
        0,
        encodeStyle(DECAL_KIND.GLOW, boss.enraged ? TINT.ELITE : TINT.ENEMY),
        0.2 + i * 0.1,
      );
    }
    for (let i = 0; i < telegraphs.count; i++) {
      const r = telegraphs.items[i]!;
      const prog = r.life > 0 ? (t - r.t0) / r.life : 1;
      if (prog > 1) continue;
      b.push(
        r.x0,
        r.z0,
        r.x1,
        r.size,
        prog < 0 ? 0 : prog,
        r.t0,
        encodeStyle(r.kind, r.tint),
        r.seed,
      );
    }
    b.commit();
  }

  clear(): void {
    this.batch.begin();
    this.batch.commit();
  }
}
