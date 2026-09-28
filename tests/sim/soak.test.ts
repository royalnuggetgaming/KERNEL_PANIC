/**
 * Soak (plan section 11): 72,000 ticks (10 simulated minutes) per seed with autopilot-like intents through a
 * real RunSession, shop visits included. A team wipe starts the next run (seed + 1000) so the full tick count
 * is always simulated. Checks every 30 ticks: no NaN/Infinity anywhere in the entity state, pools within
 * capacity, integer non-negative wallets; waves progress; and a golden final hash per seed.
 */
import { describe, expect, it } from 'vitest';
import type { RunMode } from '../../src/contracts/ids';
import type { DifficultyId } from '../../src/contracts/save';
import type { EntityPoolApi, PooledRecord } from '../../src/contracts/sim';
import type { WorldState } from '../../src/contracts/world';
import { ECONOMY } from '../../src/config/tuning';
import { stateHash } from '../../src/sim/stateHash';
import { Autopilot } from './autopilot';
import { drive, newSession } from './runDriver';

const TICKS = 72_000;

/**
 * Final stateHash per (mode, seed) after TICKS ticks. Update deliberately when the sim changes.
 * Last update: the v2 balance pass (slower, fewer, weaker enemies and bosses on NORMAL) and the difficulty
 * (hashed, and scaling budget / HP / speed / damage) change every trajectory. casual/hard rows added.
 */
const GOLDEN: Readonly<Record<string, number>> = {
  'coop:1': 649527971,
  'solo:2': 3192251004,
  'versus:3': 317669827,
  'coop-god:4': 4235647592,
  'coop-casual:5': 178468313,
  'coop-hard:6': 423065953,
};

function finite(...xs: number[]): boolean {
  for (const x of xs) if (!Number.isFinite(x)) return false;
  return true;
}

function checkPool<T extends PooledRecord>(pool: EntityPoolApi<T>, ok: (r: T) => boolean): string | null {
  if (pool.count < 0 || pool.count > pool.capacity) return `pool count ${pool.count}/${pool.capacity}`;
  for (let i = 0; i < pool.count; i++)
    if (!ok(pool.active[i]!)) return `bad record in slot ${pool.active[i]!.slot}`;
  return null;
}

function invariants(w: WorldState): string | null {
  for (const p of w.players) {
    if (!finite(p.x, p.z, p.vx, p.vz, p.yaw, p.hp, p.overdrive, p.score, p.damageDealt))
      return `player ${p.index} NaN`;
    if (p.life === 'alive' && (p.hp <= 0 || p.hp > p.stats.maxHp + 1e-9))
      return `player ${p.index} hp ${p.hp}`;
  }
  for (let i = 0; i < 2; i++) {
    const v = w.run.wallets[i]!;
    if (!Number.isSafeInteger(v) || v < 0 || v > ECONOMY.WALLET_MAX) return `wallet ${i} = ${v}`;
  }
  return (
    checkPool(w.enemies, (e) => finite(e.x, e.z, e.vx, e.vz, e.hp) && e.hp <= e.maxHp + 1e-9) ??
    checkPool(w.playerShots, (s) => finite(s.x, s.z, s.vx, s.vz, s.damage)) ??
    checkPool(w.enemyShots, (s) => finite(s.x, s.z, s.vx, s.vz, s.damage)) ??
    checkPool(w.pickups, (k) => finite(k.x, k.z) && Number.isInteger(k.value) && k.value > 0) ??
    checkPool(w.lasers, (l) => finite(l.x, l.z, l.angle)) ??
    checkPool(w.director.pending, (p) => finite(p.x, p.z)) ??
    (w.bosses.every((b) => !b.alive || finite(b.x, b.z, b.hp)) ? null : 'boss NaN')
  );
}

interface SoakResult {
  hash: number;
  runs: number;
  wavesCleared: number;
  bestWave: number;
  rounds: number;
  visits: number;
  failure: string | null;
}

function soak(mode: RunMode, seed: number, god = false, difficulty: DifficultyId = 'normal'): SoakResult {
  const res: SoakResult = {
    hash: 0,
    runs: 0,
    wavesCleared: 0,
    bestWave: 0,
    rounds: 0,
    visits: 0,
    failure: null,
  };
  let left = TICKS;
  let runSeed = seed;
  while (left > 0) {
    const s = newSession(mode, runSeed, { difficulty });
    const ap = new Autopilot();
    s.beginNextWave();
    res.runs++;
    const r = drive(
      s,
      left,
      (w) => ap.at(w),
      (w, t) => {
        if (god) for (const p of w.players) if (p.life === 'alive') p.invulnUntil = w.time + 1;
        if (res.failure === null && t % 30 === 0) {
          const bad = invariants(w);
          if (bad !== null) res.failure = `tick ${w.tick} run ${res.runs}: ${bad}`;
        }
      },
    );
    left -= r.ticks;
    res.visits += r.visits;
    res.wavesCleared += s.state.run.wavesCleared;
    res.bestWave = Math.max(res.bestWave, s.state.run.wave);
    res.rounds += s.summary('abandoned').roundsPlayed;
    res.hash = stateHash(s.state);
    s.dispose();
    runSeed += 1000;
  }
  return res;
}

describe('soak', () => {
  for (const [mode, seed] of [
    ['coop', 1],
    ['solo', 2],
    ['versus', 3],
  ] as const) {
    it(`${mode} seed ${seed}: ${TICKS} ticks stay finite, bounded and progressing`, () => {
      const r = soak(mode, seed);
      expect(r.failure).toBeNull();
      if (mode === 'versus') {
        expect(r.rounds).toBeGreaterThanOrEqual(5);
      } else {
        expect(r.wavesCleared).toBeGreaterThanOrEqual(8);
        expect(r.bestWave).toBeGreaterThanOrEqual(4);
      }
      expect(r.visits).toBeGreaterThan(0);
      expect(r.hash).toBe(GOLDEN[`${mode}:${seed}`]);
    }, 60_000);
  }

  for (const [difficulty, seed] of [
    ['casual', 5],
    ['hard', 6],
  ] as const) {
    it(`${difficulty} co-op seed ${seed}: ${TICKS} ticks stay finite, bounded and deterministic`, () => {
      const r = soak('coop', seed, false, difficulty);
      expect(r.failure).toBeNull();
      expect(r.wavesCleared).toBeGreaterThanOrEqual(8);
      expect(r.hash).toBe(GOLDEN[`coop-${difficulty}:${seed}`]);
    }, 60_000);
  }

  it(`co-op with invulnerable players clears both sector 1-2 bosses and reaches sector 3 within ${TICKS} ticks`, () => {
    const r = soak('coop', 4, true);
    expect(r.failure).toBeNull();
    expect(r.runs).toBe(1);
    expect(r.bestWave).toBeGreaterThanOrEqual(11);
    expect(r.wavesCleared).toBeGreaterThanOrEqual(10);
    expect(r.hash).toBe(GOLDEN['coop-god:4']);
  }, 60_000);
});
