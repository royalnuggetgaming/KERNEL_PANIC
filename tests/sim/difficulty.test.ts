import { describe, expect, it } from 'vitest';
import type { DifficultyId } from '../../src/contracts/save';
import { SOURCE_WORLD } from '../../src/contracts/simEvents';
import type { WorldState } from '../../src/contracts/world';
import { DIFFICULTY } from '../../src/config/difficulty';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { SIM } from '../../src/config/tuning';
import { damagePlayer } from '../../src/entities/damage';
import { AI_STATE } from '../../src/entities/enemyBehaviors';
import { spawnEnemy, stepEnemies } from '../../src/entities/enemies';
import { createWorld } from '../../src/sim/createWorld';
import { beginWave } from '../../src/sim/rules';
import { buildWorldConfig } from '../../src/sim/runSetup';
import { stateHash } from '../../src/sim/stateHash';
import { beginVersusRound } from '../../src/sim/versusRules';
import { generateWavePlan } from '../../src/sim/WaveDirector';
import { placePlayer, stepSystem, testWorldConfig } from '../helpers/worldFixture';
import { Autopilot } from './autopilot';
import { drive, newSession, runConfigFor } from './runDriver';

function world(difficulty: DifficultyId | undefined, mode: 'coop' | 'solo' | 'versus' = 'coop'): WorldState {
  const base = testWorldConfig({ mode });
  const w = createWorld(difficulty === undefined ? base : { ...base, difficulty });
  w.run.phase = 'combat';
  w.grid.begin();
  w.grid.build();
  placePlayer(w, 0, 0, 0);
  if (mode !== 'solo') placePlayer(w, 1, 25, 25);
  return w;
}

describe('difficulty plumbing', () => {
  it('RunConfig.difficulty reaches WorldConfig (absent = normal); unknown ids are rejected', () => {
    expect(buildWorldConfig(runConfigFor('solo', 1)).difficulty).toBe('normal');
    expect(buildWorldConfig(runConfigFor('coop', 1, { difficulty: 'hard' })).difficulty).toBe('hard');
    const bad = { ...runConfigFor('solo', 1), difficulty: 'nightmare' } as unknown as Parameters<
      typeof buildWorldConfig
    >[0];
    expect(() => buildWorldConfig(bad)).toThrow(/difficulty/);
  });

  it('beginWave and beginVersusRound fix budget and HP from the difficulty', () => {
    for (const id of ['casual', 'normal', 'hard'] as const) {
      const w = world(id);
      beginWave(w, 7);
      const plan = generateWavePlan(7, 2, 'coop', id);
      expect(w.run.enemyHpMul).toBeCloseTo(plan.hpMul, 12);
      expect(w.director.budgetTotal).toBe(plan.budget);
      const v = world(id, 'versus');
      beginVersusRound(v, 3);
      expect(v.director.budgetTotal).toBe(generateWavePlan(7, 2, 'versus', id).budget);
    }
    const hard = world('hard');
    const normal = world(undefined);
    beginWave(hard, 7);
    beginWave(normal, 7);
    expect(hard.director.budgetTotal).toBeGreaterThan(normal.director.budgetTotal);
    expect(hard.run.enemyHpMul).toBeCloseTo(normal.run.enemyHpMul * DIFFICULTY.hard.hp, 12);
  });

  it('enemy speed and the Dart lunge follow the speed multiplier', () => {
    for (const id of ['casual', 'hard'] as const) {
      const w = world(id);
      const s = spawnEnemy(w, 'shard', 0, 20, false, 0);
      expect(s?.speed).toBeCloseTo(ENEMY_DEFS.shard.speed * DIFFICULTY[id].speed, 12);
      const d = spawnEnemy(w, 'dart', 0, 8, false, 0);
      if (d === null) throw new Error('pool full');
      const p = ENEMY_DEFS.dart.params;
      stepSystem(w, stepEnemies, 1);
      expect(d.ai).toBe(AI_STATE.TELEGRAPH);
      stepSystem(w, stepEnemies, Math.round(p.telegraph / SIM.DT) + 1);
      expect(d.ai).toBe(AI_STATE.LUNGE);
      expect(Math.hypot(d.vx, d.vz)).toBeCloseTo(p.lungeSpeed * DIFFICULTY[id].speed, 5);
    }
  });

  it('world damage to players follows the damage multiplier; PvP damage does not', () => {
    for (const id of ['casual', 'normal', 'hard'] as const) {
      const w = world(id);
      const p = w.players[0];
      expect(damagePlayer(w, p, 10, SOURCE_WORLD, 0, 1, 'projectile')).toBeCloseTo(
        10 * DIFFICULTY[id].damage,
        9,
      );
      const v = world(id, 'versus');
      const taken = damagePlayer(v, v.players[0], 10, 1, 0, 1, 'pvp');
      expect(taken).toBeCloseTo(4.5, 9);
    }
  });
});

describe('difficulty determinism and balance', () => {
  it('same seed + same difficulty gives the same hash; difficulties diverge', () => {
    const hashOf = (difficulty: DifficultyId): number => {
      const s = newSession('coop', 11, { difficulty });
      const ap = new Autopilot();
      s.beginNextWave();
      drive(s, 3000, (w) => ap.at(w));
      return stateHash(s.state);
    };
    expect(hashOf('hard')).toBe(hashOf('hard'));
    expect(hashOf('casual')).not.toBe(hashOf('normal'));
    expect(hashOf('hard')).not.toBe(hashOf('normal'));
  });

  it('the plain autopilot survives longer on CASUAL than NORMAL, and on NORMAL than HARD', () => {
    const reach = (difficulty: DifficultyId): number => {
      let total = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const s = newSession('solo', seed, { difficulty });
        const ap = new Autopilot();
        s.beginNextWave();
        drive(s, 360_000, (w) => ap.at(w));
        total += s.state.run.wave;
      }
      return total / 4;
    };
    const casual = reach('casual');
    const normal = reach('normal');
    const hard = reach('hard');
    expect(casual).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(hard);
    // v2 target: the (much worse than human) autopilot gets past the sector 1 boss on NORMAL.
    expect(normal).toBeGreaterThanOrEqual(6.5);
  }, 60_000);
});
