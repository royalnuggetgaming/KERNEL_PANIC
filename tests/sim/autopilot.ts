/**
 * Autopilot-like scripted intents for sim soak/determinism tests: every living player keeps firing. In a
 * 1 s cycle it first steers toward the nearest enemy/boss for 0.25 s (facing follows movement), then holds
 * FOCUS (facing locked) while it is repelled by nearby enemies, enemy bullets and bosses, drifts back toward
 * the arena centre and strafes around the threat. It dashes out of imminent contact and fires the special
 * when the meter is full.
 * Deterministic (reads only the world) and allocation-free per tick.
 */
import type { Intents, PlayerIntent } from '../../src/contracts/input';
import type { PlayerEntity } from '../../src/contracts/sim';
import type { WorldState } from '../../src/contracts/world';
import { OVERDRIVE } from '../../src/config/tuning';
import { createIntents, resetIntent } from '../helpers/scriptedIntents';

const ENEMY_RANGE = 11;
const SHOT_RANGE = 6;
const DASH_RANGE = 2.2;

export class Autopilot {
  readonly intents: [PlayerIntent, PlayerIntent] = createIntents();
  /** Strafe direction per player (flips every few seconds so nobody orbits forever). */
  private readonly strafe = new Float64Array(2);

  constructor() {
    this.strafe[0] = 1;
    this.strafe[1] = -1;
  }

  at(w: WorldState): Intents {
    for (let i = 0; i < 2; i++) this.drive(w, w.players[i === 0 ? 0 : 1], this.intents[i]!, i);
    return this.intents;
  }

  private drive(w: WorldState, p: Readonly<PlayerEntity>, out: PlayerIntent, i: number): void {
    resetIntent(out);
    if (p.life === 'absent') return;
    out.fireHeld = true;
    if (w.tick % 600 === 0) this.strafe[i] = -this.strafe[i]!;
    let fx = 0;
    let fz = 0;
    let danger = false;
    const enemies = w.enemies;
    for (let k = 0; k < enemies.count; k++) {
      const e = enemies.active[k]!;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > ENEMY_RANGE * ENEMY_RANGE || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const wgt = 1 / (d * d);
      fx += (dx / d) * wgt;
      fz += (dz / d) * wgt;
      if (d < DASH_RANGE + e.radius) danger = true;
    }
    for (let b = 0; b < w.bosses.length; b++) {
      const e = w.bosses[b]!;
      if (!e.alive) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.sqrt(dx * dx + dz * dz) + 1e-6;
      if (d > 16) continue;
      const wgt = 4 / (d * d);
      fx += (dx / d) * wgt;
      fz += (dz / d) * wgt;
    }
    const shots = w.enemyShots;
    for (let k = 0; k < shots.count; k++) {
      const s = shots.active[k]!;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > SHOT_RANGE * SHOT_RANGE || d2 < 1e-6) continue;
      // Only bullets moving toward the player matter; dodge perpendicular to their path.
      if (dx * s.vx + dz * s.vz <= 0) continue;
      const d = Math.sqrt(d2);
      const vl = Math.sqrt(s.vx * s.vx + s.vz * s.vz) + 1e-6;
      let px = -s.vz / vl;
      let pz = s.vx / vl;
      if (px * dx + pz * dz < 0) {
        px = -px;
        pz = -pz;
      }
      const wgt = 0.6 / (d * d);
      fx += px * wgt;
      fz += pz * wgt;
      if (d < 1.5) danger = true;
    }
    const aimPhase = (w.tick + i * 60) % 120 < 30;
    if (aimPhase && this.aimAt(w, p, out)) {
      out.dashPressed = danger && p.dashCharges > 0 && w.tick % 6 === i;
      out.specialPressed = p.overdrive >= OVERDRIVE.MAX;
      return;
    }
    out.focusHeld = true;
    // Strafe around the threat, and drift back to the centre when far out.
    const fl = Math.sqrt(fx * fx + fz * fz);
    if (fl > 1e-6) {
      const s = this.strafe[i]! * 0.5 * fl;
      const tx = -fz / fl;
      const tz = fx / fl;
      fx += tx * s;
      fz += tz * s;
    }
    const r = Math.sqrt(p.x * p.x + p.z * p.z);
    const pull = r > 18 ? 0.05 * (r - 18) : 0.002 * r;
    if (r > 1e-6) {
      fx -= (p.x / r) * pull;
      fz -= (p.z / r) * pull;
    }
    const l = Math.sqrt(fx * fx + fz * fz);
    if (l > 1e-4) {
      out.moveX = fx / l;
      out.moveZ = fz / l;
    }
    out.dashPressed = danger && p.dashCharges > 0 && w.tick % 6 === i;
    out.specialPressed = p.overdrive >= OVERDRIVE.MAX;
  }

  /** Steers toward the nearest enemy or boss part; false when there is none. */
  private aimAt(w: WorldState, p: Readonly<PlayerEntity>, out: PlayerIntent): boolean {
    let best = Infinity;
    let tx = 0;
    let tz = 0;
    const enemies = w.enemies;
    for (let k = 0; k < enemies.count; k++) {
      const e = enemies.active[k]!;
      const d = (e.x - p.x) * (e.x - p.x) + (e.z - p.z) * (e.z - p.z);
      if (d < best) {
        best = d;
        tx = e.x;
        tz = e.z;
      }
    }
    for (let b = 0; b < w.bosses.length; b++) {
      const e = w.bosses[b]!;
      if (!e.alive) continue;
      const d = (e.x - p.x) * (e.x - p.x) + (e.z - p.z) * (e.z - p.z);
      if (d < best) {
        best = d;
        tx = e.x;
        tz = e.z;
      }
    }
    if (best === Infinity || best < 1e-6) return false;
    const l = Math.sqrt(best);
    out.moveX = (tx - p.x) / l;
    out.moveZ = (tz - p.z) / l;
    return true;
  }
}
