/**
 * Continuous (per-frame) emitters: Offline ghost wisps, thruster exhaust, downed sparks, Patch Drone motes and
 * the solo Echo Drone glow. Rates are per second with fractional accumulators, so emission is frame-rate
 * independent. Allocation-free.
 */
import { TINT } from '../../shaders/tints';
import type { FrameContext } from '../views/types';
import type { ParticleSystem } from './ParticleSystem';

const GHOST_RATE = 36;
const THRUST_RATE = 34;
const DOWNED_RATE = 9;
const DRONE_RATE = 18;
const ECHO_RATE = 14;
const THRUST_MIN_SPEED = 2;

/** Accumulator slots: [player0 ghost, thrust, downed, drone, player1 ..., echo]. */
const SLOTS_PER_PLAYER = 4;

export class ContinuousEmitter {
  private readonly acc = new Float32Array(SLOTS_PER_PLAYER * 2 + 1);

  /** Whole particles due this frame for a slot at `rate` per second. */
  private due(slot: number, rate: number, dt: number): number {
    const v = this.acc[slot]! + rate * dt;
    const n = Math.floor(v);
    this.acc[slot] = v - n;
    return n > 16 ? 16 : n;
  }

  /**
   * Particle values go through ps.rec / ps.uniforms() (typed-array scratch), never as double arguments or
   * returns, which a call that is not inlined would box. Draw order matches the fx stream's previous use.
   */
  emit(ps: ParticleSystem, ctx: FrameContext): void {
    const w = ctx.world;
    const dt = ctx.frameDt > 0.1 ? 0.1 : ctx.frameDt;
    const q = ps.rec;
    q[6] = ctx.time;
    for (let i = 0; i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      const base = i * SLOTS_PER_PLAYER;
      q[11] = i === 0 ? TINT.P1 : TINT.P2;
      const a0 = ctx.alpha;
      const x = p.prevX + (p.x - p.prevX) * a0;
      const z = p.prevZ + (p.z - p.prevZ) * a0;
      if (p.life === 'offline') {
        const n = this.due(base, GHOST_RATE, dt);
        for (let k = 0; k < n; k++) {
          const u = ps.uniforms(3);
          const a = u[0]! * Math.PI * 2;
          const r = u[1]! * 0.6;
          q[0] = x + Math.sin(a) * r;
          q[1] = 0.6 + u[2]! * 0.6;
          q[2] = z + Math.cos(a) * r;
          q[3] = 0;
          q[4] = 0.6;
          q[5] = 0;
          q[7] = 0.8;
          q[8] = 0.26;
          q[9] = 1.5;
          q[10] = -1.5;
          ps.emitRec();
        }
      } else if (p.life === 'alive') {
        const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        if (speed > THRUST_MIN_SPEED) {
          const n = this.due(base + 1, THRUST_RATE * Math.min(1, speed / 12), dt);
          const bx = -Math.sin(p.yaw);
          const bz = -Math.cos(p.yaw);
          for (let k = 0; k < n; k++) {
            const j = (ps.uniforms(1)[0]! - 0.5) * 0.5;
            q[0] = x + bx * 0.9 - bz * j;
            q[1] = 0.35;
            q[2] = z + bz * 0.9 + bx * j;
            q[3] = bx * 3;
            q[4] = 0.2;
            q[5] = bz * 3;
            q[7] = 0.25;
            q[8] = 0.14;
            q[9] = 4;
            q[10] = 0;
            ps.emitRec();
          }
        }
      } else if (p.life === 'downed') {
        const n = this.due(base + 2, DOWNED_RATE, dt);
        for (let k = 0; k < n; k++) {
          const u = ps.uniforms(2);
          const a = u[0]! * Math.PI * 2;
          q[0] = x;
          q[1] = 0.3;
          q[2] = z;
          q[3] = Math.sin(a) * 2;
          q[4] = 2.5 + u[1]! * 2;
          q[5] = Math.cos(a) * 2;
          q[7] = 0.5;
          q[8] = 0.12;
          q[9] = 1;
          q[10] = 9;
          ps.emitRec();
        }
      }
      const sp = p.special;
      if (sp.active && sp.kind === 'patchDrone') {
        const n = this.due(base + 3, DRONE_RATE, dt);
        q[11] = TINT.PICKUP;
        for (let k = 0; k < n; k++) {
          const u = ps.uniforms(2);
          const a = u[0]! * Math.PI * 2;
          const r = u[1]! * sp.radius;
          q[0] = sp.x + Math.sin(a) * r;
          q[1] = 0.2;
          q[2] = sp.z + Math.cos(a) * r;
          q[3] = 0;
          q[4] = 1.2;
          q[5] = 0;
          q[7] = 0.9;
          q[8] = 0.16;
          q[9] = 0.5;
          q[10] = -0.5;
          ps.emitRec();
        }
      }
    }
    if (w.link.droneActive) {
      const n = this.due(SLOTS_PER_PLAYER * 2, ECHO_RATE, dt);
      q[11] = TINT.LINK;
      for (let k = 0; k < n; k++) {
        q[0] = w.link.droneX;
        q[1] = 0.7;
        q[2] = w.link.droneZ;
        q[3] = 0;
        q[4] = 0.3;
        q[5] = 0;
        q[7] = 0.35;
        q[8] = 0.2;
        q[9] = 2;
        q[10] = 0;
        ps.emitRec();
      }
    }
  }
}
