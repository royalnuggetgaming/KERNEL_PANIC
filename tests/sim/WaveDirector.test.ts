import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../src/contracts/world';
import { ARENA, SIM } from '../../src/config/tuning';
import { DIFFICULTY } from '../../src/config/difficulty';
import { WAVES, waveBudget } from '../../src/config/waves';
import { bossAlive } from '../../src/entities/bosses';
import { stepEnemies } from '../../src/entities/enemies';
import { choosePortals, formationPoint, portalPosition } from '../../src/sim/formations';
import {
  directorDone,
  generateWavePlan,
  pulseCount,
  runPulse,
  startWave,
  stepWaveDirector,
  unlockedKinds,
} from '../../src/sim/WaveDirector';
import { createRng } from '../../src/core/rng';
import { createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

function combatWorld(wave: number, mode: 'coop' | 'solo' = 'coop', seed = 1): WorldState {
  const w = createTestWorld({ mode, seed });
  const plan = generateWavePlan(wave, mode === 'coop' ? 2 : 1, mode);
  w.run.wave = wave;
  w.run.sector = wave <= 5 ? 1 : wave <= 10 ? 2 : 3;
  w.run.waveDuration = plan.duration;
  w.run.enemyHpMul = plan.hpMul;
  w.run.phase = plan.boss === null ? 'combat' : 'boss';
  startWave(w, plan);
  w.grid.begin();
  w.grid.build();
  return w;
}

describe('generateWavePlan', () => {
  // v2 rebalance (user: "too many enemies"): round(18 + 8w + 0.9w^2) and x1.45 in 2P. v1 was
  // round(30 + 14w + 1.8w^2) x1.5 = [46, 145, 350, 645] solo; HARD's budget multiplier restores roughly that.
  it('tabled budgets at w1, w5, w10 and w15, x1.45 in 2P', () => {
    const solo = [1, 5, 10, 15].map((w) => generateWavePlan(w, 1, 'solo').budget);
    const coop = [1, 5, 10, 15].map((w) => generateWavePlan(w, 2, 'coop').budget);
    expect(solo).toEqual([27, 81, 188, 341]);
    expect(coop).toEqual([39, 117, 273, 494]);
    expect(generateWavePlan(1, 2, 'coop').threatMul).toBe(1.45);
    expect(generateWavePlan(1, 1, 'solo').threatMul).toBe(1);
  });

  it('versus uses 0.6 x the wave budget and never a boss', () => {
    const p = generateWavePlan(13, 2, 'versus');
    expect(p.budget).toBe(Math.round(Math.round(18 + 8 * 13 + 0.9 * 169) * 0.6));
    expect(p.threatMul).toBe(0.6);
    expect(p.boss).toBeNull();
    expect(generateWavePlan(5, 2, 'versus').boss).toBeNull();
    expect(p.duration).toBe(90);
  });

  it('durations, pulse intervals, bosses and OVERFLOW', () => {
    expect(generateWavePlan(1, 1, 'solo').duration).toBe(40);
    expect(generateWavePlan(14, 1, 'solo').duration).toBe(70);
    expect(generateWavePlan(1, 1, 'solo').pulseInterval).toBe(3.8);
    expect(generateWavePlan(6, 1, 'solo').pulseInterval).toBe(3.5);
    expect(generateWavePlan(11, 1, 'solo').pulseInterval).toBe(3.2);
    expect(generateWavePlan(5, 1, 'solo').boss).toBe('forkBomb');
    expect(generateWavePlan(10, 2, 'coop').boss).toBe('raceCondition');
    expect(generateWavePlan(15, 2, 'coop').boss).toBe('kernel');
    expect(generateWavePlan(4, 2, 'coop').boss).toBeNull();
    expect(generateWavePlan(20, 2, 'coop').boss).toBe('forkBomb');
    expect(generateWavePlan(25, 2, 'coop').boss).toBe('raceCondition');
    expect(generateWavePlan(16, 1, 'solo').hpMul).toBeCloseTo(Math.pow(1.05, 14) * 1.12, 9);
  });

  // v2 rebalance: 5% HP growth per wave (v1: 7%) so later waves do not drag.
  it('HP scaling 1.05^(w-1), x1.2 in 2P', () => {
    expect(generateWavePlan(1, 1, 'solo').hpMul).toBe(1);
    expect(generateWavePlan(3, 1, 'solo').hpMul).toBeCloseTo(1.05 * 1.05, 12);
    expect(generateWavePlan(3, 2, 'coop').hpMul).toBeCloseTo(1.05 * 1.05 * 1.2, 12);
  });

  it('difficulty scales the budget and enemy HP, never the boss or the timing', () => {
    for (const id of ['casual', 'hard'] as const) {
      const d = DIFFICULTY[id];
      for (const [wave, n, mode] of [
        [7, 1, 'solo'],
        [7, 2, 'coop'],
        [13, 2, 'versus'],
        [10, 2, 'coop'],
      ] as const) {
        const base = generateWavePlan(wave, n, mode);
        const plan = generateWavePlan(wave, n, mode, id);
        expect(plan.budget).toBe(Math.round(waveBudget(wave) * base.threatMul * d.budget));
        expect(plan.hpMul).toBeCloseTo(base.hpMul * d.hp, 12);
        expect(plan.threatMul).toBe(base.threatMul);
        expect(plan.boss).toBe(base.boss);
        expect(plan.duration).toBe(base.duration);
      }
    }
    expect(generateWavePlan(7, 2, 'coop', 'normal')).toEqual(generateWavePlan(7, 2, 'coop'));
  });

  it('unlock schedule', () => {
    expect(unlockedKinds(1)).toEqual(['shard']);
    expect(unlockedKinds(2)).toEqual(['shard', 'dart']);
    expect(unlockedKinds(3)).toEqual(['shard', 'dart', 'fork']);
    expect(unlockedKinds(4)).toEqual(['shard', 'dart', 'fork', 'spiker']);
    expect(unlockedKinds(6)).toEqual(['shard', 'dart', 'fork', 'spiker', 'warden']);
    expect(unlockedKinds(7)).toEqual(['shard', 'dart', 'fork', 'spiker', 'warden', 'leech']);
  });

  it('is pure: same inputs give equal plans', () => {
    expect(generateWavePlan(7, 2, 'coop')).toEqual(generateWavePlan(7, 2, 'coop'));
  });

  it('pulse count', () => {
    expect(pulseCount(40, 3.8)).toBe(7);
    expect(pulseCount(10, 3.8)).toBe(WAVES.PULSES_PER_WAVE_MIN);
    expect(pulseCount(0, 0)).toBe(WAVES.PULSES_PER_WAVE_MIN);
  });
});

describe('portals and formations', () => {
  it('chooses the 3 portals farthest from the players', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 30);
    placePlayer(w, 1, 0, 29);
    const out = new Int32Array(3);
    expect(choosePortals(w, out)).toBe(3);
    expect(Array.from(out)).toEqual([4, 3, 5]);
    placePlayer(w, 0, 30, 0);
    placePlayer(w, 1, 30, 0);
    choosePortals(w, out);
    expect(Array.from(out)).toEqual([6, 5, 7]);
  });

  it('uses the nearest present player (offline ghosts are ignored)', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 30);
    placePlayer(w, 1, 0, -30);
    w.players[1].life = 'offline';
    const out = new Int32Array(3);
    choosePortals(w, out);
    expect(out[0]).toBe(4);
  });

  it('formation points stay inside the arena for every formation', () => {
    const rng = createRng(3);
    const p = { x: 0, z: 0 };
    for (const f of WAVES.FORMATIONS) {
      for (let portal = 0; portal < ARENA.PORTALS; portal++) {
        for (let k = 0; k < 20; k++) {
          formationPoint(f, portal, k, rng, p);
          expect(Math.hypot(p.x, p.z)).toBeLessThan(ARENA.RADIUS + 4);
          expect(Number.isFinite(p.x)).toBe(true);
        }
      }
    }
    portalPosition(0, p);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(ARENA.PORTAL_RADIUS, 9);
  });
});

describe('stepWaveDirector', () => {
  it('spends the budget in telegraphed pulses at the farthest portals', () => {
    const w = combatWorld(3);
    placePlayer(w, 0, 0, 25);
    placePlayer(w, 1, 0, 25);
    stepSystem(w, stepWaveDirector, Math.round(0.6 / SIM.DT));
    expect(w.director.pulseIndex).toBe(1);
    expect(w.director.pending.count).toBeGreaterThan(0);
    expect(w.events.telegraph.count).toBeGreaterThan(0);
    for (let i = 0; i < w.director.pending.count; i++) {
      const p = w.director.pending.active[i]!;
      expect([3, 4, 5]).toContain(p.portal);
      expect(p.z).toBeLessThan(0);
      expect(p.delay).toBeCloseTo(WAVES.TELEGRAPH, 9);
    }
    stepSystem(
      w,
      (ww, i, dt) => {
        stepEnemies(ww, i, dt);
        stepWaveDirector(ww, i, dt);
        // Kill everything instantly so the cap never binds.
        ww.enemies.clear();
      },
      Math.round(40 / SIM.DT),
    );
    expect(w.director.budgetLeft).toBeLessThanOrEqual(0);
    expect(w.director.pulseIndex).toBeLessThanOrEqual(
      pulseCount(w.run.waveDuration, w.director.pulseInterval),
    );
    stepSystem(w, stepEnemies, 200);
    expect(directorDone(w)).toBe(true);
  });

  it('never exceeds 180 alive; excess budget is deferred to later pulses', () => {
    const w = combatWorld(14);
    w.director.budgetLeft = 5000;
    w.director.budgetTotal = 5000;
    let maxAlive = 0;
    stepSystem(
      w,
      (ww, i, dt) => {
        stepEnemies(ww, i, dt);
        stepWaveDirector(ww, i, dt);
        const alive = ww.enemies.count + ww.director.pending.count;
        if (alive > maxAlive) maxAlive = alive;
      },
      Math.round(60 / SIM.DT),
    );
    expect(maxAlive).toBeLessThanOrEqual(WAVES.MAX_ALIVE);
    expect(w.enemies.count).toBe(WAVES.MAX_ALIVE);
    expect(w.director.budgetLeft).toBeGreaterThan(0);
    // Room frees up: the held-back budget spawns on the next pulse.
    for (let i = w.enemies.count - 1; i >= 100; i--) w.enemies.despawn(w.enemies.active[i]!);
    const before = w.director.budgetLeft;
    w.director.pulseTimer = 0;
    stepSystem(w, stepWaveDirector, 1);
    expect(w.director.budgetLeft).toBeLessThan(before);
    expect(w.director.pending.count).toBeGreaterThan(0);
  });

  it('respects the unlock schedule', () => {
    const w = combatWorld(2);
    w.director.budgetLeft = 200;
    for (let i = 0; i < 10; i++) runPulse(w);
    for (let i = 0; i < w.director.pending.count; i++) {
      expect(['shard', 'dart']).toContain(w.director.pending.active[i]!.kind);
    }
  });

  it('CORRUPTED elites appear only from sector 2', () => {
    const w1 = combatWorld(4);
    w1.director.budgetLeft = 170;
    runPulse(w1);
    for (let i = 0; i < w1.director.pending.count; i++)
      expect(w1.director.pending.active[i]!.elite).toBe(false);
    const w2 = combatWorld(14, 'coop', 9);
    let elites = 0;
    let total = 0;
    for (let n = 0; n < 20; n++) {
      w2.director.pending.clear();
      w2.director.budgetLeft = 170;
      w2.director.pulseIndex = 1000;
      runPulse(w2);
      total += w2.director.pending.count;
      for (let i = 0; i < w2.director.pending.count; i++) if (w2.director.pending.active[i]!.elite) elites++;
    }
    expect(elites).toBeGreaterThan(0);
    expect(elites / total).toBeLessThan(0.25);
  });

  it('same seed gives the same spawns', () => {
    const snap = (seed: number): string => {
      const w = combatWorld(9, 'coop', seed);
      stepSystem(
        w,
        (ww, i, dt) => {
          stepEnemies(ww, i, dt);
          stepWaveDirector(ww, i, dt);
        },
        Math.round(12 / SIM.DT),
      );
      const parts: string[] = [];
      for (let i = 0; i < w.enemies.count; i++) {
        const e = w.enemies.active[i]!;
        parts.push(`${e.kind}:${e.x.toFixed(4)}:${e.z.toFixed(4)}:${String(e.elite)}`);
      }
      return parts.join('|');
    };
    expect(snap(5)).toBe(snap(5));
    expect(snap(5)).not.toBe(snap(6));
  });

  it('spawns the boss when the boss phase starts and spends no pulse budget', () => {
    const w = combatWorld(5);
    expect(w.director.budgetLeft).toBe(0);
    // v2 rebalance: w5 co-op budget round(81 x 1.45) = 117 (v1: 218); still never spent on a boss wave.
    expect(w.director.budgetTotal).toBe(117);
    stepSystem(w, stepWaveDirector, 1);
    expect(w.director.bossSpawned).toBe(true);
    expect(bossAlive(w)).toBe(true);
    expect(w.bosses[0]!.id).toBe('forkBomb');
  });

  it('does nothing outside combat', () => {
    const w = combatWorld(3);
    w.run.phase = 'countdown';
    stepSystem(w, stepWaveDirector, 200);
    expect(w.director.pending.count).toBe(0);
  });
});
