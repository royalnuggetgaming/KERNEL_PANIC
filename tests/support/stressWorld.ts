/**
 * PERF critic fixture: the plan section 10 stress load on the real sim (same load as tests/sim/perf.test.ts):
 * 180 enemies (all kinds), 1,500 player shots + 500 enemy shots topped up before every step, both players
 * (Lancer + Tinker) kept invulnerable, wave 12 held in combat. `tank` keeps enemies at 1e7 HP (no kills);
 * otherwise they have their wave-scaled HP, so kills, pickups and explosions happen as in play.
 */
import { ENEMY_KINDS, NO_HANDLE } from '../../src/contracts/ids';
import type { Intents } from '../../src/contracts/input';
import { PROJECTILE_KINDS, type ProjectileSpec } from '../../src/contracts/sim';
import { SOURCE_WORLD } from '../../src/contracts/simEvents';
import type { WorldState } from '../../src/contracts/world';
import { SIM } from '../../src/config/tuning';
import { createRng } from '../../src/core/rng';
import { spawnEnemy } from '../../src/entities/enemies';
import { spawnProjectile } from '../../src/entities/projectiles';
import { createWorld } from '../../src/sim/createWorld';
import { beginWave } from '../../src/sim/rules';
import { stepWorld } from '../../src/sim/stepWorld';
import { testWorldConfig } from '../helpers/worldFixture';
import { Autopilot } from '../sim/autopilot';

export const STRESS_ENEMIES = 180;
const PLAYER_SHOTS = 1_500;
const ENEMY_SHOTS = 500;

export interface StressRig {
  readonly w: WorldState;
  /** Tops the load up and returns this step's intents. */
  prep(): Intents;
  /** prep() + stepWorld(). Events are NOT cleared. */
  step(): void;
}

export function createStressRig(tank: boolean, wave = 12): StressRig {
  const rng = createRng(9).fork('perf-critic');
  const spec: ProjectileSpec = {
    side: 'player',
    owner: 0,
    kind: PROJECTILE_KINDS.bolt,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    damage: 1,
    radius: 0.25,
    life: 1.2,
    pierce: 0,
    bounces: 0,
    crit: false,
    homing: NO_HANDLE,
  };
  const w = createWorld(testWorldConfig({ seed: 5, mode: 'coop', vehicles: ['lancer', 'tinker'] }));
  beginWave(w, wave);
  const ap = new Autopilot();
  while (w.run.phase === 'countdown') stepWorld(w, ap.at(w), SIM.DT);
  w.director.budgetLeft = 0;
  let k = 0;
  const topUp = (): void => {
    while (w.enemies.count < STRESS_ENEMIES) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(8, 28);
      const kind = ENEMY_KINDS[k++ % ENEMY_KINDS.length]!;
      const e = spawnEnemy(w, kind, Math.sin(a) * r, Math.cos(a) * r, false, 0);
      if (e === null) break;
      if (tank) e.hp = e.maxHp = 1e7;
    }
    while (w.playerShots.count < PLAYER_SHOTS || w.enemyShots.count < ENEMY_SHOTS) {
      const player = w.playerShots.count < PLAYER_SHOTS;
      const a = rng.range(0, Math.PI * 2);
      spec.side = player ? 'player' : 'enemy';
      spec.owner = player ? (w.playerShots.count & 1 ? 1 : 0) : SOURCE_WORLD;
      spec.kind = player ? PROJECTILE_KINDS.bolt : PROJECTILE_KINDS.enemyOrb;
      spec.x = rng.range(-28, 28);
      spec.z = rng.range(-28, 28);
      spec.vx = Math.sin(a) * (player ? 40 : 10);
      spec.vz = Math.cos(a) * (player ? 40 : 10);
      if (spawnProjectile(w, spec) === null) break;
    }
  };
  const prep = (): Intents => {
    topUp();
    for (let i = 0; i < 2; i++) w.players[i === 0 ? 0 : 1].invulnUntil = w.time + 1;
    w.run.waveTimer = 60;
    return ap.at(w);
  };
  return {
    w,
    prep,
    step: (): void => {
      stepWorld(w, prep(), SIM.DT);
    },
  };
}
