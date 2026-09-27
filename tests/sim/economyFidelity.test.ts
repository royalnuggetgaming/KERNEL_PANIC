/**
 * Economy fidelity (ECON-3): the Monte Carlo in economy.test.ts only guards the economy targets if its modelled
 * income matches the real sim, so this re-measures real RunSession runs:
 * - invulnerable Autopilot runs buying with the Monte Carlo's greedy buyer (realEconomy.ts), all 15 waves:
 *   per-player Shards earned per sector within +-20% of the model, co-op sync-kill Shards within +-30% of the
 *   model, and 2P vs solo per-player income within the +-25% design target in every sector;
 * - normal (vulnerable) play without purchases, waves 1-3: 2P vs solo per-player income within +-25%.
 * Before the sync-kill cooldown (entities/combo.ts SYNC_COOLDOWN) sync kills paid ~45 Shards per player per wave
 * and 2P per-player income ran 1.3-1.5x solo in sector 1, while the model assumed 0-12.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerIndex, RunMode } from '../../src/contracts/ids';
import { createRng } from '../../src/core/rng';
import { COOP } from '../../src/config/tuning';
import { WAVES, sectorOf } from '../../src/config/waves';
import { Autopilot } from './autopilot';
import { simulateRun, syncKills } from './economyModel';
import { realRun, type RealWave } from './realEconomy';
import { newSession } from './runDriver';

const REAL_SEEDS = [300, 301, 302];
const MODEL_RUNS = 300;

/** Mean per-player Shards earned per wave, by sector (index sector - 1). */
function bySector(waves: readonly { wave: number; earned: readonly number[] }[]): number[] {
  const sum = [0, 0, 0];
  const n = [0, 0, 0];
  for (const w of waves)
    for (const e of w.earned) {
      sum[sectorOf(w.wave) - 1]! += e;
      n[sectorOf(w.wave) - 1]!++;
    }
  return sum.map((s, i) => s / n[i]!);
}

function realWaves(mode: RunMode): RealWave[] {
  const out: RealWave[] = [];
  for (const seed of REAL_SEEDS) {
    const run = realRun(mode, seed);
    expect(run.length).toBe(WAVES.TOTAL);
    out.push(...run);
  }
  return out;
}

function modelWaves(mode: RunMode): { wave: number; earned: number[] }[] {
  const out: { wave: number; earned: number[] }[] = [];
  for (let i = 0; i < MODEL_RUNS; i++) {
    const r = simulateRun(mode, 40_000 + i, i % 2 === 0 ? 'greedy' : 'random');
    for (let k = 0; k < WAVES.TOTAL; k++) out.push({ wave: k + 1, earned: r.earnedByWave.map((p) => p[k]!) });
  }
  return out;
}

/** Per-player income over waves 1-3 of normal play (players can die), no purchases. */
function earlyIncome(mode: RunMode, seed: number): number[] {
  const s = newSession(mode, seed);
  const ap = new Autopilot();
  const n = mode === 'solo' ? 1 : 2;
  const out: number[] = [];
  const before = [0, 0];
  let waves = 0;
  s.beginNextWave();
  for (let t = 0; t < 100_000 && waves < 3; t++) {
    s.tick(ap.at(s.state));
    s.clearEvents();
    if (s.flags.defeat) break;
    if (!s.flags.waveClearReady) continue;
    for (let i = 0; i < n; i++) {
      const earned = s.state.run.shardsEarned[i as PlayerIndex];
      out.push(earned - before[i]!);
      before[i] = earned;
    }
    waves++;
    const shop = s.openShop();
    shop.update(400);
    shop.commit();
    s.applyShopResults();
    s.beginNextWave();
  }
  return out;
}

function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

describe('economy fidelity: the Monte Carlo income model matches the real sim', () => {
  const real: Record<'solo' | 'coop', RealWave[]> = { solo: [], coop: [] };
  beforeAll(() => {
    real.solo = realWaves('solo');
    real.coop = realWaves('coop');
  }, 120_000);

  it('per-player Shards earned per sector are within +-20% of the model', () => {
    for (const mode of ['solo', 'coop'] as const) {
      const r = bySector(real[mode]);
      const m = bySector(modelWaves(mode));
      for (let s = 0; s < 3; s++) {
        const ratio = r[s]! / m[s]!;
        expect(
          ratio,
          `${mode} sector ${s + 1}: real ${r[s]!.toFixed(0)} vs model ${m[s]!.toFixed(0)}`,
        ).toBeGreaterThan(0.8);
        expect(
          ratio,
          `${mode} sector ${s + 1}: real ${r[s]!.toFixed(0)} vs model ${m[s]!.toFixed(0)}`,
        ).toBeLessThan(1.2);
      }
    }
  }, 60_000);

  it('co-op sync-kill Shards per player per wave are within +-30% of the model', () => {
    const realSync = mean(real.coop.map((w) => w.syncKills * COOP.SYNC_SHARDS));
    const rng = createRng(7).fork('sync-model');
    const modelSync: number[] = [];
    for (let i = 0; i < 200; i++)
      for (let wave = 1; wave <= WAVES.TOTAL; wave++) modelSync.push(syncKills(wave, rng) * COOP.SYNC_SHARDS);
    const ratio = realSync / mean(modelSync);
    expect(ratio, `real ${realSync.toFixed(1)} vs model ${mean(modelSync).toFixed(1)}`).toBeGreaterThan(0.7);
    expect(ratio, `real ${realSync.toFixed(1)} vs model ${mean(modelSync).toFixed(1)}`).toBeLessThan(1.3);
  });

  it('real 2P vs solo per-player income is within +-25% in every sector', () => {
    const solo = bySector(real.solo);
    const coop = bySector(real.coop);
    for (let s = 0; s < 3; s++) {
      const ratio = coop[s]! / solo[s]!;
      expect(ratio, `sector ${s + 1}`).toBeGreaterThanOrEqual(0.75);
      expect(ratio, `sector ${s + 1}`).toBeLessThanOrEqual(1.25);
    }
  });

  it('real 2P vs solo per-player income in normal play (waves 1-3) is within +-25%', () => {
    const seeds = [100, 101, 102, 103];
    const coop = mean(seeds.flatMap((seed) => earlyIncome('coop', seed)));
    const solo = mean(seeds.flatMap((seed) => earlyIncome('solo', seed)));
    const ratio = coop / solo;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThanOrEqual(1.25);
  }, 60_000);
});
