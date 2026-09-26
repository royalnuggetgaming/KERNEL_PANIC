/**
 * Constant-screen-size player markers (one dense batch, sizes in CSS px). Above camera distance CAMERA.MARKER_DIST
 * each player gets a CAMERA.MARKER_PX chevron in the player colour, easing in; downed players always show a
 * bleed-out arc (co-op/solo) and a revive-progress arc; alive players show dash-recharge and special-charge rings.
 * Record: aT = (x, z, 0, size px); aS = (progress, anchor height u, style, seed). At most 3 markers per player.
 */
import { CAMERA, COOP, OVERDRIVE } from '../../config/tuning';
import type { PlayerEntity } from '../../contracts/sim';
import { MARKER_KIND } from '../../shaders/marker';
import { encodeStyle, TINT } from '../../shaders/tints';
import { lerp1, type BatchSink, type FrameContext } from './types';

const FADE_RATE = 4;
/** Distance over which the chevron eases in above MARKER_DIST. */
const FADE_BAND = 6;
const CHEVRON_HEIGHT = 2.4;
const RING_HEIGHT = 0.3;
const DASH_PX = 30;
const SPECIAL_PX = 40;
const DOWNED_PX = 36;

/** Pure: bleed-out duration for the current down (12 s, -2 s per repeated down this wave, min 6 s). */
export function bleedTotal(downsThisWave: number): number {
  const t = COOP.BLEED_OUT - COOP.BLEED_STEP * Math.max(0, downsThisWave - 1);
  return t > COOP.BLEED_MIN ? t : COOP.BLEED_MIN;
}

/** Pure: revive progress as a 0..1 fraction (reviveProgress is seconds of reviveTime). */
export function reviveFraction(p: Readonly<PlayerEntity>): number {
  const need = p.stats.reviveTime > 0 ? p.stats.reviveTime : COOP.REVIVE_TIME;
  const f = p.reviveProgress / need;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Pure: target chevron visibility for a camera distance (0 below MARKER_DIST, 1 above MARKER_DIST + band). */
export function markerTarget(distance: number): number {
  const f = (distance - CAMERA.MARKER_DIST) / FADE_BAND;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export class MarkerView {
  private readonly batch: BatchSink;
  /** Eased chevron visibility per player. */
  readonly fade = new Float32Array(2);

  constructor(batch: BatchSink) {
    this.batch = batch;
  }

  sync(ctx: FrameContext, cameraDistance: number, reduceMotion: boolean): void {
    const b = this.batch;
    const w = ctx.world;
    const a = ctx.alpha;
    const target = markerTarget(cameraDistance);
    const step = reduceMotion ? 1 : FADE_RATE * ctx.frameDt;
    b.begin();
    for (let i = 0; i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      const tint = i === 0 ? TINT.P1 : TINT.P2;
      const on = p.life === 'alive' || p.life === 'downed';
      const goal = on ? target : 0;
      const f = this.fade[i]!;
      this.fade[i] = f < goal ? Math.min(goal, f + step) : Math.max(goal, f - step);
      if (!on) continue;
      const x = lerp1(p.prevX, p.x, a);
      const z = lerp1(p.prevZ, p.z, a);
      const fade = this.fade[i]!;
      if (fade > 0.01) {
        b.push(x, z, 0, CAMERA.MARKER_PX * (0.6 + 0.4 * fade), fade, CHEVRON_HEIGHT, encodeStyle(MARKER_KIND.CHEVRON, tint), i);
      }
      if (p.life === 'downed') {
        if (w.mode !== 'versus') {
          const bleed = p.bleedLeft / bleedTotal(p.downsThisWave);
          b.push(x, z, 0, DOWNED_PX, bleed < 0 ? 0 : bleed > 1 ? 1 : bleed, RING_HEIGHT, encodeStyle(MARKER_KIND.BLEED, tint), i);
          b.push(x, z, 0, DOWNED_PX * 0.72, reviveFraction(p), RING_HEIGHT, encodeStyle(MARKER_KIND.REVIVE, tint), i);
        }
        continue;
      }
      const cd = p.stats.dashCooldown;
      if (p.dashCooldownLeft > 0 && cd > 0) {
        const prog = 1 - p.dashCooldownLeft / cd;
        b.push(x, z, 0, DASH_PX, prog < 0 ? 0 : prog, RING_HEIGHT, encodeStyle(MARKER_KIND.DASH, tint), i);
      }
      if (p.overdrive > 0) {
        const prog = p.overdrive / OVERDRIVE.MAX;
        b.push(x, z, 0, SPECIAL_PX, prog > 1 ? 1 : prog, RING_HEIGHT, encodeStyle(MARKER_KIND.SPECIAL, tint), i);
      }
    }
    b.commit();
  }

  clear(): void {
    this.fade[0] = 0;
    this.fade[1] = 0;
    this.batch.begin();
    this.batch.commit();
  }
}
