/**
 * Special-ability FX (one distinct read per special, plus the "meter full" pulse), split out of FxDirector:
 * - Railburst: sparks strung along the whole rail (an afterglow that outlives the 0.25 s beam) + muzzle ring.
 * - Firewall: a ring that expands exactly to the dome radius (the protected area) + floor ripple.
 * - Blink Swarm: a burst at the take-off point, a particle streak to the landing point and a landing ring.
 * - Patch Drone: a ring of the heal radius around the drone.
 * - specialReady: a short double ring around the player (a single soft ring with reduce flashes).
 * Allocation-free: positions go through the shared AT object; the per-player landing points are a typed array.
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { SimEvents } from '../../contracts/simEvents';
import { railLength } from '../../config/specials';
import { TINT } from '../../shaders/tints';
import { burstSpec, type ParticleSystem } from './ParticleSystem';
import type { ShockwaveSystem } from './ShockwaveSystem';

const RAIL_SPARKS = 10;
const BLINK_STREAK = 8;
const RAIL = burstSpec(3, 1, 4, 0.55, 0.16, TINT.P1);
const STREAK = burstSpec(2, 0.5, 2, 0.4, 0.2, TINT.P1);
const TAKEOFF = burstSpec(20, 6, 9, 0.45, 0.16, TINT.P1);
const READY = burstSpec(10, 2, 5, 0.4, 0.14, TINT.WHITE);
const AT = { x: 0, z: 0 };
/** [x0, z0, x1, z1]: where each player's 'special' player event (post-blink position) landed this batch. */
const LANDING = new Float64Array(4);
const HAS_LANDING = new Uint8Array(2);

function tintOf(p: PlayerIndex): number {
  return p === 0 ? TINT.P1 : TINT.P2;
}

export interface SpecialFxSinks {
  readonly particles: ParticleSystem;
  readonly shockwaves: ShockwaveSystem;
  trauma(amount: number): void;
}

/** Consumes this frame's special + specialReady events. `rf` = reduce flashes. */
export function consumeSpecialFx(fx: SpecialFxSinks, e: SimEvents, t: number, rf: boolean): void {
  const ps = fx.particles;
  const sw = fx.shockwaves;
  HAS_LANDING[0] = 0;
  HAS_LANDING[1] = 0;
  for (let i = 0; i < e.player.count; i++) {
    const p = e.player.get(i);
    if (p.what === 'special') {
      LANDING[p.player * 2] = p.x;
      LANDING[p.player * 2 + 1] = p.z;
      HAS_LANDING[p.player] = 1;
    } else if (p.what === 'specialReady') {
      AT.x = p.x;
      AT.z = p.z;
      const tint = tintOf(p.player);
      sw.spawn(AT, t, 0.45, 2.4, 0.3, tint, rf ? 0.5 : 1);
      if (!rf) {
        sw.spawn(AT, t, 0.7, 3.6, 0.25, TINT.WHITE, 0.7);
        ps.burst(AT, 0.8, t, READY);
      }
    }
  }
  for (let i = 0; i < e.special.count; i++) {
    const s = e.special.get(i);
    const tint = tintOf(s.player);
    AT.x = s.x;
    AT.z = s.z;
    switch (s.kind) {
      case 'railburst': {
        fx.trauma(rf ? 0.12 : 0.25);
        sw.spawn(AT, t, 0.3, 2.2, 0.35, tint, 1);
        const len = railLength(s.x, s.z, s.dirX, s.dirZ);
        RAIL.tint = tint;
        RAIL.count = rf ? 1 : 3;
        for (let k = 1; k <= RAIL_SPARKS; k++) {
          const d = (len * k) / RAIL_SPARKS;
          AT.x = s.x + s.dirX * d;
          AT.z = s.z + s.dirZ * d;
          ps.burst(AT, 0.6, t, RAIL);
        }
        break;
      }
      case 'firewall':
        sw.spawn(AT, t, 0.45, s.radius, 0.6, TINT.ACCENT, 1);
        sw.ripple(AT, t, rf ? 0.3 : 0.7);
        break;
      case 'blinkSwarm': {
        TAKEOFF.tint = tint;
        TAKEOFF.count = rf ? 10 : 20;
        ps.burst(AT, 0.6, t, TAKEOFF);
        sw.spawn(AT, t, 0.35, s.radius, 0.3, tint, 0.7);
        if (HAS_LANDING[s.player] === 0) break;
        const lx = LANDING[s.player * 2]!;
        const lz = LANDING[s.player * 2 + 1]!;
        STREAK.tint = tint;
        for (let k = 1; k < BLINK_STREAK; k++) {
          const f = k / BLINK_STREAK;
          AT.x = s.x + (lx - s.x) * f;
          AT.z = s.z + (lz - s.z) * f;
          ps.burst(AT, 0.7, t, STREAK);
        }
        AT.x = lx;
        AT.z = lz;
        sw.spawn(AT, t, 0.3, 1.8, 0.4, TINT.WHITE, 1);
        break;
      }
      case 'patchDrone':
        sw.spawn(AT, t, 0.55, s.radius, 0.35, TINT.PICKUP, 0.8);
        break;
    }
  }
}
