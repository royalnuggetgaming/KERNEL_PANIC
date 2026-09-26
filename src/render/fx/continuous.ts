/**
 * Continuous (per-frame) emitters: Offline ghost wisps, thruster exhaust, downed sparks, Patch Drone motes and
 * the solo Echo Drone glow. Rates are per second with fractional accumulators, so emission is frame-rate
 * independent. Allocation-free.
 */
import { TINT } from '../../shaders/tints';
import { lerp1, type FrameContext } from '../views/types';
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

  emit(ps: ParticleSystem, ctx: FrameContext): void {
    const w = ctx.world;
    const dt = ctx.frameDt > 0.1 ? 0.1 : ctx.frameDt;
    const t = ctx.time;
    for (let i = 0; i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      const base = i * SLOTS_PER_PLAYER;
      const tint = i === 0 ? TINT.P1 : TINT.P2;
      const x = lerp1(p.prevX, p.x, ctx.alpha);
      const z = lerp1(p.prevZ, p.z, ctx.alpha);
      if (p.life === 'offline') {
        const n = this.due(base, GHOST_RATE, dt);
        for (let k = 0; k < n; k++) {
          const a = ps.random() * Math.PI * 2;
          const r = ps.random() * 0.6;
          ps.emit(x + Math.sin(a) * r, 0.6 + ps.random() * 0.6, z + Math.cos(a) * r, 0, 0.6, 0, t, 0.8, 0.26, 1.5, -1.5, tint);
        }
      } else if (p.life === 'alive') {
        const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        if (speed > THRUST_MIN_SPEED) {
          const n = this.due(base + 1, THRUST_RATE * Math.min(1, speed / 12), dt);
          const bx = -Math.sin(p.yaw);
          const bz = -Math.cos(p.yaw);
          for (let k = 0; k < n; k++) {
            const j = (ps.random() - 0.5) * 0.5;
            ps.emit(x + bx * 0.9 - bz * j, 0.35, z + bz * 0.9 + bx * j, bx * 3, 0.2, bz * 3, t, 0.25, 0.14, 4, 0, tint);
          }
        }
      } else if (p.life === 'downed') {
        const n = this.due(base + 2, DOWNED_RATE, dt);
        for (let k = 0; k < n; k++) {
          const a = ps.random() * Math.PI * 2;
          ps.emit(x, 0.3, z, Math.sin(a) * 2, 2.5 + ps.random() * 2, Math.cos(a) * 2, t, 0.5, 0.12, 1, 9, tint);
        }
      }
      const sp = p.special;
      if (sp.active && sp.kind === 'patchDrone') {
        const n = this.due(base + 3, DRONE_RATE, dt);
        for (let k = 0; k < n; k++) {
          const a = ps.random() * Math.PI * 2;
          const r = ps.random() * sp.radius;
          ps.emit(sp.x + Math.sin(a) * r, 0.2, sp.z + Math.cos(a) * r, 0, 1.2, 0, t, 0.9, 0.16, 0.5, -0.5, TINT.PICKUP);
        }
      }
    }
    if (w.link.droneActive) {
      const n = this.due(SLOTS_PER_PLAYER * 2, ECHO_RATE, dt);
      for (let k = 0; k < n; k++) {
        ps.emit(w.link.droneX, 0.7, w.link.droneZ, 0, 0.3, 0, t, 0.35, 0.2, 2, 0, TINT.LINK);
      }
    }
  }
}
