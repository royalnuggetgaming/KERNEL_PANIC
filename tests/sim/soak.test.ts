/**
 * Soak (plan section 11): 72,000 ticks (10 simulated minutes) per seed with autopilot-like intents through a
 * real RunSession, shop visits included. A team wipe starts the next run (seed + 1000) so the full tick count
 * is always simulated. Checks every 30 ticks: no NaN/Infinity anywhere in the entity state, pools within
 * capacity, integer non-negative wallets; waves progress; and a golden final hash per seed.
 */
import { describe, expect, it } from 'vitest';
import type { RunMode } from '../../src/contracts/ids';
import type { EntityPoolApi, PooledRecord } from '../../src/contracts/sim';
import type { WorldState } from '../../src/contracts/world';
import { ECONOMY } from '../../src/config/tuning';
import { stateHash } from '../../src/sim/stateHash';
import { Autopilot } from './autopilot';
import { drive, newSession } from './runDriver';

const TICKS = 72_000;

/**
 * Final stateHash per (mode, seed) after TICKS ticks. Update deliberately when the sim changes.
 * Last update: exact Shard crediting through the fractional pickup carry (ECON-1, also hashed) and the co-op
 * sync-kill cooldown (ECON-3) change wallets, shop purchases and so the whole trajectory.
 */
const GOLDEN: Readonly<Record<string, number>> = {
  'coop:1': 2465465107,
  'solo:2': 2680459033,
  'versus:3': 2504984236,
  'coop-god:4': 784688408,
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

function soak(mode: RunMode, seed: number, god = false): SoakResult {
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
    const s = newSession(mode, runSeed);
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

  it(`co-op with invulnerable players clears both sector 1-2 bosses and reaches sector 3 within ${TICKS} ticks`, () => {
    const r = soak('coop', 4, true);
    expect(r.failure).toBeNull();
    expect(r.runs).toBe(1);
    expect(r.bestWave).toBeGreaterThanOrEqual(11);
    expect(r.wavesCleared).toBeGreaterThanOrEqual(10);
    expect(r.hash).toBe(GOLDEN['coop-god:4']);
  }, 60_000);
});
