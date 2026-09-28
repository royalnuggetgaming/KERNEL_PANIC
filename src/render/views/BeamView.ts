/**
 * Beams (one dense batch): the Link Beam (co-op between interpolated players, solo to the Echo Drone), chain arcs
 * (transient list filled by FxDirector from ArcEvents), boss sweep lasers and Kernel firewall arcs (as chords)
 * with their warm-up telegraph, and the Railburst rail. Record: aT = (ax, az, bx, bz); aS = (width, intensity,
 * style = encodeStyle(BEAM_KIND, tint), seed).
 */
import { COOP } from '../../config/tuning';
import { SIM } from '../../config/tuning';
import { railLength } from '../../config/specials';
import { BEAM_KIND } from '../../shaders/beam';
import { encodeStyle, TINT } from '../../shaders/tints';
import type { TransientList } from '../fx/TransientList';
import { lerp1, seed01, type BatchSink, type FrameContext } from './types';

/** Chords per Kernel firewall arc segment. */
export const ARC_CHORDS = 4;
const ARC_WIDTH = 0.22;

export class BeamView {
  private readonly batch: BatchSink;

  constructor(batch: BatchSink) {
    this.batch = batch;
  }

  sync(ctx: FrameContext, arcs: TransientList): void {
    const b = this.batch;
    const w = ctx.world;
    const a = ctx.alpha;
    b.begin();
    const link = w.link;
    const p0 = w.players[0];
    const p1 = w.players[1];
    if (link.active) {
      const ax = lerp1(p0.prevX, p0.x, a);
      const az = lerp1(p0.prevZ, p0.z, a);
      let bx: number;
      let bz: number;
      if (link.droneActive) {
        bx = link.droneX;
        bz = link.droneZ;
      } else {
        bx = lerp1(p1.prevX, p1.x, a);
        bz = lerp1(p1.prevZ, p1.z, a);
      }
      const intensity = link.cut ? 0.3 : 1 + 0.25 * Math.min(link.latchedCount, 4);
      b.push(ax, az, bx, bz, COOP.LINK_WIDTH, intensity, encodeStyle(BEAM_KIND.LINK, TINT.LINK), 0.37);
    }
    const t = ctx.time;
    for (let i = 0; i < arcs.count; i++) {
      const r = arcs.items[i]!;
      const k = 1 - (t - r.t0) / r.life;
      if (k <= 0) continue;
      b.push(r.x0, r.z0, r.x1, r.z1, ARC_WIDTH, k * 1.5, encodeStyle(BEAM_KIND.ARC, r.tint), r.seed);
    }
    const lasers = w.lasers;
    const back = (1 - a) * SIM.DT;
    for (let i = 0; i < lasers.count; i++) {
      const l = lasers.active[i]!;
      const warm = l.warmup > 0;
      const kind = warm ? BEAM_KIND.LASER_WARN : BEAM_KIND.LASER;
      const style = encodeStyle(kind, TINT.ENEMY_SHOT);
      const intensity = warm ? 0.6 : 1.4;
      const ang = l.angle - l.angularVel * back;
      if (l.shape === 0) {
        const ex = l.x + Math.sin(ang) * l.length;
        const ez = l.z + Math.cos(ang) * l.length;
        b.push(l.x, l.z, ex, ez, l.width, intensity, style, seed01(l.slot));
      } else {
        const step = (l.arcHalf * 2) / ARC_CHORDS;
        let prev = ang - l.arcHalf;
        let px = l.x + Math.sin(prev) * l.radius;
        let pz = l.z + Math.cos(prev) * l.radius;
        for (let c = 0; c < ARC_CHORDS; c++) {
          const next = prev + step;
          const nx = l.x + Math.sin(next) * l.radius;
          const nz = l.z + Math.cos(next) * l.radius;
          b.push(px, pz, nx, nz, l.width, intensity, style, seed01(l.slot * ARC_CHORDS + c));
          prev = next;
          px = nx;
          pz = nz;
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const p = i === 0 ? p0 : p1;
      const sp = p.special;
      if (!sp.active || sp.kind !== 'railburst') continue;
      const len = railLength(sp.x, sp.z, sp.dirX, sp.dirZ);
      const k = sp.duration > 0 ? sp.timer / sp.duration : 0;
      b.push(
        sp.x,
        sp.z,
        sp.x + sp.dirX * len,
        sp.z + sp.dirZ * len,
        sp.radius * 2 * (0.4 + 0.6 * k),
        2.2 * k + 0.4,
        encodeStyle(BEAM_KIND.LASER, i === 0 ? TINT.P1 : TINT.P2),
        0.61 + i * 0.1,
      );
    }
    b.commit();
  }

  clear(): void {
    this.batch.begin();
    this.batch.commit();
  }
}
