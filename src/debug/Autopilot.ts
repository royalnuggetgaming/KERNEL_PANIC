/**
 * Autopilot: scripted PlayerIntents for soak and stress runs. Each joined player kites: it moves away from the
 * nearest enemy with a sideways strafe (so it circles instead of backing into a wall), is pulled back toward
 * the centre near the arena edge, keeps firing, dashes when something gets close and fires its special when
 * the meter is full. Allocation-free per call.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { PlayerIntent } from '../contracts/input';
import type { WorldView } from '../contracts/world';

/** Arena playable radius (config ARENA.RADIUS; debug/ may not import config). */
const ARENA_RADIUS = 32;
const EDGE_PULL_START = 22;
const THREAT_RANGE = 14;
const DASH_RANGE = 3.5;
const DASH_COOLDOWN_S = 1.2;
const STRAFE_FLIP_S = 3.5;

export class Autopilot {
  enabled = false;
  private readonly lastDash = new Float64Array(2);
  private readonly strafe = new Float64Array([1, -1]);
  private readonly flipAt = new Float64Array(2);

  reset(): void {
    this.lastDash.fill(-1e9);
    this.flipAt.fill(0);
  }

  /** Overwrites `out` with the autopilot's intent for player `p` in world `w`. */
  write(p: PlayerIndex, w: WorldView, out: PlayerIntent): void {
    const me = w.players[p];
    out.fireHeld = true;
    out.focusHeld = false;
    out.dashPressed = false;
    out.specialPressed = false;
    out.moveX = 0;
    out.moveZ = 0;
    if (me.life !== 'alive') return;
    const t = w.time;
    if (t >= this.flipAt[p]!) {
      this.flipAt[p] = t + STRAFE_FLIP_S;
      this.strafe[p] = -this.strafe[p]!;
    }

    let nx = 0;
    let nz = 0;
    let best = THREAT_RANGE * THREAT_RANGE;
    let found = false;
    const enemies = w.enemies;
    for (let i = 0; i < enemies.count; i++) {
      const e = enemies.active[i]!;
      const dx = e.x - me.x;
      const dz = e.z - me.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        nx = dx;
        nz = dz;
        found = true;
      }
    }

    let mx: number;
    let mz: number;
    if (found) {
      const d = Math.sqrt(best) || 1;
      const ax = -nx / d;
      const az = -nz / d;
      const s = this.strafe[p]!;
      mx = ax * 0.75 + -az * s * 0.65;
      mz = az * 0.75 + ax * s * 0.65;
      if (d < DASH_RANGE && t - this.lastDash[p]! > DASH_COOLDOWN_S) {
        this.lastDash[p] = t;
        out.dashPressed = true;
      }
    } else {
      // Idle orbit around the centre.
      const s = this.strafe[p]!;
      mx = -me.z * s * 0.05;
      mz = me.x * s * 0.05;
    }

    const r = Math.sqrt(me.x * me.x + me.z * me.z);
    if (r > EDGE_PULL_START) {
      const k = Math.min(1, (r - EDGE_PULL_START) / (ARENA_RADIUS - EDGE_PULL_START)) * 1.6;
      mx += (-me.x / r) * k;
      mz += (-me.z / r) * k;
    }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    out.moveX = mx;
    out.moveZ = mz;
    out.specialPressed = me.overdrive >= 100;
  }
}
